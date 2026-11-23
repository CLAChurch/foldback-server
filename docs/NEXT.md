# Remaining production work

This repository includes the application and a Debian 13 offline appliance-image build. PCO Live synchronization and ProPresenter playback are still unfinished. The resulting installer is for pilot evaluation, not a replacement for the operational foldback system yet.

## Planning Center: verify before connecting

1. Use the new Planning Center setup form to connect Abby's account without placing credentials in chat or source files. OAuth is supported for distribution; personal tokens are for internal single-church use. The connection test verifies Services organization access only, not yet live plan data.
2. Select a concrete plan and a specific service time. Confirm access to the active item and that service time's original `live_start_at`, including after an app restart.
3. Inspect representative direct-person and position-based assignments. Resolve a position against the selected service's scheduled people. Confirm the desired Person note category.
4. Implement service-type / plan / service-time selection, campus defaults, pagination, polling/backoff/rate-limit handling, stale status, and change reconciliation. Exclude headings, before/after-service items, and items excluded from the selected service time from later-duration sums. Use per-service item lengths.
5. Retain current start and playback context through later edits and reorders. Handle skips, backtracking, and plan completion explicitly. Integration must only read PCO; advancing a real gathering stays in PCO Live.
6. Exercise multiple services in one plan, connection loss, and mid-service recovery against the actual account. Current tests verify the normalized timing model, not those external API behaviors.

## ProPresenter

- Target the current releases on Mac and Windows, as confirmed by Graham. Record Abby's exact build and platform when connecting, and verify the installed API behavior. Version information is no longer an outstanding prerequisite from Graham.
- Test a stage-layout shape with a web-page fill pointing at the server's `/display` URL, following Renewed Vision's documented stage-screen support. Confirm the embedded browser loads the page and event stream, then assign that layout to the second foldback output.
- Demonstrate the stable stage URL through the actual second-foldback routing on the Mac and Windows installations. Web rendering, frame policy, and output behavior must be proven on installed versions; a browser screenshot does not prove ProPresenter compatibility.
- Only enable actual remaining time when a uniquely mapped active video matches the current PCO item. Follow pause/seek/finish, expire old telemetry, fall back to original-start estimates after loss, and reject unrelated loops. Do not guess based on file names alone.
- Preserve estimate-only mode for Langley's iDDR T2 and other external playback.

## Appliance and release validation

Implemented: Debian 13 main-only offline USB installer, BIOS/UEFI boot paths, disk-specific erase confirmation, automatic systemd startup, unique hostname/TLS identity, local NetworkManager setup, optional X/Chromium kiosk and saved output selection. The 0.2.0 image passed VM boot/install/cancellation/output/reboot tests. Application updates now include checksums, compatibility checks, private backups, health checks and rollback.

Remaining:

- Inventory real slim-client CPU/RAM/storage, firmware, GPU, output connectors, Ethernet and Wi-Fi chipsets. Recommended hardware remains provisional until physical testing.
- Test HDMI and DisplayPort, reconnects, Ethernet/Wi-Fi recovery, certificate trust and stage readability at a pilot campus.
- Verify the update/rollback path on physical hardware and retain the per-release test results.
- Rebuild and validate a full image when OS/package changes are needed; app-update releases do not rebuild the ISO.
- Document tested Mac/Windows ProPresenter builds and actual second-stage-output routing.

The current prototype must complete PCO Live and ProPresenter integration before replacing an operational foldback system.
