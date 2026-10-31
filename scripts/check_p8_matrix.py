"""Read-only structural checks for the P8 evidence matrices; no source or CSV mutation."""
import csv
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1] / "docs" / "agent-work" / "hermes-full-integration"
CRITERIA = [
    "01_choice_source",
    "02_effective_readback_preexisting",
    "03_type_range_dependency_validation",
    "04_persistent_save_secret_handling",
    "05_actual_apply_restart",
    "06_domain_specific_observed_effect",
    "07_restart_persistence_effect",
    "08_concurrent_edit_conflict",
    "09_separate_load_save_apply_verify_errors",
    "10_discard_compensation",
    "11_accessible_mobile_usable",
    "12_natural_language_query_setup_change",
]


def read_csv(name: str) -> list[dict[str, str]]:
    with (BASE / name).open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


settings = read_csv("settings-runtime-map.csv")
areas = read_csv("dashboard-coverage.csv")
actions = read_csv("dashboard-action-nlp-coverage.csv")
assert len(settings) == 120, f"expected preserved 108 plus 2 STT, 5 conversation and 5 quiet-mode setting rows, got {len(settings)}"
assert len({row["field"] for row in settings}) == len(settings), "duplicate setting field"
voice_schema = json.loads((Path(__file__).resolve().parents[1] / "packages" / "contracts" / "schemas" / "settings" / "voice-settings.schema.json").read_text(encoding="utf-8"))
assert {row["field"].removeprefix("voice.") for row in settings if row["field"].startswith("voice.")} == set(voice_schema["properties"]), "voice matrix/schema mismatch"
assert all(all(key in row and row[key].strip() for key in CRITERIA) for row in settings), "missing ledger criterion cell"
area_ids = {row["area"] for row in areas}
assert len(areas) == 20 and len(area_ids) == 20, "dashboard area inventory must have 20 unique rows"
assert {row["area"] for row in actions} == area_ids, "action rows do not cover the same dashboard areas"
assert all(row["ui_action_family"].strip() for row in actions), "blank UI action family"
assert all(row["native_or_api_path"].strip() and row["natural_language_path"].strip() for row in actions), "action mapping must name a concrete path or NOT_MAPPED"
assert all(row["ui_action_trace"].strip() and row["intent_evidence"].strip() and row["operation_evidence"].strip() and row["parser_intent"].strip() for row in actions), "missing per-action evidence or explicit NOT_VERIFIED/NOT_MAPPED"
print(f"PASS: {len(settings)} unique settings, {len(CRITERIA)} exact ledger checks populated, {len(areas)} dashboard areas, {len(actions)} action rows mapped. Runtime/NLP acceptance is not tested.")
