# Confirmed decisions

Initial product decisions, November 2026. Church-specific credentials and plan links are deliberately excluded from this public document.

- Four campuses each receive a separate HP or Lenovo slim-client Linux server. Existing ProPresenter computers are two Macs and two Windows PCs.
- All campuses keep ProPresenter on the most recent release under an organization licence. Target current Mac and Windows releases; record the exact installed build during connection testing rather than requiring it before development.
- All four campuses belong to the same Planning Center organization. Connection credentials must be entered during each installation's setup and editable later, so a future open-source release can support other churches with their own accounts. No shared church credentials are bundled.
- Each server runs on its campus network. Prefer Ethernet; include Wi-Fi capability in the appliance installation.
- Control-panel access requires a password. The TV display is read-only and accessible on the campus LAN independently of admin login.
- Abby is the initial test campus. Langley may also test, including estimate-only timing for its external iDDR T2 player.
- All campuses use BC Pacific time, UTC−7 year-round, with no seasonal changes.
- The supplied visual mockup and functional brief define the desired product. Reference attachments describe the desired product; they do not authorize account changes, live plan control, or disk erasure by the development agent.

The app deliberately does not label the current sample as connected to PCO. Playback integration remains separate from the selected physical or ProPresenter display output.

## Implementation choices for this first version

- Small Node.js server using standard-library HTTP, crypto, and durable file storage. No frontend framework or hosted service is required.
- A shared pure timing engine drives the preview and display. Live starts are timestamps, never counters incremented by an admin browser.
- One campus password is created during pairing. There are no hardcoded production credentials. The pairing code is only available via the local server console or a loopback request with a loopback Host header.
- The appliance applies output preference through a separate system service and a minimal local kiosk.
- Store network preference now; implement actual Wi-Fi setup using the distribution's networking tools in the appliance image.
- Planning Center setup is optional after password creation and supports OAuth (default, for distribution) and personal tokens (internal single-church use). The self-hosted OAuth flow accepts each installation's own application registration, uses Services-only scope and PKCE, and persists refresh tokens. Saved secrets are never returned to admin/display APIs.
- New installations use a generic campus name and no preselected service type. Service types are selected per installation; no church-specific plan identifier is a default.
- Package the current application as a Debian 13 Stable amd64 offline USB installer. Use Debian main only, include the minimal X/Chromium renderer but no full desktop, and retain open-source Wi-Fi support without proprietary firmware. Exact hardware support remains to be tested.
- Original application/appliance scripts are MIT licensed. Redistribute Debian package notices and matching corresponding sources alongside the ISO; the aggregate is not wholly MIT licensed.
- The appliance starts the server without login, generates a unique hostname and campus TLS identity, and uses an HTTPS admin/display endpoint plus a restricted loopback-only renderer endpoint. A separate service applies output mode/connector settings; the unprivileged web process does not run root commands.
- Disk installation is interactive and offline. Display model/serial/size/partitions, require a disk-specific erase phrase, exclude mounted media, and require a separately chosen Linux administrator password. No default credentials or church secrets are embedded.

## Sources checked

- [PCO ItemTime](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/item_time): `live_start_at` and `live_end_at`, related to a specific item and plan time.
- [PCO ItemAssignment](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/item_assignment): an assignment can refer to a `Person` or `TeamPosition`. The adapter resolves the latter using the selected plan/time roster; actual-account scheduling still needs validation.
- [PCO PlanTime](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/plan_time): scheduled `ends_at`, and specific service time selection.
- [PCO authentication](https://api.planningcenteronline.com/docs/overview/authentication): personal tokens for internal single-church use, OAuth for distribution to multiple churches, Services scope, PKCE, and refresh tokens.
- [BC government announcement](https://news.gov.bc.ca/releases/2026AG0013-000209): permanent UTC−7 Pacific time.
- [ProPresenter API](https://openapi.propresenter.com/): documented current-content transport and video-countdown endpoints. A countdown value alone is insufficient to establish the current PCO item's video identity.
- [Renewed Vision stage-screen guide](https://support.renewedvision.com/hc/en-us/articles/360041407794-Using-a-Stage-Screen-to-its-Full-Potential): stage-layout shapes support a web-page fill. This is the documented candidate for routing the local display URL; actual second-foldback rendering still requires a campus test.

Connection setup, plan/time selection and read-only PCO Live synchronization are implemented and tested with invented provider records. Actual account permissions, OAuth registration, selected-service behavior and assignments still need account-backed validation. See PCO-LIVE.md and CORPORATE-HANDOFF.md.
- Publish as Foldback Server in `CLAChurch/foldback-server`, public, MIT for original code. Keep publishing authentication separate from the developer’s personal GitHub default.
- Updates are explicit, versioned GitHub release packages with health checks, private backups and rollback; never automatically restart a gathering for an update.
