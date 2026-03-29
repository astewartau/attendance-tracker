import time
import requests

BASE_URL = "https://api.ravensburgerplay.com/api/v2"
REQUEST_DELAY = 0.5
MAX_RETRIES = 3


def paginate(session, url, params, page_size=100):
    """Generator yielding all results across pages."""
    params = {**params, "page_size": page_size, "page": 1}
    while True:
        data = _request_with_retry(session, url, params)
        yield from data["results"]
        if data.get("next_page_number") is None:
            break
        params["page"] = data["next_page_number"]
        time.sleep(REQUEST_DELAY)


def _request_with_retry(session, url, params):
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.get(url, params=params, timeout=30)
            if resp.status_code == 429 or resp.status_code >= 500:
                wait = 2 ** attempt
                print(f"  HTTP {resp.status_code}, retrying in {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.RequestException as e:
            if attempt == MAX_RETRIES - 1:
                raise
            wait = 2 ** attempt
            print(f"  Request error: {e}, retrying in {wait}s...")
            time.sleep(wait)
    raise RuntimeError(f"Failed after {MAX_RETRIES} retries: {url}")


def get_all_stores(session):
    """Fetch all stores from the API (paginated at 1000/page)."""
    print("Fetching all stores...")
    stores = list(paginate(session, f"{BASE_URL}/game-stores/", {}, page_size=1000))
    print(f"  Fetched {len(stores)} store entries")
    return stores


def get_events(session, store_id):
    """Fetch all Lorcana events for a specific store."""
    return list(paginate(session, f"{BASE_URL}/events/", {
        "game_slug": "disney-lorcana",
        "store": store_id,
    }))


def get_registrations(session, event_id):
    """Fetch registrations for a single event."""
    return list(paginate(session, f"{BASE_URL}/events/{event_id}/registrations/", {}))
