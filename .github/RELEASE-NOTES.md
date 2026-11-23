Development preview of Foldback Server 0.4.0 with read-only Planning Center Live synchronization. See README and CHANGELOG for implemented features and limits.

Select a service type, plan and specific service time. The server follows PCO item advances, skips and backtracking; refreshes running-order edits, per-service lengths and names; preserves original starts through restarts; and marks last-known data stale while reconnecting. It never advances or writes a PCO service.

**Real church-account/campus validation remains required. ProPresenter playback integration is still unfinished.** Automated checks and browser testing use invented API fixtures.

Download `foldback-update`, `update.json`, the versioned update archive and `SHA256SUMS`, then follow [the update guide](https://github.com/CLAChurch/foldback-server/blob/main/docs/UPDATES.md). Existing 0.2.0 installations need the one-time updater bootstrap. This prerelease uses `sudo foldback-update --install v0.4.0`; `latest` follows stable releases only.

[Corporate Codex Markdown handoff](https://github.com/CLAChurch/foldback-server/blob/main/docs/CORPORATE-HANDOFF.md)

The tag workflow builds application packages, not a USB ISO. The existing 0.2.0 installer and matching sources remain attached to the [0.3.0 release](https://github.com/CLAChurch/foldback-server/releases/tag/v0.3.0), retaining their own version and validation record. Preserve all matching sources, checksums and notices when sharing that ISO.
