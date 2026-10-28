#!/usr/bin/env python3
"""Report the installed Hermes provider catalog, auth types and declared key prefixes.

The installer must not invent provider knowledge: picker membership, auth types,
environment variables and key prefixes all come from the pinned Hermes source.
Runs inside Hermes' runtime.
"""

import json
import re
import sys

NAME = re.compile(r"[A-Za-z0-9_.-]{1,64}")


def capabilities(names):
    from hermes_cli.auth import KNOWN_PROVIDER_KEY_PREFIXES
    from hermes_cli.models_catalog_static import listed_canonical_providers
    from hermes_cli.providers import get_provider, normalize_provider

    offered = {entry.slug: entry.label for entry in listed_canonical_providers()}
    providers = []
    for name in names:
        # get_provider() is the runtime resolver, not the picker contract: it maps
        # "openai" to an aggregator family and "kimi-coding" to its models.dev id.
        # The picker id therefore stays exactly as requested; the runtime alias is
        # reported separately instead of replacing it.
        definition = None
        try:
            definition = get_provider(name, allow_network=False)
        except (ValueError, KeyError, OSError):
            definition = None
        if definition is None and name not in offered:
            raise ValueError("unknown_provider")
        providers.append({
            "requested": name,
            "id": name,
            "label": offered.get(name, getattr(definition, "name", name)),
            "authType": getattr(definition, "auth_type", "custom_endpoint" if name == "custom" else "unknown"),
            "apiKeyEnvVars": list(getattr(definition, "api_key_env_vars", ()) or ()),
            "baseUrlEnvVar": getattr(definition, "base_url_env_var", "") or "",
            "offered": name in offered,
            "runtimeAlias": normalize_provider(name),
        })
    return {
        "providers": providers,
        "keyPrefixes": {key: list(value) for key, value in KNOWN_PROVIDER_KEY_PREFIXES.items()},
    }


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        if (not isinstance(request, dict) or set(request) != {"names"} or
                not isinstance(request["names"], list) or not 1 <= len(request["names"]) <= 8 or
                any(not isinstance(name, str) or NAME.fullmatch(name) is None for name in request["names"])):
            raise ValueError("invalid_request")
        print(json.dumps(capabilities(request["names"])))
    except (ValueError, ImportError, OSError) as error:
        message = str(error)
        print(json.dumps({"error": message if message in {"invalid_request", "unknown_provider"}
                          else "capability_unavailable"}))
        raise SystemExit(5)