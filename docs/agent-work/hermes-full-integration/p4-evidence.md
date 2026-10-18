# P4 Mail evidence (local implementation checkpoint)

## Implemented

- Friday-owned multiple IMAP/SMTP accounts with independent hosts, ports, logins, passwords, aliases, folders, account revision and default selection. Legacy Friday-managed Himalaya account migrates lazily without renaming user-defined accounts.
- Gmail desktop OAuth with PKCE and short-lived local loopback state; Microsoft public-client device authorization with explicit bounded polling. Google desktop client secret is optional in Google's documented public-client flow. Refresh tokens and granted scopes are write-only 0600 local files, never returned in account APIs. OAuth IMAP/SMTP uses XOAUTH2, fixed provider hosts, TLS, token rotation and local grant removal. `authorized` means the grant was stored, not that IMAP and SMTP have been verified; the separate check operations authenticate without sending.
- Account-scoped folders, search, read, attachment download, mark and move with UIDVALIDITY; compose, reply, reply-all, forward and attachments in dashboard; idempotent IMAP Drafts append without SMTP. Send has a durable pre-SMTP journal, uncertain outcome handling, Sent copy reconciliation without SMTP resend, and source account preserved through voice preview/confirm.
- Owner API, generated SDK, UI and synthetic tests. No real external authorization or email sending was performed.

## Local checks

- Contracts lint/validate/generated/breaking check: PASS at 234 operations.
- Control API and web TypeScript typecheck: PASS.
- Focused Control API Mail tests: 16/16 PASS (OAuth flow, route auth/callback, journal, voice and legacy compatibility).
- WSL Python mail helper tests: 8/8 PASS (account isolation, revisions, SMTP uncertainty, Sent archive, IMAP mutation, XOAUTH2 refresh/rotation/revoke and no-SMTP Drafts).
- Package lint scripts do not exist for Control API or web. Root owns the wider build and integration checkpoint.

## External gates and remaining limitations

- MAIL-03 and real-provider parts of MAIL-04 are NOT_RUN: no test mailbox, provider app registration or authorization was supplied, and the coding task did not authorize sending to an external recipient. Provider-specific consent, IMAP/SMTP availability, TLS/port/auth error messages and real Sent-folder behavior need controlled mailbox verification.
- Microsoft SMTP AUTH can be disabled at tenant or mailbox level despite a valid OAuth grant. The connection check must establish actual provider acceptance. Google Gmail full-mail scope can require provider verification/test-user setup.
- Generic accounts currently use one auth mode for both IMAP and SMTP, while host, port, login and password are separate. Mixed protocol auth modes, richer sync/polling preferences, automatic forwarding of original attachments, natural-language pronoun/ordinal corrections and controlled real-provider send tests remain outside this local checkpoint.

## Provider references

- Google desktop PKCE and optional client secret: https://developers.google.com/identity/protocols/oauth2/native-app
- Google refresh token exchange: https://developers.google.com/identity/protocols/oauth2/web-server
- Gmail XOAUTH2: https://developers.google.com/workspace/gmail/imap/xoauth2-protocol
- Microsoft IMAP/SMTP scopes: https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth
- Microsoft device code and `offline_access` refresh issuance: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code
