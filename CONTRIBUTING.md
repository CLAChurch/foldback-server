# Contributing to Foldback Server

Open an issue for a bug or proposed change, or submit a focused pull request. Include the observable problem, intended behavior and relevant validation. The [roadmap](docs/NEXT.md) lists unfinished integrations; the README distinguishes implemented behavior from plans.

## Local development

Use Node.js 20.19+ and npm; Python 3.11+ is needed for appliance tests and packaging. There are no npm dependencies or frontend build step.

```sh
npm start
npm test
python3 -m unittest discover -s appliance/tests -v
python3 tools/build-update.py --allow-dirty
```

The server binds to localhost by default. Pair with the code printed in its console and create a password. Use invented sample services or isolated fake-provider responses for tests. Do not advance a live Planning Center gathering while developing.

## Design rules

- Keep a campus installation independent of other campuses and hosted services.
- Use original live-start timestamps for clocks. Closing a producer browser must not stop timing.
- Keep PCO credentials on the server, outside Git, logs and browser-visible display state.
- Read PCO service data; advancing Live remains the operator's responsibility in PCO.
- Accept actual playback timing only when it maps unambiguously to the active item. Preserve estimate-only support for external players.
- Keep the web service unprivileged. Root-level appliance helpers must have narrow responsibilities and validated inputs.
- Keep stage text fixed and readable. Surface overflow in the preview instead of scrolling or silently shrinking typography.
- Make state migrations and rollback compatibility explicit in `package.json` release metadata.

Add meaningful tests for timing, authentication, persistence, integrations or installer safety changes. Run appropriate checks once they pass; pure documentation edits do not need new tests. Physical display and external-service claims require corresponding hardware/account checks, not just mocked tests.

## Pull requests and releases

Use a descriptive branch and PR title. Explain what changed, why and how it was verified. Keep generated `artifacts/`, data, credentials, certificates and VM files out of commits. Report vulnerabilities using [SECURITY.md](SECURITY.md), without posting secrets publicly.

Release maintainers follow [UPDATES.md](docs/UPDATES.md). Tag workflows publish development prereleases. Full Debian ISO builds and matching source redistribution are separate from application update releases.

By contributing, you agree that your original contribution is licensed under the project's MIT licence. Preserve third-party copyright and licence notices.
