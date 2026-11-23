# Security

Foldback Server is currently a development preview. Use it on a trusted campus LAN. Its TV display is intentionally readable without an admin login; the control panel requires pairing and a password. This version has no Internet-facing deployment or trusted reverse-proxy configuration.

Use HTTPS for remote credential entry and verify the campus CA fingerprint before trusting it. There is no default password. The Linux administrator password and control-panel password are separate. Planning Center tokens and passwords are never intended to appear in display state, issue reports or release packages.

Persistent state, TLS keys and updater backups contain secrets. They are permission-protected on disk, not encrypted at rest. Restrict access to the appliance and private backups.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** option when available. If private reporting has not been enabled, open a public issue containing only a request for a private reporting channel; do not include exploit details, credentials, private state, logs containing tokens or church account information. A maintainer will arrange a private channel. No response-time guarantee is currently offered.

If credentials were exposed, revoke them with the provider and replace them on affected campuses. Removing a local saved connection does not revoke the provider's tokens.

## Scope and updates

Security fixes target the current development source. Older preview builds have no long-term support commitment. Debian packages retain their own security maintenance; the application updater does not install OS updates. See [maintenance and recovery](docs/UPDATES.md).
