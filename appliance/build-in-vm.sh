#!/bin/bash
# Run as root inside an isolated Debian 13 amd64 build VM, not on a campus server.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
test "$(id -u)" = 0
test "$(dpkg --print-architecture)" = amd64
. /etc/os-release
test "$VERSION_CODENAME" = trixie
src=${FOLDBACK_SOURCE:-/source}
out=${FOLDBACK_OUTPUT:-/out}
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$src/package.json")
prefix="foldback-server-$version"
work=/var/tmp/foldback-live
mkdir -p "$out" "$work"
apt-get update
apt-get install -y --no-install-recommends live-build debootstrap xorriso isolinux syslinux-common syslinux-utils grub-pc-bin grub-efi-amd64-bin mtools dosfstools squashfs-tools rsync python3 ca-certificates
cd "$work"
if [ ! -f config/common ]; then
  lb config --mode debian --distribution trixie --architecture amd64 \
    --archive-areas main --binary-image iso-hybrid --debian-installer none \
    --bootloaders 'syslinux grub-efi' --uefi-secure-boot disable \
    --apt-recommends false --apt-secure true --firmware-chroot false --firmware-binary false \
    --security true --updates true --source true --source-images tar \
    --chroot-squashfs-compression-type gzip --chroot-squashfs-compression-level 3 \
    --image-name foldback-server --iso-volume FOLDBACK_SERVER \
    --iso-application 'Foldback Server installer' --iso-publisher 'Foldback Server contributors' \
    --bootappend-live 'boot=live components locales=en_CA.UTF-8 keyboard-layouts=us timezone=Etc/GMT+7 hostname=foldback-live'
fi
mkdir -p config/package-lists config/includes.chroot/opt/foldback config/hooks/live config/includes.binary
cp "$src/appliance/packages.list" config/package-lists/foldback.list.chroot
for item in src public test docs appliance tools .github README.md CONTRIBUTING.md SECURITY.md CHANGELOG.md package.json LICENSE NOTICE .gitignore; do
  rsync -a --exclude=__pycache__ "$src/$item" config/includes.chroot/opt/foldback/
done
rsync -a --exclude=__pycache__ "$src/appliance/rootfs/" config/includes.chroot/
cp "$src/appliance/configure-chroot.sh" config/hooks/live/0900-foldback.hook.chroot
chmod +x config/hooks/live/0900-foldback.hook.chroot config/includes.chroot/usr/local/bin/foldback-*
cp "$src/appliance/USB-INSTRUCTIONS.txt" config/includes.binary/README-FOLDBACK.txt
cp "$src/LICENSE" "$src/NOTICE" config/includes.binary/
lb build
iso=$(find . -maxdepth 1 -name '*.iso' -type f | head -n1)
test -n "$iso"
python3 "$src/appliance/finalize-iso.py" "$iso" "$out/$prefix-debian13-amd64.iso"
sources=$(find . -maxdepth 1 -name '*source.debian.tar*' -type f | head -n1)
test -n "$sources"
cp "$sources" "$out/$prefix-debian-sources.tar"
# linux-signed-amd64 sources contain signing metadata, not all kernel code.
kernel_version=$(chroot chroot dpkg-query -W -f='${Version}\n' 'linux-image-[0-9]*' | head -n1)
mkdir -p "$work/kernel-supplement/source/debian/l/linux"
(cd "$work/kernel-supplement/source/debian/l/linux"; apt-get --download-only source "linux=$kernel_version")
tar -rf "$out/$prefix-debian-sources.tar" -C "$work/kernel-supplement" source
build_config=$(find . -maxdepth 1 -name '*source.live.tar*' -type f | head -n1)
test -n "$build_config"
cp "$build_config" "$out/$prefix-build-config.tar"
tar -C "$src" --exclude=__pycache__ -czf "$out/$prefix-app-source.tar.gz" src public test docs appliance tools .github README.md CONTRIBUTING.md SECURITY.md CHANGELOG.md package.json LICENSE NOTICE .gitignore
cp "$src/LICENSE" "$src/NOTICE" "$src/appliance/USB-INSTRUCTIONS.txt" "$out/"
cp foldback-server-amd64.packages "$out/debian-packages.txt"
cp chroot/opt/foldback/APPLIANCE-TEST-RESULTS.txt "$out/APPLIANCE-TEST-RESULTS.txt"
cd "$out"
sha256sum "$prefix"-*.iso "$prefix"-*.tar* > SHA256SUMS
printf 'BUILD_COMPLETE\n' > BUILD-STATUS
