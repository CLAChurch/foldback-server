#!/usr/bin/env python3
"""Test only NEW virtual-disk files. Never accepts a physical target device."""
import argparse
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import selectors
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SERIAL = 'FOLDBACK-VM-ONLY'
LINUX_PASSWORD = 'vm-linux-test-only-2026'
APP_PASSWORD = 'vm-app-test-only-2026'

def execute(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, text=True, **kwargs)

class VM:
    def __init__(self, args, log):
        self.log = open(log, 'wb')
        self.process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.buffer = ''

    def pump(self, timeout=1):
        for key, _ in self.selector.select(timeout):
            data = os.read(key.fd, 65536)
            if data:
                self.log.write(data); self.log.flush()
                self.buffer = (self.buffer + data.decode('utf8', errors='replace'))[-500000:]

    def expect(self, text, timeout=300):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if text in self.buffer:
                self.buffer = self.buffer.split(text, 1)[1]
                return
            if 'INSTALLATION STOPPED:' in self.buffer:
                raise RuntimeError('Installer failed; see VM serial log: ' + self.buffer[-2500:])
            if self.process.poll() is not None:
                raise RuntimeError('VM exited before expected text: ' + text + '\n' + self.buffer[-2500:])
            self.pump()
        raise TimeoutError('VM did not produce: ' + text + '\n' + self.buffer[-2500:])

    def send(self, value):
        self.process.stdin.write(value.encode()); self.process.stdin.flush()

    def command(self, value, marker='VM_COMMAND_DONE'):
        self.send(value + '; printf "\\n' + marker + '\\n"\n')
        self.expect('\r\n' + marker, 180)

    def wait_port(self, port, timeout=300):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            self.pump(.5)
            try:
                if self.process.poll() is not None: raise RuntimeError('VM exited during boot: ' + self.buffer[-2000:])
                # QEMU's forward accepts TCP before the guest has booted. Require HTTPS.
                # Bootstrap only the public CA from this isolated throwaway VM, with no
                # credentials, then verify its certificate on the actual status request.
                address = f'https://127.0.0.1:{port}'
                bootstrap = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                bootstrap.check_hostname = False
                bootstrap.verify_mode = ssl.CERT_NONE
                ca = urllib.request.urlopen(address + '/ca.crt', context=bootstrap, timeout=3).read().decode('ascii')
                trusted = ssl.create_default_context(cadata=ca)
                with urllib.request.urlopen(address + '/api/auth/status', context=trusted, timeout=3) as response:
                    assert isinstance(json.load(response)['configured'], bool)
                return
            except (OSError, ValueError):
                if self.process.poll() is not None: raise RuntimeError('VM exited during boot: ' + self.buffer[-2000:])
        raise TimeoutError('Server did not start on boot; see VM log')

    def stop(self):
        if self.process.poll() is None:
            self.process.terminate()
            try: self.process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.process.kill(); self.process.wait()
        self.log.close()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('iso', type=Path)
    parser.add_argument('--version', help='Expected Foldback application version')
    args = parser.parse_args()
    iso = args.iso.resolve()
    if not iso.is_file() or iso.suffix != '.iso': raise RuntimeError('An existing ISO file is required')
    qemu_dir = Path(os.environ['QEMU_DIR'])
    qemu = qemu_dir / 'bin/qemu-system-x86_64'
    image_tool = qemu_dir / 'bin/qemu-img'
    xorriso = os.environ.get('XORRISO', 'xorriso')
    build_dir = ROOT/'artifacts/build'
    release_dir = ROOT/'artifacts/release'
    build_dir.mkdir(parents=True, exist_ok=True)
    release_dir.mkdir(parents=True, exist_ok=True)
    receipt = release_dir/'ISO-VALIDATED.json'
    receipt.unlink(missing_ok=True)
    with iso.open('rb') as image:
        iso_sha256 = hashlib.file_digest(image, 'sha256').hexdigest()
    work = Path(tempfile.mkdtemp(prefix='vm-test-', dir=build_dir))
    proof = work / 'proof'; proof.mkdir()
    results = []
    def passed(message):
        results.append(message); print(message, flush=True)
        (release_dir/'VM-VALIDATION.txt').write_text('\n'.join(results) + '\n')

    metadata = execute(xorriso, '-indev', iso, '-report_el_torito', 'plain', '-report_system_area', 'plain', capture_output=True)
    text = metadata.stdout + metadata.stderr
    (release_dir/'BOOT-METADATA.txt').write_text(text)
    assert 'BIOS' in text and 'UEFI' in text
    passed('PASS: ISO contains BIOS and UEFI El Torito boot entries and hybrid disk metadata.')
    execute(xorriso, '-osirrox', 'on', '-indev', iso, '-extract', '/live', work/'live', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    kernel = next((work/'live').glob('vmlinuz*'))
    initrd = next((work/'live').glob('initrd*'))
    disk = work / 'target.qcow2'; blank = work / 'blank.qcow2'
    execute(image_tool, 'create', '-f', 'qcow2', disk, '16G', stdout=subprocess.DEVNULL)
    shutil.copyfile(disk, blank)
    base = [str(qemu), '-accel', 'tcg,thread=multi', '-cpu', 'max', '-smp', '2', '-m', '4096',
            '-display', 'none', '-monitor', 'none', '-serial', 'stdio',
            '-netdev', 'user,id=net0,restrict=on,hostfwd=tcp:127.0.0.1:43210-:3210', '-device', 'virtio-net-pci,netdev=net0',
            '-drive', f'file={disk},if=none,id=target,format=qcow2', '-device', f'virtio-blk-pci,drive=target,serial={SERIAL},bootindex=1',
            '-virtfs', f'local,path={proof},mount_tag=proof,security_model=none']
    active = None
    try:
        # Boot actual optical ISO boot paths before using a serial-console kernel for interaction.
        for firmware in ('BIOS', 'UEFI'):
            # Explicit USB boot priority avoids firmware ignoring an unindexed CD
            # when the target disk has a bootindex. This also matches USB deployment.
            command = base + ['-device', 'qemu-xhci,id=xhci', '-drive', f'file={iso},if=none,id=usbiso,format=raw,readonly=on',
                              '-device', 'usb-storage,drive=usbiso,removable=on,bootindex=0']
            if firmware == 'UEFI':
                variables = work/'iso-vars.fd'
                shutil.copyfile(qemu_dir/'share/qemu/edk2-i386-vars.fd', variables)
                command += ['-machine', 'q35', '-drive', f'if=pflash,format=raw,readonly=on,file={qemu_dir}/share/qemu/edk2-x86_64-code.fd', '-drive', f'if=pflash,format=raw,file={variables}']
            active = VM(command, work/f'iso-{firmware}.log')
            active.wait_port(43210)
            active.stop(); active = None
            execute(image_tool, 'compare', disk, blank, stdout=subprocess.DEVNULL)
            passed(f'PASS: Actual ISO boots as a USB disk via {firmware}; HTTPS starts without login and target disk stays unchanged.')
        active = VM(base + ['-cdrom', str(iso), '-kernel', str(kernel), '-initrd', str(initrd), '-append',
            'boot=live components locales=en_CA.UTF-8 keyboard-layouts=us hostname=foldback-live console=ttyS0,115200n8 foldback.console=serial systemd.mask=serial-getty@ttyS0.service'], work/'installation.log')
        active.expect('Choose 1, 2 or 3:')
        active.send('1\n'); active.expect('Disk number (Enter cancels):'); active.send('1\n')
        active.expect('Confirmation:'); active.send('CANCEL\n'); active.expect('Cancelled. No disk changes were made.')
        execute(image_tool, 'compare', '-U', disk, blank, stdout=subprocess.DEVNULL)
        passed('PASS: Wrong erase confirmation cancels; the virtual target still matches the blank disk.')
        active.expect('Choose 1, 2 or 3:'); active.send('1\n'); active.expect('Disk number (Enter cancels):'); active.send('1\n')
        active.expect('Confirmation:'); active.send(f'ERASE /dev/vda {SERIAL}\n')
        active.expect('Create the Linux campus-admin password (12+ characters):'); active.send(LINUX_PASSWORD + '\n')
        active.expect('Confirm Linux password:'); active.send(LINUX_PASSWORD + '\n')
        active.expect('INSTALL COMPLETE', 900)
        active.expect('Press Enter to shut down:'); active.send('\n')
        active.process.wait(timeout=120); active.stop(); active = None
        passed('PASS: Interactive offline installation completed on the new virtual disk, including BIOS and EFI bootloaders.')

        active = VM(base, work/'installed-BIOS.log')
        active.wait_port(43210)
        passed('PASS: Installed disk boots via BIOS with USB removed; HTTPS server starts before any login.')
        active.expect('login:'); active.send('campus-admin\n'); active.expect('Password:'); active.send(LINUX_PASSWORD + '\n')
        active.expect('$ '); active.send('sudo -S /bin/bash\n'); active.expect('password for campus-admin:'); active.send(LINUX_PASSWORD + '\n')
        active.expect('# ')
        active.command('export HISTFILE=/dev/null; mkdir -p /mnt/proof; mount -t 9p -o trans=virtio,version=9p2000.L proof /mnt/proof; cp /etc/foldback/tls/ca.crt /mnt/proof/ca.crt; curl -sf http://127.0.0.1:3211/api/pairing > /mnt/proof/pairing.json; node --version > /mnt/proof/node-version.txt')
        context = ssl.create_default_context(cafile=proof/'ca.crt')
        jar = http.cookiejar.CookieJar()
        client = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), urllib.request.HTTPCookieProcessor(jar))
        def api(path, body=None):
            request = urllib.request.Request('https://127.0.0.1:43210' + path,
                data=json.dumps(body).encode() if body is not None else None,
                headers={'Content-Type': 'application/json'})
            return json.load(client.open(request, timeout=30))
        installed_version = api('/api/health')['version']
        if args.version and installed_version != args.version:
            raise RuntimeError(f'Expected Foldback {args.version}, installed {installed_version}')
        passed(f'PASS: Installed Foldback application reports version {installed_version}.')
        assert not api('/api/auth/status')['configured']
        code = json.loads((proof/'pairing.json').read_text())['code']
        api('/api/auth/setup', {'code':code, 'password':APP_PASSWORD})
        api('/api/demo/load', {})
        started = api('/api/display')['service']['liveStart']
        admin = api('/api/admin')
        api('/api/settings', {**admin['settings'], 'output':'propresenter'})
        active.command('sleep 5; systemctl is-active foldback-kiosk > /mnt/proof/kiosk-propresenter.txt; pgrep -u foldback-display chromium > /mnt/proof/propresenter-chromium-pids.txt || true')
        assert (proof/'kiosk-propresenter.txt').read_text().strip() in ('inactive', 'failed')
        assert not (proof/'propresenter-chromium-pids.txt').read_text().strip()
        api('/api/settings', {**admin['settings'], 'output':'direct'})
        active.command('for i in $(seq 1 45); do pgrep -u foldback-display chromium >/dev/null && break; sleep 2; done; systemctl is-active foldback-kiosk > /mnt/proof/kiosk-direct.txt; pgrep -u foldback-display chromium > /mnt/proof/chromium-pids.txt; journalctl -u foldback-kiosk -n 100 --no-pager > /mnt/proof/kiosk.log')
        assert (proof/'kiosk-direct.txt').read_text().strip() == 'active'
        assert (proof/'chromium-pids.txt').read_text().strip()
        passed('PASS: Trusted HTTPS setup works; ProPresenter mode stops the local renderer and direct mode launches unprivileged Chromium.')
        active.command('systemctl restart foldback')
        active.wait_port(43210)
        assert api('/api/display')['service']['liveStart'] == started
        passed('PASS: Server restart preserves the original sample live start and saved campus state.')
        active.send('poweroff\n'); active.process.wait(timeout=120); active.stop(); active = None

        variables = work/'installed-vars.fd'
        shutil.copyfile(qemu_dir/'share/qemu/edk2-i386-vars.fd', variables)
        active = VM(base + ['-machine', 'q35', '-drive', f'if=pflash,format=raw,readonly=on,file={qemu_dir}/share/qemu/edk2-x86_64-code.fd', '-drive', f'if=pflash,format=raw,file={variables}'], work/'installed-UEFI.log')
        active.wait_port(43210)
        assert api('/api/display')['service']['liveStart'] == started
        assert api('/api/auth/status')['configured']
        passed('PASS: Installed disk also boots via UEFI with USB removed; state and campus password survive full power-off/reboot.')
        passed('LIMITS: Physical HP/Lenovo hardware, actual HDMI/DisplayPort, Wi-Fi firmware, PCO Live and ProPresenter routing are not verified by VM tests.')
    finally:
        if active: active.stop()
    receipt.write_text(json.dumps({'version': installed_version, 'sha256': iso_sha256}) + '\n')
    print('Validation logs: ' + str(work), flush=True)

if __name__ == '__main__': main()
