# Building and sharing the appliance

Build in an isolated **Debian 13 (trixie) amd64 VM**, as root, with at least
4 GB RAM, 40 GB free disk, and internet access. Building modifies that VM and
downloads signed Debian packages and corresponding sources; it does not write
to campus disks. Hardware acceleration is helpful but not required.

Mount this source checkout read-only at `/source`, and an empty output directory
at `/out`, or set `FOLDBACK_SOURCE` and `FOLDBACK_OUTPUT` to equivalent absolute
paths. Then run:

```sh
bash /source/appliance/build-in-vm.sh
```

The build uses Debian live-build, `trixie`, `trixie-updates`, and
`trixie-security`, **main only**, with package signature verification enabled.
No proprietary firmware or non-free packages are requested. All runtime
dependencies, including the kernel, Node, network tools, and minimal X/Chromium
renderer, are inside the resulting squashfs. Installation copies that filesystem
offline, creates fresh disk UUIDs, and installs both BIOS and UEFI bootloaders.
Secure Boot is not supported by this unsigned derivative image.

Live-build generates separate matching Debian-source and build-configuration
archives after the binary ISO. The wrapper also adds the full unsigned Linux
kernel source corresponding to the signed kernel; signing-wrapper sources alone
are insufficient. A finalization step sets a five-second BIOS/UEFI boot-menu
timeout and updates the internal payload checksums while replaying the hybrid
boot metadata.
The build also emits the complete app/appliance source archive, package list,
MIT licence, third-party notice, USB instructions, and SHA256 checksums. Keep and
share those files together. The ISO itself is an aggregate with individual
package licences, not a relicensing of Debian/Linux/Chromium under MIT.

The app is checked under Debian's own security-maintained Node 20.19 package
during the chroot build. The build stops if the app or disk-safety tests fail.
`/opt/foldback/APPLIANCE-TEST-RESULTS.txt` records those results in the image;
`/opt/foldback/DEBIAN-PACKAGES.tsv` records installed binary/source versions.

Builds use the current stable/security archive contents, so a later rebuild may
contain newer security fixes. Keep the emitted package/source manifests with
each release. To change the app, modify the source and rebuild a fresh VM/work
directory; do not reuse a previously completed live-build chroot without cleaning
its build state.

Release validation must include inspecting El Torito/MBR/EFI boot metadata,
booting the ISO in a VM, checking cancellation before disk writes, installing
to an empty virtual disk, removing the ISO, rebooting from that disk, and testing
the server and kiosk. VM checks do not establish HDMI/DisplayPort or Wi-Fi
compatibility with a particular HP/Lenovo device; those remain hardware tests.

The automated host-side test is `appliance/test-vm.py <iso>`, with `QEMU_DIR`
pointing to a QEMU installation (containing `bin` and `share/qemu`) and optionally
`XORRISO` pointing to xorriso. It creates new disposable QCOW2 files only and
never accepts a physical disk. It boots the ISO as a USB disk in BIOS and UEFI,
then uses an isolated serial console for an offline install. Validation results
are written to `artifacts/release/VM-VALIDATION.txt`.
