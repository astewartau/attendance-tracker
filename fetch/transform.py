import re

CHAMPIONSHIP_PATTERNS = [
    r"championship",
    r"set\s*champ",
    r"\bsc\b",
    r"challenge\s*event",
]
_CHAMPIONSHIP_RE = re.compile("|".join(CHAMPIONSHIP_PATTERNS), re.IGNORECASE)

AU_STATES = ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "ACT", "NT"]
_AU_STATE_RE = re.compile(
    r"\b(" + "|".join(AU_STATES) + r")\b",
    re.IGNORECASE,
)


def filter_aunz_stores(raw_stores):
    """Filter for AU/NZ stores and deduplicate by store ID."""
    seen = {}
    for entry in raw_stores:
        store = entry.get("store", {})
        if store.get("country") in ("AU", "NZ") and store["id"] not in seen:
            seen[store["id"]] = store
    return list(seen.values())


def classify_event(event):
    """Classify an event as 'championship' or 'league' based on its name."""
    name = event.get("name", "")
    if _CHAMPIONSHIP_RE.search(name):
        return "championship"
    return "league"


def extract_state(full_address, country):
    """Extract the Australian state abbreviation from an address string."""
    if country == "NZ":
        return "NZ"
    if country == "AU":
        match = _AU_STATE_RE.search(full_address or "")
        if match:
            return match.group(1).upper()
    return "Unknown"


def build_store_record(store):
    """Build a slim store record for JSON output."""
    return {
        "id": store["id"],
        "name": store["name"],
        "country": store.get("country", ""),
        "state": extract_state(store.get("full_address", ""), store.get("country", "")),
        "full_address": store.get("full_address", ""),
        "latitude": store.get("latitude"),
        "longitude": store.get("longitude"),
    }


def build_event_record(event, store_id):
    """Build a slim event record for JSON output."""
    return {
        "id": event["id"],
        "store_id": store_id,
        "name": event.get("name", ""),
        "category": classify_event(event),
        "event_status": event.get("settings", {}).get("event_lifecycle_status", ""),
        "start_datetime": event.get("start_datetime", ""),
        "registered_user_count": event.get("registered_user_count", 0),
        "starting_player_count": event.get("starting_player_count", 0),
    }


def build_registration_record(reg, event_id):
    """Build a slim registration record for JSON output."""
    user = reg.get("user", {})
    return {
        "event_id": event_id,
        "user_id": user.get("id"),
        "user_name": reg.get("best_identifier", user.get("best_identifier", "")),
        "matches_won": reg.get("matches_won", 0),
        "matches_lost": reg.get("matches_lost", 0),
        "matches_drawn": reg.get("matches_drawn", 0),
        "final_place": reg.get("final_place_in_standings"),
    }
