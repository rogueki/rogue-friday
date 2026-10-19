"""Apply only validated Hermes provider environment fields under its pinned runtime."""
import json
import sys


def apply(request):
    from hermes_cli.credential_lifecycle import remove_provider_env_credential, save_provider_env_credential

    done = 0
    attempted = False
    try:
        for field, value in request["values"].items():
            attempted = True
            if value is None:
                remove_provider_env_credential(field)
            else:
                save_provider_env_credential(field, value)
            done += 1
    except Exception:
        return {"state": "partial" if done else "uncertain" if attempted else "rejected", "appliedFields": done}
    return {"state": "saved", "appliedFields": done}


if __name__ == "__main__":
    try:
        print(json.dumps(apply(json.load(sys.stdin))))
    except Exception:
        print(json.dumps({"state": "rejected", "appliedFields": 0}))
