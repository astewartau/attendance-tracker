import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from fetch.api import get_all_stores, get_events, get_registrations
from fetch.transform import (
    filter_aunz_stores,
    build_store_record,
    build_event_record,
    build_registration_record,
)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
REGISTRATIONS_DIR = DATA_DIR / "registrations"


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  Wrote {path} ({len(data) if isinstance(data, list) else 'object'})")


def main():
    parser = argparse.ArgumentParser(description="Fetch Lorcana PlayHub data")
    parser.add_argument("--state", help="Only fetch stores in this AU state (e.g. QLD)")
    parser.add_argument("--store-id", type=int, help="Fetch a single store by ID")
    args = parser.parse_args()

    start_time = time.time()
    session = requests.Session()
    session.headers["Accept"] = "application/json"

    # Step 1: Get AU/NZ stores
    if args.store_id:
        # Debug mode: fetch events for a single store without needing store list
        print(f"Debug mode: fetching store {args.store_id} only")
        store_records = [{"id": args.store_id, "name": "debug", "country": "AU",
                          "state": "Unknown", "full_address": "", "latitude": None,
                          "longitude": None}]
    else:
        raw_stores = get_all_stores(session)
        aunz_stores = filter_aunz_stores(raw_stores)
        print(f"Found {len(aunz_stores)} unique AU/NZ stores")

        store_records = [build_store_record(s) for s in aunz_stores]

        if args.state:
            store_records = [s for s in store_records if s["state"] == args.state.upper()]
            print(f"Filtered to {len(store_records)} stores in {args.state.upper()}")

        write_json(DATA_DIR / "stores.json", store_records)

    # Step 2: Fetch events for each store
    all_events = []
    registrations_by_state = {}
    store_lookup = {s["id"]: s for s in store_records}

    for i, store in enumerate(store_records):
        print(f"[{i+1}/{len(store_records)}] Fetching events for {store['name']} (ID: {store['id']})...")
        try:
            raw_events = get_events(session, store["id"])
        except Exception as e:
            print(f"  Error fetching events: {e}")
            continue

        event_records = [build_event_record(e, store["id"]) for e in raw_events]
        all_events.extend(event_records)
        print(f"  Found {len(event_records)} events")

        # Step 3: Fetch registrations for finished events
        archived = [e for e in raw_events
                     if e.get("settings", {}).get("event_lifecycle_status") == "EVENT_FINISHED"]
        for event in archived:
            try:
                raw_regs = get_registrations(session, event["id"])
            except Exception as e:
                print(f"  Error fetching registrations for event {event['id']}: {e}")
                continue

            if not raw_regs:
                continue

            reg_records = [build_registration_record(r, event["id"]) for r in raw_regs]
            state = store["state"]
            registrations_by_state.setdefault(state, []).extend(reg_records)

    # Step 4: Write output files
    write_json(DATA_DIR / "events.json", all_events)

    for state, regs in registrations_by_state.items():
        write_json(REGISTRATIONS_DIR / f"{state}.json", regs)

    elapsed = time.time() - start_time
    meta = {
        "last_fetch": datetime.now(timezone.utc).isoformat(),
        "store_count": len(store_records),
        "event_count": len(all_events),
        "registration_count": sum(len(r) for r in registrations_by_state.values()),
        "fetch_duration_seconds": round(elapsed),
    }
    write_json(DATA_DIR / "meta.json", meta)

    print(f"\nDone in {elapsed:.0f}s")
    print(f"  {meta['store_count']} stores, {meta['event_count']} events, {meta['registration_count']} registrations")


if __name__ == "__main__":
    main()
