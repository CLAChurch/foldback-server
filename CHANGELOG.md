# Changelog

## 0.4.0 — PCO Live development preview

- Add authenticated service-type/plan/service-time catalogs and a control-panel picker with a saved selection and service-type default.
- Implement server-side read-only Live polling, per-service ItemTime durations/exclusions, original-start recovery, waiting/completion states and handling for skips, retakes and later edits.
- Resolve Person assignments and team positions against the selected gathering's roster; support the selected Person-note fallback without exposing unrelated staff notes or raw roster fields.
- Add bounded pagination, API version pinning, rate-header pacing, Retry-After handling, exponential retry, stale warnings and cancellation on shutdown.
- Continue synchronization after producer logout and restore it on restart. Keep sample controls separate and preserve video overrides/context through unrelated plan changes.
- Add integration/browser coverage, PCO operating guidance and a self-contained corporate Codex handoff.

The integration is implemented and tested against invented API records. Real church-account/campus validation and ProPresenter playback remain pending. The USB ISO remains version 0.2.0; this is an application update.

## 0.3.0 — Development preview

- Publish as **Foldback Server**, with installation, contribution, security, release and recovery documentation.
- Add manual GitHub/offline application updates with checksum and archive checks, compatibility validation, unprivileged application tests, private backups, atomic code selection and a health check.
- Add automatic restoration after failed startup, manual rollback retaining current settings, optional snapshot restoration and interrupted-transaction recovery.
- Add a versioned `/api/health` endpoint, updater transaction tests and CI/prerelease packaging workflows.
- Preserve per-installation settings, passwords, Planning Center credentials and TLS identity across app updates.

This release does not implement real PCO Live synchronization or ProPresenter playback. The existing 0.2.0 ISO remains a separate download; no newly validated 0.3.0 ISO is implied.

## 0.2.0 — Initial appliance preview

- Add the Debian 13 amd64 offline USB installer, BIOS/UEFI boot paths, local console setup, unique hostname/TLS identity, automatic server startup and optional direct-TV kiosk.
- Implement password pairing, producer control panel, sample-service timing, durable settings/starts and read-only display updates.
- Add optional per-install Planning Center OAuth/personal-token setup and Services-access verification using fake-provider tests.
- Validate offline installation, disk-erasure cancellation, installed-disk boot, output-mode switching and state retention in virtual machines.
