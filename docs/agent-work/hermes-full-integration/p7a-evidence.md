# P7-A Hermes config bridge evidence

Pinned Hermes source: `d923a5eb487a17c0a68801bba9ef0f56c81040a8` in Friday-Ubuntu. Read-only probe on 2026-10-19 returned 58 local skill manifests and 2 user-installed plugin manifests. These are installed manifests, not proof that their dependencies, credentials or runtime tools work. A different source revision stays readable but the P7-A fields become unwritable until reviewed against that revision.

The bridge invokes only `hermes config path`, `get <allowlisted-key> --json` and `set <allowlisted-key> <typed-value>` without a shell or `--force`. Hermes `hermes_cli/subcommands/config.py` defines those supported commands. `hermes_cli/config.py:set_config_value` writes a single raw user-config leaf through Hermes validation and preserves the other YAML keys; `get_config_value` resolves the effective config. Friday separately hashes `config.yaml` into a numeric `If-Match` revision, rejects stale versions and checks the value by a subsequent `get`. The hash does not claim to cover environment or managed-overlay changes; those may alter an effective value without a file revision change. No provider secrets leave the bridge, and `model.api_key` reports only whether the config file has a value. Environment credential state remains unknown. The API requires an owner session, CSRF and `If-Match` for writes.

| Typed key | Pinned source consumer | Apply boundary |
| --- | --- | --- |
| `agent.max_turns` | `gateway/run.py:_current_max_iterations`, `hermes_cli/config.py:resolve_turn_limit` | Per-turn read is source-backed; active turn ACK unavailable. |
| `agent.gateway_timeout` | `gateway/run_turn.py` inactivity timeout and `gateway/run.py` env refresh | Active gateway ACK unavailable. |
| `agent.api_max_retries` | `agent/agent_init.py` and `agent/conversation_loop.py` | New agent construction; active agent ACK unavailable. |
| `session.terminal_continue` | `hermes_cli/terminal_breadcrumbs.py` | Next terminal continuation; active session ACK unavailable. |
| `max_live_sessions` | `tui_gateway/session_reaper.py:_max_live_sessions` | Reaper read is source-backed; active gateway ACK unavailable. |

All five fields return `verification: unverified` and `reasonCode: runtime_receipt_unavailable`; a successful write reports `persisted` by Hermes read-back and `applied: null`. Missing Hermes is returned as `installed: false`; a failed WSL/CLI probe is a 503, not an absence claim. The installed skill and plugin entries separately report installed, enabled and unknown configured/authenticated/available/needs-setup/unsupported state. Family `configFileSet` means an explicit YAML key; effective configuration remains unknown. Families are descriptors, not complete controls.

P7-B still owns providers, models, fallback and routing; P7-C owns the remaining agent/session/context controls and field-specific reload receipts; P7-D owns execution/browser/tool permissions; P7-E owns activation and configuration of installed skills/plugins/MCP; P7-F owns cron, gateway operations and logging. Before any later bundle reports verified application, it needs a consumer receipt for the exact field and runtime instance. A raw YAML value or Friday settings version is insufficient.

Local verification: read-only bridge probe against pinned Hermes; synthetic Python bridge fixture (3 tests); API service and route tests (5); contract checks and contract tests; web and Control API typechecks; lint on changed TS/TSX files. No live Hermes write, restart or provider call was made.
