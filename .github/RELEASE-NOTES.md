Development preview of Foldback Server. See the README and changelog for implemented features and limits.

Select a service type, plan and specific service time. The server follows PCO item advances, skips and backtracking; refreshes running-order edits, per-service lengths and names; preserves original starts through restarts; and marks last-known data stale while reconnecting. It never advances or writes a PCO service.

**Real church-account/campus validation remains required. ProPresenter playback integration is still unfinished.** Automated checks and browser testing use invented API fixtures.

**Updating an existing server.** Use the release tag with `sudo foldback-update --install TAG`. The offline update uses `foldback-update`, `update.json`, the versioned update archive and `SHA256SUMS`. Existing 0.2.0 installations need the one-time bootstrap in the [update guide](https://github.com/CLAChurch/foldback-server/blob/main/docs/UPDATES.md).

[Corporate Codex Markdown handoff](https://github.com/CLAChurch/foldback-server/blob/main/docs/CORPORATE-HANDOFF.md)

**Fresh USB installation.** Download the versioned `-debian13-amd64.iso` and `ISO-SHA256SUMS`. Verify the ISO checksum and follow `USB-INSTRUCTIONS.txt`. Preserve the matching sources, checksums and notices when redistributing the image.
