# Foldback Server — corporate Codex handoff

Prepared November 23, 2026. This is a self-contained project handoff for continuing development in a corporate Codex account. It contains no passwords, tokens, private keys or live church-account exports.

## Start here in the new account

The public repository is **https://github.com/CLAChurch/foldback-server**. The product name is **Foldback Server**. Read this document, clone the repository, and inspect the current version and working tree before making changes:

```sh
git clone https://github.com/CLAChurch/foldback-server.git
cd foldback-server
git status --short
git log -5 --oneline
node --version
python3 --version
npm test
python3 -m unittest discover -s appliance/tests -v
```

Use Node.js 20.19+ and Python 3.11+ for tooling. There are no npm dependencies, install step or frontend build. `npm start` serves the application at `http://localhost:3210/admin`; `/display` is the read-only stage view. The first pairing code is printed in the server console. Create a control-panel password of at least twelve characters. There is no default password or bundled PCO credential.

The current application version for this handoff is **0.4.0**, with PCO Live implemented. Check `package.json` and the repository's releases for subsequent changes. The original source/update release was 0.3.0. The existing bootable installer remains **0.2.0**, based on Debian 13. An app update does not rebuild or revalidate that ISO.

Use `codex/` for new development branches. The user explicitly requested publishing this work to the church's GitHub and producing this Markdown transfer document. Preserve unrelated changes and never publish campus state or credentials.

## Ownership and account separation

`CLAChurch` is currently a GitHub **personal account** registered using a church email; it has not been converted into an organization. The user may choose an organization later. The public repository already belongs to CLAChurch and must not silently move to the developer's personal account.

The previous development environment used an isolated church GitHub CLI profile and repository-local Git identity/credential configuration. Personal global Git settings were left unchanged. That local publishing profile is ignored and is **not** part of this handoff. Do not copy its token/keyring or place credentials in this file. Authenticate the corporate environment freshly to an authorized GitHub identity. A corporate Codex login does not itself grant GitHub write permission. Reading/cloning the public source needs no GitHub authentication.

If continuing with separate personal/church GitHub accounts, use repository-specific authentication or an isolated CLI configuration; avoid changing the personal account's global default. A later GitHub organization migration needs an explicit owner/admin decision. No GitHub plugin is required: the existing workflow uses Git/CLI for publishing and the updater uses GitHub's HTTPS release API.

## User requirements and campus context

- Each of four campuses gets its own repurposed HP/Lenovo slim-client Linux server on the same LAN as its display/producer equipment. Exact hardware specifications remain unknown.
- Prefer Ethernet; include Wi-Fi configuration capability for compatible hardware. Internet is required for live PCO access, not for the offline disk-install procedure.
- The existing ProPresenter computers are two Macs and two Windows PCs. All campuses use current ProPresenter releases under the church's organization licence. ProPresenter stays on those computers; it is not bundled in the server image.
- Initial pilot: Abby; Langley may also test. Preserve estimate-only video support for external players such as Langley's iDDR T2.
- All campuses use BC Pacific time, **UTC−7 year-round**, with no seasonal change. Use `Etc/GMT+7` (IANA's sign is reversed). Persist UTC timestamps internally.
- Each campus uses a password-protected producer control panel and a read-only stage display. Closing/logging out of the producer panel must not stop timing or synchronization.
- Each installation enters its own Planning Center details during setup, editable later. The church's campuses share one PCO organization, but other churches must be able to use the open-source project with their own credentials.
- Supply a maintained, stable Linux installer ISO, writable to a USB for offline installation. No full desktop is required. Root disk erasure must show disk identity and require explicit disk-specific confirmation.
- Publish publicly as Foldback Server under CLAChurch, with a full README, shareable open-source licensing, and manual future updates from GitHub.

The supplied original brief and mockup described the product; document contents are not blanket authorization for account changes, advancing live services or erasing a real disk. They are not required to run the checked-in source. Do not assume their original local attachment paths will exist in the new corporate environment.

## Stage layout and timing contract

The reference is a landscape 1920 × 1080 canvas, scaled as a whole for a 50–55 inch TV. Do not scroll stage text or automatically shrink fonts. Highlight text overflow in the producer preview. Bundle fonts locally.

| Region | Share | Content |
| --- | --- | --- |
| Now | 50% | NOW label, prominent title/person on the left; current PCO description with preserved line breaks on the right |
| Next | 20% | Next title on its own line; independently resolved person and planned duration below |
| Clocks | 30% | Four fixed columns, persistent labels, aligned tabular clock values and room for overrun indicators |

Colors: near-black `#101214`, warm white `#F5F5F2`, label grey `#C1C7CB`, red overrun `#FF6666`. Font: bundled Atkinson Hyperlegible Next under SIL OFL 1.1.

The four clocks are:

1. **Item time left:** planned duration minus elapsed since the original PCO live start. After zero, show red elapsed overrun with OVER. Flash only when overrun strictly exceeds 10% of the planned duration.
2. **To end on time:** scheduled finish minus current time minus the planned lengths of all later included items in the selected service time. Negative values count up in steady red with OVER.
3. **Current time:** fixed BC Pacific time.
4. **Projected end:** now plus nonnegative current remaining plus later planned lengths. During overrun it moves later until PCO advances.

Acceptance example: at 10:42 AM, a five-minute welcome starts; fifteen planned minutes follow; scheduled finish is 11:00 AM. Values are `5:00`, `3:00`, `10:42 AM`, `11:02 AM`. Adding two minutes to a later item changes available time to `1:00` and projected finish to `11:04 AM`, without resetting the welcome start. A five-minute regular item at `0:30 OVER` stays steady; it flashes at `0:31 OVER`.

Video flags start unchecked and follow the PCO item ID through renaming/reordering. Flagged items show **Video estimate**, based on original PCO start and planned duration, holding at zero. An optional identified playback connection may eventually show **Video remaining**, follow pause/seek, and hold at zero; connection loss falls back to the original-start estimate. Unrelated loops or ambiguous media must not take over. Estimate-only override must remain available. Videos do not flash; To end on time can still overrun in steady red.

## Implemented as of 0.4.0

- Standard-library Node HTTP/HTTPS server, password pairing, scrypt password hashes, sessions, origin checks, login throttling and session revocation.
- Producer UI, scaled TV display, overflow preview, shared timing engine, sample service, video overrides and independent server-sent events.
- Durable campus settings, original starts, selected PCO service time and overrides, with atomic writes/fsync and private file permissions.
- Per-install PCO OAuth with Services scope, PKCE, state/session/browser binding, durable refresh-token rotation; optional internal single-church personal token; Services organization verification.
- Authenticated PCO service-type/plan/service-time catalogs and a selector. Read-only server-side Live polling, per-service durations/exclusions, person/position/note resolution, edit reconciliation, skips/backtracking, waiting/completion, stale warnings, retries and restart recovery.
- Debian 13 amd64 main-only offline USB installer, BIOS/UEFI boot, unique hostname/TLS identity, auto-start systemd service, local NetworkManager configuration and optional minimal X/Chromium direct-TV kiosk.
- Manual GitHub/offline application updater with checksums, archive allowlist, compatibility checks, unprivileged preflight tests, private snapshots, health checks, automatic failed-start restoration, manual rollback and interruption recovery.
- GitHub CI for Node 20.19 and 24, and a version-tag workflow producing application-update **prereleases**. Private vulnerability reporting is enabled on the repository.

## PCO Live implementation details

`src/pco.mjs` owns credentials, OAuth, serialized reads, API version pinning (`2018-11-01`), response size/time limits, sanitized errors and rate pacing. Services requests are GET; only OAuth exchange/refresh uses its separate POST endpoint. Credentials never go to browser display state or source control.

`src/pco-live.mjs` owns catalog reads, snapshot loading, normalization and server-side polling. Live is normally polled every two seconds. Full plan/time/item/assignment snapshots refresh about every ten seconds, subject to API latency/pacing. User operations pause the background scheduler and wait for its current read cycle.

The selected `PlanTime.ends_at` defines scheduled finish. Items are filtered to `service_position=during`, non-header, non-excluded for the chosen service time. Use its `ItemTime.length`, with item length plus offset only if effective length is absent. The Live `current_item_time` supplies item/time identity and original `live_start_at`. A missing Live endpoint may fall back to one unambiguous open ItemTime; do not guess among multiple records. Missing starts never become local polling timestamps. Original starts and playback context survive unrelated edits; retakes use the new PCO start.

Direct Person assignments resolve from Services people. Team positions match exact team ID and position name against the selected plan's roster, restricted to the selected service time and excluding declined times. Multiple matching people are listed. Restricted roster/person access can use the configured Person-note fallback with a producer warning. Only that note category and resolved names enter normalized state; other staff notes/private emails are not exposed.

Persisted `pcoSelection` includes organization ID, service-type ID, plan ID and time ID. Changing credentials or verifying another organization invalidates the selection. Overrides use a service identity including organization/service type/plan plus item ID, so they follow items through edits and across service times in one plan. Do not silently reuse an old church's selection after changing accounts.

On outage, keep the last item/start and continue elapsed timing. Mark stale after fifteen seconds without fresh data or immediately on a read failure. Honor `Retry-After`, use rate headers, back off and reload a fresh snapshot after recovery. Stop/close aborts pending reads and prevents late state writes. Heartbeats update in memory; meaningful state changes are persisted, avoiding constant fsync churn.

The API guide is [PCO-LIVE.md](https://github.com/CLAChurch/foldback-server/blob/main/docs/PCO-LIVE.md). The key official references are [Plan](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/plan), [Live](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/live), [ItemTime](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/item_time), [ItemAssignment](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/item_assignment), [PlanPerson](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/plan_person), [rate limits](https://api.planningcenteronline.com/docs/overview/rate-limiting) and [versioning](https://api.planningcenteronline.com/docs/overview/versioning).

## What still requires work or external validation

The PCO integration is **implemented**, but its real church-account permissions and response behavior have not been verified against an actual gathering. Automated/browser checks use isolated invented records. Do not represent them as a successful real-account connection. Use a non-production plan with two service times to verify starts, exclusions, assignments, split/declined scheduling, edits, logout independence, network loss and restart recovery.

**ProPresenter playback telemetry is still unimplemented.** The model already rejects stale/ambiguous/unmapped playback and supports estimate fallback, but no real connector supplies that telemetry. Next work must identify media reliably; a countdown value alone is insufficient.

The candidate ProPresenter stage route is a web-page fill pointing at the campus `/display` URL. Actual second-foldback routing, embedded browser behavior, certificate trust and event-stream support need testing on current Mac and Windows installations. Direct TV mode must work when ProPresenter is closed.

Physical HP/Lenovo hardware, HDMI/DisplayPort, Wi-Fi chipsets/firmware, display reconnection, farthest-position readability and real service-time reliability remain unverified. Secure Boot is unsupported by the unsigned derivative ISO. Hardware requiring proprietary firmware is not included in this Debian-main-only build.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/server.mjs` | App lifecycle, HTTP/HTTPS routes, auth, admin/display API and SSE |
| `src/auth.mjs` | Pairing, password hashing and sessions |
| `src/store.mjs` | Atomic private state storage |
| `src/model.mjs` | Shared pure timing/person/display model |
| `src/pco.mjs` | PCO credentials, OAuth, safe/paced HTTP and serialized reads |
| `src/pco-live.mjs` | Catalogs, selected-service normalization and background Live sync |
| `src/hardware.mjs` | Detected physical output inventory |
| `public/app.mjs`, `public/pco.mjs`, `public/service-picker.mjs` | Producer UI and connection/service selection |
| `public/stage.mjs`, `public/display.mjs` | Preview and independent TV renderer |
| `test/` | Node tests; `test/fixtures/pco.mjs` contains invented provider records |
| `appliance/rootfs/` | Narrow root helpers and systemd unit templates |
| `appliance/tests/` | Disk-safety and updater/recovery tests |
| `appliance/build-in-vm.sh` | Debian 13 image/source build in an isolated Debian VM |
| `appliance/test-vm.py` | Disposable VM USB boot/install validation; never accepts physical disks |
| `tools/build-update.py` | App update archive, manifest, standalone updater and checksums |
| `tools/prepare-iso-release.py` | Split matching Debian sources into GitHub-sized assets |
| `.github/workflows/` | CI and tag-based application prerelease publication |

## Runtime, state and security

Development defaults: bind `127.0.0.1:3210`, state in ignored `data/state.json`. For LAN development set `HOST=0.0.0.0`; remote PCO credential entry requires HTTPS. Relevant environment variables are `HOST`, `PORT`, `FOLDBACK_DATA_DIR`, `FOLDBACK_TLS_CERT` and `FOLDBACK_TLS_KEY`.

On the appliance, root-owned code starts as unprivileged `foldback` through `foldback.service`. State is `/var/lib/foldback/state.json` (0600) in a 0700 directory. It contains the password hash, credentials/tokens, selection, settings, original starts and overrides. Credentials are protected by permissions, not encrypted at rest. Sessions are in memory, expire after twelve hours, and end on restart. Password changes revoke other sessions.

`/etc/foldback/server.env` configures HTTPS on LAN port 3210 and a restricted loopback display listener on 3211. `/etc/foldback/tls` holds this campus's unique TLS identity; `/ca.crt` supplies the public campus CA. Verify the console fingerprint before trusting it on producer/ProPresenter devices. Do not disable certificate validation to make a campus deployment work.

The loopback renderer listener serves only display/pairing/health/events, not admin or credential routes. A separate root output watcher applies saved direct/ProPresenter mode and connector settings. The web app does not execute arbitrary privileged shell commands.

Ethernet uses DHCP. Configure Wi-Fi locally using `sudo nmtui`. There is no SSH server in the appliance. The installer creates a separate `campus-admin` Linux password; it is not the producer control-panel password.

## Updates, rollback and release maintenance

The default upstream is `CLAChurch/foldback-server`. Run updates manually outside gatherings. Public downloads need no campus GitHub token. For the current development prerelease:

```sh
sudo foldback-update --install v0.4.0
```

Future stable releases use:

```sh
sudo foldback-update --check
sudo foldback-update --install latest
```

`latest` follows GitHub's stable release, not development prereleases or the branch head. With only prereleases it may report no stable release. Forks can set `--repository OWNER/NAME`; successful online updates save that choice. Updating from GitHub means downloading a published versioned release package, not blindly replacing code from `main`.

The 0.2.0 ISO predates the updater. Download the standalone `foldback-update`, `update.json`, versioned archive and `SHA256SUMS` from one release, verify the checksums, then bootstrap:

```sh
sha256sum --check SHA256SUMS
sudo install -o root -g root -m 0755 foldback-update /usr/local/bin/foldback-update
sudo foldback-update --archive ./foldback-server-0.4.0-update.tar.gz --manifest ./update.json
```

The updater validates archive paths/checksum, Node/data-schema compatibility and application tests under `foldback`; stops writers; snapshots private data; atomically selects a release; installs only allowed helpers/units; and checks `/api/health` for the expected version. A failed start restores old code and pre-update data. It preserves server environment, TLS identity and campus settings/credentials. Browser sessions must log in again.

```sh
sudo foldback-update --rollback
sudo foldback-update --rollback --restore-state
sudo foldback-update --recover
```

Normal rollback retains current settings/tokens if the old code supports their schema. `--restore-state` deliberately loses changes since the snapshot and may require provider reauthentication if an old refresh token was rotated. `--recover` uses the interrupted transaction journal. Rolling back to 0.3.0 preserves the additive state format but removes automatic PCO Live polling; the old app can show only cached/stale PCO state.

Original code stays in `/opt/foldback`; new releases are under `/opt/foldback-releases`, selected through `/opt/foldback-current` and a systemd drop-in. Root-only backups/journals live under `/var/lib/foldback-updater`. The updater expects the standard local data filesystem layout, not a custom data mount. App metadata currently uses appliance API 1 and state schema 1; changes for 0.4.0 are additive.

OS maintenance is separate: `sudo apt update` and `sudo apt upgrade` outside service time, then reboot when needed. Automatic package timers and sleep are disabled to avoid unexpected gathering-time changes.

To publish a future app update: bump `package.json`, update the changelog/docs and compatibility metadata, run tests, commit the exact source, then push a matching `vVERSION` tag. The tag workflow validates the version, reruns checks, builds `artifacts/update/`, and creates a prerelease. `python3 tools/build-update.py` rejects dirty source; `--allow-dirty` is only for local test builds. Validate a release before promoting it to stable. Never claim a source tag rebuilt the ISO.

## Installer artifacts and licensing

The existing VM-validated ISO is `campus-foldback-0.2.0-debian13-amd64.iso` (818,216,960 bytes), SHA256:

```text
9d70d04433ddc32211fd2072405d7e6898f7b00e2e7df0b5de6276156717f662
```

It is attached, with matching sources/notices, to https://github.com/CLAChurch/foldback-server/releases/tag/v0.3.0. The release tag is the app updater version; each installer/source asset retains its explicit 0.2.0 name. The matching Debian source archive is split into three parts because GitHub requires individual assets smaller than 2 GiB. Download all parts, verify `ISO-SHA256SUMS`, follow `SOURCE-PARTS.txt`, and preserve the matching app-source/build-config archives and notices. Do not commit ISOs, QCOW2 files or generated campus state to Git.

The Debian build is amd64/trixie stable plus security/updates, main only, with a kernel, Node, NetworkManager, a minimal X/Chromium kiosk, and offline filesystem-copy installation. BIOS and UEFI boots/install/reboots were VM tested. Recommended starting hardware is 4 GB RAM, 16 GB internal storage and an 8 GB USB, pending physical verification.

Build a new image only inside an isolated root Debian 13 amd64 VM with internet, around 4 GB RAM and 40 GB free disk. Mount the source at `/source`, output at `/out`, then run `bash /source/appliance/build-in-vm.sh`. This modifies the build VM. It does not authorize erasing any campus/user disk. Follow `appliance/BUILD.md` and validate fresh BIOS/UEFI USB boot, cancellation, offline installation, installed-disk boot with USB removed, output mode and state retention.

Original app/appliance scripts are MIT. The bundled font is SIL OFL 1.1. Debian/Linux/Chromium/Node/bootloader packages keep their own licences. The ISO aggregate is not wholly MIT licensed. Redistribute its matching corresponding Debian sources, including full unsigned kernel source as well as signing-wrapper sources, application/build source, checksums and notices. No ProPresenter licence/software or PCO subscription is included. This is a Debian derivative, not an official Debian image.

## Validation and next actions for the corporate account

Existing installer validation covers actual BIOS/UEFI USB boot, disk-erasure cancellation without disk changes, offline installation, installed-disk boot without USB, HTTPS/pairing, direct/ProPresenter local-renderer switching, and state after restart/power-off in VMs.

The app suite covers the clock acceptance examples, video safety/fallback, auth/session/origin checks, durable state and OAuth refresh. PCO Live checks cover read-only service catalogs/selection, per-service lengths/exclusions, direct/position/note names, independent producer logout, skips/retakes, missing starts, edits, outages/reconnect, pagination safety, rate limiting, restart, background polling, shutdown cancellation and cross-organization invalidation. Python checks cover disk selection/confirmation and update success/failure/rollback/recovery. Browser checks use invented records to select a gathering, follow an advance and show stale/recovered video timing.

Before relying on the app in a gathering:

1. Authenticate the corporate development environment freshly to the church GitHub owner/authorized identity. Read `README.md`, `docs/PCO-LIVE.md`, `docs/NEXT.md`, `docs/UPDATES.md` and `SECURITY.md` from the latest checkout.
2. Run the suites and inspect GitHub CI/release results. Keep any newly discovered failure as an open issue or fix; do not replace real-account evidence with mocked-test claims.
3. Connect PCO through the campus UI and validate the integration against a non-production plan/service time under the actual account. Never paste secrets into this document/chat or advance an operational gathering for a test.
4. Implement optional ProPresenter playback telemetry with unambiguous media identity and test actual Mac/Windows stage web-fill routing.
5. Inventory and test one physical slim client at Abby (and Langley if available), including outputs, Wi-Fi and restart/network recovery.
6. Once those pass, decide production-release readiness, promote an appropriate release to stable, and build/validate a new ISO when needed.

Keep the handoff and public status documentation current. The outstanding work is real-account/hardware validation and ProPresenter integration, not reimplementing the completed server, installer or updater.
