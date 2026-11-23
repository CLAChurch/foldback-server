Development preview of Foldback Server. See the README and CHANGELOG for implemented features and limitations.

**Real Planning Center plan selection/Live synchronization and ProPresenter playback are still unfinished.** This is a pilot release.

The small application update is for an existing configured Debian appliance. Download `foldback-update`, `update.json`, the versioned update archive and `SHA256SUMS`, then follow `docs/UPDATES.md`. Existing 0.2.0 installations need the one-time updater bootstrap. Development prereleases require an explicit version tag when updating.

The tag workflow does not build a USB ISO. Any separately attached ISO and matching Debian sources keep their own version and validation record. Preserve matching sources, checksums and licence notices when sharing an ISO.
