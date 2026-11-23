#!/usr/bin/env python3
"""Set predictable unattended menu timeout without changing the installed system."""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

def finalize(source, destination):
    tool = os.environ.get('XORRISO', 'xorriso')
    paths = ['/isolinux/isolinux.cfg', '/isolinux/live.cfg', '/boot/grub/config.cfg', '/boot/grub/grub.cfg', '/sha256sum.txt']
    with tempfile.TemporaryDirectory(prefix='foldback-iso-') as temporary:
        temporary = Path(temporary)
        local = {path: temporary / Path(path).name for path in paths}
        # Two grub files have different basenames; no destination collisions.
        arguments = [tool, '-osirrox', 'on', '-indev', str(source)]
        for path in paths: arguments += ['-extract', path, str(local[path])]
        subprocess.run(arguments, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for p in local.values(): p.chmod(0o644)
        p = local['/isolinux/isolinux.cfg']
        p.write_text(re.sub(r'^timeout\s+\d+', 'timeout 50', p.read_text(), flags=re.M))
        p = local['/boot/grub/config.cfg']
        p.write_text(p.read_text() + '\nset timeout=5\n')
        for path in ['/isolinux/live.cfg', '/boot/grub/grub.cfg']:
            p = local[path]
            lines = p.read_text().splitlines()
            p.write_text('\n'.join(line + ' console=ttyS0,115200n8 console=tty0' if
                (line.lstrip().startswith('append ') or line.lstrip().startswith('linux\t')) else line for line in lines) + '\n')
        checksum = local['/sha256sum.txt'].read_text()
        for path in paths[:-1]:
            digest = hashlib.sha256(local[path].read_bytes()).hexdigest()
            checksum = re.sub(r'^[a-f0-9]{64}  \.' + re.escape(path) + r'$', digest + '  .' + path, checksum, flags=re.M)
        local['/sha256sum.txt'].write_text(checksum)
        arguments = [tool, '-indev', str(source), '-outdev', str(destination), '-boot_image', 'any', 'replay']
        for path in paths: arguments += ['-map', str(local[path]), path]
        subprocess.run(arguments + ['-commit', '-end'], check=True)

if __name__ == '__main__': finalize(Path(sys.argv[1]), Path(sys.argv[2]))
