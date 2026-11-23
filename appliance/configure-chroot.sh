#!/bin/bash
set -euo pipefail
useradd --system --user-group --create-home --home-dir /var/lib/foldback --shell /usr/sbin/nologin foldback
useradd --system --user-group --create-home --home-dir /var/lib/foldback-display --shell /usr/sbin/nologin foldback-display
chmod 700 /var/lib/foldback /var/lib/foldback-display
mkdir -p /etc/foldback /etc/X11 /etc/systemd/system/multi-user.target.wants
printf 'Etc/GMT+7\n' > /etc/timezone
ln -sf /usr/share/zoneinfo/Etc/GMT+7 /etc/localtime
printf 'en_CA.UTF-8 UTF-8\n' > /etc/locale.gen
locale-gen
printf 'LANG=en_CA.UTF-8\n' > /etc/default/locale
printf 'allowed_users=anybody\nneeds_root_rights=yes\n' > /etc/X11/Xwrapper.config
chmod -R a+rX /opt/foldback
cd /opt/foldback
node --test > /opt/foldback/APPLIANCE-TEST-RESULTS.txt 2>&1
python3 -m unittest discover -s /opt/foldback/appliance/tests >> /opt/foldback/APPLIANCE-TEST-RESULTS.txt 2>&1
dpkg-query -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n' > /opt/foldback/DEBIAN-PACKAGES.tsv
systemctl enable NetworkManager avahi-daemon foldback-init foldback foldback-output-watch foldback-console foldback-installer
systemctl disable getty@tty1.service 2>/dev/null || true
systemctl mask getty@tty1.service
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
systemctl disable apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
rm -f /etc/machine-id /var/lib/dbus/machine-id
touch /etc/machine-id
rm -f /var/lib/foldback/state.json /var/lib/foldback/state.json.tmp
