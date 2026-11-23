# Remaining production work

This repository includes the application and a Debian 13 offline appliance-image build. PCO Live synchronization is implemented; real-account/hardware validation and ProPresenter playback remain pending. The resulting installer is for pilot evaluation, not a replacement for the operational foldback system yet.

## Planning Center: account-backed validation

Implemented in 0.4.0: service-type/plan/service-time selection, persisted campus defaults, read-only Live polling, per-service item lengths/exclusions, assignments/person-note fallback, pagination, API pacing/backoff, stale state, edit reconciliation and original-start recovery. Automated and browser checks use invented records; they do not establish real church-account behavior.

1. Connect the church account through the secure campus UI; do not place credentials in chat, Git or handoff files.
2. Use a non-production plan with two specific service times. Compare actual PCO ItemTime starts, lengths/exclusions and planned finish with the app.
3. Verify direct-person and position-based assignments, partial/declined times and the selected Person-note category against actual API responses and permissions.
4. Advance, skip, backtrack, retake and reorder/edit later items in PCO. Confirm the original active start and video override/context remain correct.
5. Close/log out of the panel, disconnect Internet, restart mid-item and complete a service. Verify the independent TV recovers the right selected gathering and start.

Follow [PCO-LIVE.md](PCO-LIVE.md) for details and account-backed acceptance checks. The app only reads PCO Services; advancing an operational gathering remains in PCO Live.

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

Complete the account-backed PCO checks, physical appliance validation and ProPresenter integration/routing tests before replacing an operational foldback system.
