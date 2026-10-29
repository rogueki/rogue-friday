"""List, approve and revoke Hermes gateway pairings through the native PairingStore; pairing codes never leave Hermes."""
import json
import re
import sys
from datetime import datetime, timezone

from gateway.pairing import PairingStore

PLATFORMS = ("telegram", "discord", "whatsapp")
REQUEST_ID = re.compile(r"[0-9a-f]{16}")
USER_ID = re.compile(r"[A-Za-z0-9@._:+-]{1,128}")


def text(value):
    return value[:128] if isinstance(value, str) else ""


def approved_at(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")
    return None


def snapshot(store):
    platforms = []
    for platform in PLATFORMS:
        # Legacy entries without a request id cannot be approved from a surface that never shows the code.
        pending = [{"requestId": str(entry["request_id"]), "userId": str(entry["user_id"]), "userName": text(entry.get("user_name")),
                    "ageMinutes": max(0, int(entry.get("age_minutes") or 0))}
                   for entry in store.list_pending(platform)
                   if REQUEST_ID.fullmatch(str(entry.get("request_id", ""))) and USER_ID.fullmatch(str(entry.get("user_id", "")))]
        approved = [{"userId": str(entry["user_id"]), "userName": text(entry.get("user_name")), "approvedAt": approved_at(entry.get("approved_at"))}
                    for entry in store.list_approved(platform) if USER_ID.fullmatch(str(entry.get("user_id", "")))]
        platforms.append({"platform": platform, "pending": pending[:50], "approved": approved[:200]})
    return {"platforms": platforms}


def main():
    request = json.loads(sys.stdin.read() or "{}")
    store = PairingStore()
    action = request.get("action") if isinstance(request, dict) else None
    if action == "approve":
        if store.approve_request(request["platform"], request["requestId"]) is None:
            print(json.dumps({"error": "pairing_request_not_found"}))
            return 4
    elif action == "revoke":
        if not store.revoke(request["platform"], request["userId"]):
            print(json.dumps({"error": "pairing_user_not_found"}))
            return 4
    elif action != "list":
        print(json.dumps({"error": "invalid_request"}))
        return 2
    print(json.dumps(snapshot(store)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
