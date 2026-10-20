#!/usr/bin/env python3
"""Read the pinned Hermes provider picker and optionally probe one model catalog."""

import json
import sys


def catalog(provider_id=None):
    from hermes_cli.models import _anthropic_catalog, _openai_catalog
    from hermes_cli.models_catalog_static import (
        CuratedFallbackModels, _PROVIDER_MODELS, listed_canonical_providers,
    )

    offered = listed_canonical_providers()
    providers = [{"id": item.slug, "label": item.label} for item in offered]
    if not any(item["id"] == "custom" for item in providers):
        providers.append({"id": "custom", "label": "Custom endpoint"})
    if provider_id is None:
        return {"providers": providers, "selected": None}
    if provider_id not in {item["id"] for item in providers}:
        raise ValueError("unknown_provider")

    # A catalog response is not a model-inference receipt. Only these two
    # pinned fetchers let us distinguish a successful endpoint query from a
    # curated fallback without issuing a paid inference request.
    probe_status = "unsupported"
    origin = "curated"
    candidates = list(_PROVIDER_MODELS.get(provider_id, []))
    if provider_id == "openai-api":
        live = _openai_catalog(provider_id, True)
        probe_status = "succeeded" if live else "failed"
        if live:
            candidates, origin = live, "endpoint_confirmed_picker"
    elif provider_id == "anthropic":
        live = _anthropic_catalog(provider_id, True)
        probe_status = "succeeded" if live and not isinstance(live, CuratedFallbackModels) else "failed"
        if probe_status == "succeeded":
            candidates, origin = live, "endpoint_confirmed_picker"

    models = list(dict.fromkeys(model for model in candidates if isinstance(model, str) and
                                1 <= len(model) <= 200 and not any(char.isspace() for char in model)))
    return {"providers": providers, "selected": {"id": provider_id, "models": models,
            "origin": origin, "probeStatus": probe_status, "modelAccess": None}}


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict) or set(request) != {"providerId"} or not (
            request["providerId"] is None or isinstance(request["providerId"], str)
        ):
            raise ValueError("invalid_request")
        print(json.dumps(catalog(request["providerId"])))
    except (ValueError, ImportError, OSError) as error:
        print(json.dumps({"error": str(error) if str(error) in {"invalid_request", "unknown_provider"}
                          else "catalog_unavailable"}))
        raise SystemExit(5)
