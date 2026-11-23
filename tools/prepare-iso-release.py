#!/usr/bin/env python3
"""Split a large corresponding-source archive for GitHub release assets."""
import argparse
import hashlib
from pathlib import Path
import shutil

CHUNK = 1024 * 1024 * 1024

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
    def sha(path):
        with path.open('rb') as incoming: return hashlib.file_digest(incoming, 'sha256').hexdigest()
    checks = ''.join(sha(p) + '  ' + p.name + '\n' for p in parts)
    (output/'ISO-SHA256SUMS').write_text(checks)
    (output/'SOURCE-PARTS.txt').write_text(
        'All source parts are required. Keep them with the matching ISO and notices.\n'
        'From the directory containing the downloaded parts:\n\n'
        'sha256sum --check ISO-SHA256SUMS\n'
        f'cat {source.name}.part* > {source.name}\n\n'
        'Rejoined source archive SHA256:\n' + sha(source) + '  ' + source.name + '\n')
    return parts

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    for part in prepare(args.source, args.output): print(part)
