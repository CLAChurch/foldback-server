# Planning Center Live synchronization

Version 0.4.0 implements read-only Services synchronization. Automated checks and browser tests use invented API records. A real church-account validation is still required before operational use.

## Connect and choose the gathering

1. Open `/admin` on the campus server and sign in. Use trusted HTTPS from another LAN computer.
2. In **Connections**, enter this installation's OAuth application details, sign in with PCO and test access. For an internal integration within one church organization, a personal token can be used instead. Never put credentials in an issue, chat, Git commit or handoff document.
3. In **Choose a service to follow**, choose the service type, plan and **specific service time**. Only `service` times are offered; rehearsal and `other` times are excluded. Recent/upcoming plans start seven days back; the checkbox expands that to the past year.
4. Choose **Follow PCO Live**. The chosen IDs and service-type default are saved on this server. Advance the gathering in Planning Center as usual.

The producer can close the control panel or log out. The server continues polling and the TV receives its own event stream. Restarting the server requires a new producer login but resumes the saved PCO selection without one.

**Stop following** clears the local selection and display, without changing the service in PCO. Sample controls become available again. Changing connection credentials or verifying a different organization invalidates the previous selection to avoid mixing churches.

## Timing and reconciliation

The adapter reads the selected plan's items with ItemTime, ItemNote and ItemAssignment associations. It uses the selected PlanTime's planned `ends_at` and each included item's selected-service `ItemTime.length`. If an effective length is absent, the documented item length plus ItemTime offset is used. Headers, pre/post-service items and items excluded from that service time do not enter the running order or later-duration sums.

The Live association's `current_item_time` identifies the current item, service time and original `live_start_at`. Missing related timing is fetched through the documented association. If Live is unavailable with HTTP 404, a single unambiguous open ItemTime for the selected gathering can recover the current item. Multiple open records are treated as ambiguous; the adapter does not guess. An explicit empty Live current-item relationship is respected.

No start is invented from local polling time. A temporarily absent start can use the persisted value only for the same current item, ItemTime and selected service time. A real skip/backtrack/retake uses the start PCO provides. Later edits and reorder changes keep the original active start and video context. Overrides are keyed by organization, service type, plan and item ID, and survive renaming/reordering and service-time changes within a plan.

While PCO is on another gathering, a header, an excluded item, or a pre/post-service item, the display shows an explicit waiting state instead of a fabricated running clock. Completion clears the active countdown. The selected plan remains visible in the producer running order.

## People and note privacy

The three producer modes remain **Scheduled person, then item note**, **Scheduled person only**, and **Item note only**. Now and Next resolve separately.

A direct Person assignment resolves from the Services Person record. A TeamPosition resolves against the selected plan's scheduled team members, matching team ID and exact position name, restricted to the selected service time and excluding declined times. Multiple matches are listed together; one person is not arbitrarily picked. An unresolved assignment remains blank, allowing the configured note fallback. Roster/person HTTP 403 errors produce a producer warning while core live timing continues when accessible.

Only the selected Person-note category and resolved display names are persisted in normalized items. Other note categories, raw roster records, private emails and provider credentials are not returned in display state. Change the configured note field or resolution mode to trigger a fresh snapshot.

## Polling and failure handling

Live is normally read about every two seconds. Plan, service-time, running-order and assignment snapshots refresh about every ten seconds. Large paginated rosters/plans and API pacing can make a full cycle longer. Reads are serialized with OAuth refresh and configuration operations so tokens cannot race. A producer operation waits for the current background cycle, then pauses scheduling until it completes.

All Services requests are GET. The adapter never calls the Live control actions or creates/updates PCO plans. OAuth token exchange/refresh uses its separate POST endpoint.

Pagination follows at most 50 pages per collection, validates origin/path and rejects repeated pages or duplicate primary records. HTTP requests have a ten-second timeout and read transactions have a thirty-second deadline. Incomplete/ambiguous snapshots are not partially committed.

The client pins Services API version `2018-11-01`, reads rate headers to pace requests, honors HTTP 429 `Retry-After`, and uses exponential retry up to a minute between normal failure retries. Long provider retry windows remain blocked, checked in bounded timer chunks. Last-known data remains visible; elapsed clocks continue from their UTC timestamp. Missing successful data for fifteen seconds, or an explicit failure, shows a stale warning. Reconnection loads a fresh snapshot and clears the warning. A failed manual connection test leaves an existing service eligible for automatic recovery; new selections still require verified access.

Heartbeat timestamps update in memory. Durable writes happen for meaningful service changes, selections and overrides, avoiding an fsync on every unchanged polling heartbeat. Startup marks cached PCO state disconnected until a successful read.

## Account-backed pilot validation

Use a non-production PCO test plan/time under the church account. Record the campus, PCO permissions and app version; redact credentials and unrelated people/notes from shared evidence.

1. Confirm service/plan/time selection and correct service-specific durations and exclusions with at least two gatherings in the same plan.
2. Take an item live in PCO and compare its original start with the app's clock. Edit a later duration, reorder later items, skip, backtrack and retake an item; confirm expected elapsed timing.
3. Check direct-person, team-position, unconfirmed/declined/split-time assignments and the chosen Person-note category. Confirm the real API's scheduling fields match the documented mapping.
4. Close/log out of the producer panel. Advance in PCO and verify the independent TV changes. Restart the server mid-item and verify the same original start is recovered.
5. Simulate Internet loss during a flagged video. Confirm stale warning, continuing estimate, retained overrides and automatic recovery. Confirm completion and a switch to another gathering do not leave a false live countdown.
6. Test ProPresenter web-fill routing and direct HDMI/DisplayPort on the actual hardware separately. The playback telemetry connector is still unimplemented.

## Official references

- [Plan and associations](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/plan)
- [Live and current_item_time](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/live)
- [ItemTime](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/item_time), [PlanTime](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/plan_time)
- [ItemAssignment](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/item_assignment), [PlanPerson](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/plan_person)
- [Rate limits](https://api.planningcenteronline.com/docs/overview/rate-limiting), [API versioning](https://api.planningcenteronline.com/docs/overview/versioning)
