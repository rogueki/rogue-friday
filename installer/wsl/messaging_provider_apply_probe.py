"""Apply only validated Hermes provider environment fields under its pinned runtime."""
import json
import sys


def apply(request):
    from hermes_cli.credential_lifecycle import remove_provider_env_credential, save_provider_env_credential
    from hermes_cli.config import load_env

    done = 0
    attempted = False
    try:
        for field, value in request["values"].items():
            attempted = True
            if value is None:
                result = remove_provider_env_credential(field)
            else:
                result = save_provider_env_credential(field, value)
            if not isinstance(result, dict) or result.get("ok") is not True or \
                    (value is None and field in load_env()) or (value is not None and load_env().get(field) != value):
                raise RuntimeError("Hermes credential persistence not confirmed")
            done += 1
    except Exception:
        return {"state": "partial" if done else "uncertain" if attempted else "rejected", "appliedFields": done}
    return {"state": "saved", "appliedFields": done}


if __name__ == "__main__":
    try:
        print(json.dumps(apply(json.load(sys.stdin))))
    except Exception:
        print(json.dumps({"state": "rejected", "appliedFields": 0}))
