# P9 Research: source-discovery checkpoint

This checkpoint adds one real, bounded search-provider path. It does **not** complete the Research family in `implementation-spec.md` §269.

- The owner configures a loopback SearXNG HTTP endpoint in Research. The Control API persists the endpoint and a revision. A staged preview binds that revision; a changed endpoint invalidates confirmation. Disabling the provider blocks new searches but does not invalidate an already recorded request receipt.
- The Research page and explicit natural-language command stage an exact topic, require confirmation and the native tier-2 policy, then persist the project and at most ten unique search results. The source records contain search-index snippets with `retrievedAt: null`, zero reliability and no findings or artifacts. The UI labels them unverified. The API never calls a result URL.
- Search requests have a 12-second deadline, a 512 KB streaming response cap and no automatic retry. Provider failure, JSON-disabled, rate-limit, timeout and restart interruption are recorded without claiming completed research. Owner-scoped reads survive reload. The request key prevents duplicate provider submission on replay.
- The existing Hermes dashboard adapter has no structured Research project/source write API. This checkpoint therefore uses a local provider and SQLite storage. SearXNG must be run separately and configured by the owner; no live provider was contacted in this worktree.

Still required for full Research: selectable/configurable real search and browser providers (and keys where applicable), controlled page retrieval, source verification, findings with cited evidence, result synthesis and durable result storage, meaningful provider budgets/limits, and live owner-browser/provider verification. The current source list is discovery material, not a finished research answer.

Local fixtures: focused API and UI tests, API/Web TypeScript, contracts check, ESLint and app build are the checkpoint gates. No D: installation, external call, paid provider or production round trip was performed.
