#!/usr/bin/env python3
"""Package a validated appliance build for GitHub, or split its Debian sources."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

CHUNK = 1024 * 1024 * 1024

def sha(path):
    with path.open('rb') as incoming:
        return hashlib.file_digest(incoming, 'sha256').hexdigest()

def write_checksums(output, files):
    (output/'ISO-SHA256SUMS').write_text(''.join(
        f'{sha(path)}  {path.name}\n' for path in files))

def prepare(source, output):
    source, output = Path(source), Path(output)
    if not source.is_file(): raise ValueError('Supply the matching Debian source archive')
    output.mkdir(parents=True, exist_ok=True)
    parts = []
    with source.open('rb') as incoming:
        index = 1
        while incoming.peek(1):
            part = output/(source.name + f'.part{index:03d}')
            remaining = CHUNK
            with part.open('wb') as outgoing:
                while remaining and (block := incoming.read(min(remaining, 1024 * 1024))):
                    outgoing.write(block); remaining -= len(block)
            parts.append(part); index += 1
    write_checksums(output, parts)
    (output/'SOURCE-PARTS.txt').write_text(
        'All source parts are required. Keep them with the matching ISO and notices.\n'
        'From the directory containing the downloaded parts:\n\n'
        'sha256sum --check ISO-SHA256SUMS\n'
        f'cat {source.name}.part* > {source.name}\n\n'
        'Rejoined source archive SHA256:\n' + sha(source) + '  ' + source.name + '\n')
    return parts

def prepare_build(build, validation, output, version):
    prefix = f'foldback-server-{version}'
    names = [f'{prefix}-debian13-amd64.iso', f'{prefix}-app-source.tar.gz',
             f'{prefix}-build-config.tar', f'{prefix}-debian-sources.tar']
    if (build/'BUILD-STATUS').read_text().strip() != 'BUILD_COMPLETE':
        raise ValueError('The appliance build did not finish')
    checks = {name: digest for digest, name in
              (line.split() for line in (build/'SHA256SUMS').read_text().splitlines())}
    for name in names:
        if sha(build/name) != checks.get(name):
            raise ValueError(f'Build checksum mismatch for {name}')
    receipt = json.loads((validation/'ISO-VALIDATED.json').read_text())
    if receipt != {'version': version, 'sha256': checks[names[0]]}:
        raise ValueError('VM validation must cover this exact ISO and application version')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Use an empty release output directory')
    copied = [build/name for name in names[:-1]]
    copied += [build/name for name in ('APPLIANCE-TEST-RESULTS.txt', 'debian-packages.txt',
                                      'USB-INSTRUCTIONS.txt', 'LICENSE', 'NOTICE')]
    copied += [validation/name for name in ('BOOT-METADATA.txt', 'VM-VALIDATION.txt')]
    for path in copied:
        if not path.is_file() or path.stat().st_size >= 2 * CHUNK:
            raise ValueError(f'Missing file or GitHub asset size limit exceeded: {path}')
    parts = prepare(build/names[-1], output)
    for path in copied:
        shutil.copyfile(path, output/path.name)
    write_checksums(output, [output/path.name for path in copied] + parts +
                    [output/'SOURCE-PARTS.txt'])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--validation', type=Path)
    parser.add_argument('--version')
    args = parser.parse_args()
    if args.validation:
        if not args.version:
            parser.error('--validation requires --version')
        prepare_build(args.source, args.validation, args.output, args.version)
    else:
        if args.version:
            parser.error('--version requires --validation')
        for part in prepare(args.source, args.output):
            print(part)
