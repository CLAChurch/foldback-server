# Updates, backups and recovery

Foldback Server application updates come from versioned GitHub releases. Run them manually outside service time. They briefly stop the server and direct display. There is no updater timer, background installation or automatic OS upgrade.

The default upstream is `CLAChurch/foldback-server`. Future stable updates can be installed with `sudo foldback-update --install latest`. Forks can supply their own `--repository OWNER/NAME`; that choice is saved after a successful online update. Public releases need no GitHub account or token on a campus server.

## Install the updater once on the 0.2.0 appliance

New image builds include `/usr/local/bin/foldback-update`. The existing 0.2.0 ISO predates it. On that appliance, log in locally as `campus-admin` and download these three assets from the **same** [published release](https://github.com/CLAChurch/foldback-server/releases):

- `foldback-update`
- `update.json` and `SHA256SUMS`
- `foldback-server-VERSION-update.tar.gz`

Use a USB if the appliance is offline. In the directory containing those files:

```sh
sha256sum --check SHA256SUMS
sudo install -o root -g root -m 0755 foldback-update /usr/local/bin/foldback-update
sudo foldback-update --archive ./foldback-server-0.3.0-update.tar.gz --manifest ./update.json
```

Replace the archive version for later releases. Verify checksums before installing the root-level updater. Checksums detect corruption; obtain the package and checksum file from the intended trusted repository/release. They are not an independent signing system.

Pair the appliance and create its control-panel password before updating. The updater expects the standard Debian appliance layout and local `/var/lib/foldback` storage, not a custom data mount or a development machine. It does not install Debian or Node packages.

## Check and install future versions

```sh
sudo foldback-update --repository CLAChurch/foldback-server --check
sudo foldback-update --repository CLAChurch/foldback-server --install v0.3.0
```

`--check` uses GitHub's latest stable release. If only prereleases exist, GitHub may return HTTP 404. Choose an explicit published tag for a development prerelease. Once a stable release exists, `--install latest` selects it. Read its release notes before running that command.

The updater downloads the manifest and archive over HTTPS, validates SHA256 and archive paths, checks Node.js and data-schema compatibility, and runs syntax checks/application tests as `foldback`, not root. It stops writers before taking a private backup, installs only the application and an allowlist of appliance helpers/units, then checks the running version through `/api/health`. A failed health check restores the old application, helper files and pre-update data. The updater does not modify `/etc/foldback/server.env`, TLS keys, network connections, passwords or Planning Center credentials.

Sessions live in memory, so producers sign in again after a restart. Saved settings and original sample live-start timestamps survive. Real PCO Live recovery is still pending the live integration.

## Rollback and interruption recovery

```sh
sudo foldback-update --rollback
```

Normal rollback retains current campus data, including settings changes and refreshed PCO tokens. It refuses to run if the previous code cannot read the current data schema. To deliberately restore the pre-update data snapshot instead:

```sh
sudo foldback-update --rollback --restore-state
```

This discards data changes since that snapshot, including credential changes. Restored provider refresh tokens may need reconnecting if the provider already rotated/revoked them. Rollback supports the most recent successful update, not an unlimited interactive version history.

If an update was interrupted after switching began, run:

```sh
sudo foldback-update --recover
sudo systemctl status foldback.service
```

Recovery uses the private transaction journal to restore the previous code and snapshot; interrupted manual rollback keeps its selected data-retention behavior. Recovery is manual after power loss. A failure before switching leaves the old installation in place. Keep the backup directory until recovery succeeds.

## Layout and private backups

| Location | Purpose |
| --- | --- |
| `/opt/foldback` | Original image application; retained for initial rollback |
| `/opt/foldback-releases/` | Root-owned installed release directories |
| `/opt/foldback-current` | Atomic symlink used after the first update |
| `/etc/systemd/system/foldback.service.d/10-release.conf` | Service override pointing at the selected release |
| `/var/lib/foldback` | Live campus state, mode 0700 |
| `/var/lib/foldback-updater` | Root-only snapshots, transaction and rollback records |
| `/etc/foldback` | Campus environment and TLS identity; untouched by updates |

For a separate disaster-recovery backup, stop the server while copying its data and configuration:

```sh
sudo systemctl stop foldback.service
sudo sh -c 'umask 077; tar -C / -czf /root/foldback-private-backup.tar.gz var/lib/foldback etc/foldback'
sudo systemctl start foldback.service
```

Transfer that archive to private storage. It contains credentials and private keys; never attach it to GitHub. Restore to the same appliance layout with the `foldback` account and original ownership/permissions. Use a code version compatible with the saved schema. Old release directories and snapshots are retained; inspect space usage and retain any active release and rollback target when cleaning up.

## Debian maintenance

Application updates do not upgrade the OS, kernel, Node.js or Chromium. In a separate maintenance window:

```sh
sudo apt update
sudo apt upgrade
```

Review package changes and reboot when required. The image disables automatic package timers to avoid unplanned service-time changes.

## Maintainer release process

1. Update `package.json`, `CHANGELOG.md`, and any compatibility metadata. Run `npm test` and `python3 -m unittest discover -s appliance/tests -v`.
2. Commit the exact release source. `python3 tools/build-update.py` rejects a dirty tree; `--allow-dirty` is for local testing only.
3. Push a matching `vVERSION` tag. The release workflow reruns tests, checks tag/version agreement, builds the small update assets, and creates a **prerelease**. Promote a release to stable only after the intended validation.
4. Test an offline update on the Debian appliance, state retention, startup-failure restoration, and rollback. Test physical campus hardware and integrations before calling a release production-ready.

The workflow builds application packages only. For a fresh USB ISO, use [BUILD.md](../appliance/BUILD.md), retain all matching sources/notices, and complete BIOS/UEFI offline-install validation. Old ISO downloads retain their original version; an app-update tag does not rebuild or revalidate them.

Each GitHub release asset must be smaller than 2 GiB. The Debian source archive can be larger, so split it using `tools/prepare-iso-release.py` and publish **all** parts plus `ISO-SHA256SUMS` and `SOURCE-PARTS.txt`. Rejoin and verify before using the source archive. Never commit ISO files, VM disks, generated campus state or private backups to Git.
