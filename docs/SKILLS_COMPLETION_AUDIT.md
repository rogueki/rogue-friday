# Skills and onboarding completion audit

Status: 2026-10-16, post-release improvement phase. This tracks the acceptance criteria in [SKILLS_ONBOARDING_PLAN.md](SKILLS_ONBOARDING_PLAN.md). A catalog entry or green structure test does not prove that a provider or skill can execute.

| ID | Status | Evidence and remaining condition |
| --- | --- | --- |
| SK-01 | Partial | The installed Hermes Dashboard and Control API return 105 Friday plus 53 Hermes entries, all observed as enabled. Package membership and current runtime state are distinguishable. Version and freshness coverage for every entry still need a direct contract check. |
| SK-02 | Partial | `/skills` is in the menu; search, source/status filtering, details, account links and guarded toggle exist. The installed `/skills` page returned HTTP 200. Authenticated desktop/mobile visual acceptance remains unverified. |
| SK-03 | Partial | API separates packaged, discovered and enabled; missing runtime data is unknown. Account setup, connection success, executable readiness and live test are not uniformly evidenced for every skill. |
| SK-04 | Partial | `friday-skills` has structured setup records for all 105 Friday IDs. Key Hermes-only standards now have hand-authored prerequisites, while other dynamic Hermes entries have no account/setup records. The phone summary now puts the dial provider before optional CardDAV. |
| SK-05 | Partial | Settings has Skills accounts and generic adapter setup/test forms. Real provider-specific verification and telephony account setup are not established. Unsupported integrations must remain visibly unconfigured. |
| SK-06 | Partial | A new owner is routed to a resumable wizard for name, goals, skills and accounts. The picker now includes both sources and persists the chosen name to the dashboard profile. Goals remain onboarding preferences; accounts remain explicitly unverified until a real connection test exists. |
| SK-07 | Partial | Voice reads the same catalog, can explain active/disabled/unknown states and guides an explicitly requested dialogue. It does not automatically welcome a new owner or configure provider accounts, and no spoken end-to-end acceptance has been run. |
| SK-08 | Partial | Friday workflows now document source-backed handoffs to bundled PowerPoint, Computer Use, Obsidian and coding CLI skills; WSL readiness probes check selected local prerequisites. No actual CLI coding, deck, desktop or vault action has been validated end to end. Telephony has no dial adapter in the current installation. |
| SK-09 | Partial | A targeted update of `D:\Kali\Friday` installed the Skills checkout and preserved the running dashboard/voice. A fresh isolated Windows installation remains unverified. |
| SK-10 | Pass for beta | Both `main` refs were pushed; the D: dashboard, onboarding and voice status returned HTTP 200, and the owner-authorized catalog returned 158 entries without errors. Core CI passed; the long Playwright job was still running at this audit. |
| SK-11 | Pass | Both repositories are public, MIT is recognized by GitHub, READMEs/descriptions were refreshed, and repository security/branch settings were verified. One low-severity transitive `esbuild` Dependabot alert remains open. |

The public beta release is valid for the working core. The original full onboarding/integration objective remains active until the partial and incomplete rows have adequate implementation and evidence. Paid media generation, account credentials, calling and external publishing are excluded from acceptance probes unless explicitly needed and authorized.
