#!/usr/bin/env python3
"""Build a small versioned appliance update; never includes runtime campus data."""
import argparse
import hashlib
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader('foldback_update', str(ROOT/'appliance/rootfs/usr/local/bin/foldback-update'))
spec = importlib.util.spec_from_loader(loader.name, loader)
module = importlib.util.module_from_spec(spec); loader.exec_module(module)

def build(source, output, commit='working-tree'):
    source, output = Path(source), Path(output)
    package = json.loads((source/'package.json').read_text()); version = package['version']
    if not module.VERSION.fullmatch(version) or version.startswith('v'): raise ValueError('Invalid application version')
    output.mkdir(parents=True, exist_ok=True)
    name = f'foldback-server-{version}-update.tar.gz'; archive = output/name
    def clean(entry):
        if '__pycache__' in Path(entry.name).parts or entry.name.endswith('.pyc'): return None
        if entry.issym() or entry.islnk() or not (entry.isfile() or entry.isdir()): raise ValueError('Links and special files are not permitted in releases')
        entry.uid=entry.gid=0; entry.uname=entry.gname='root'
        entry.mode=0o755 if entry.isdir() or entry.name.startswith('rootfs/usr/local/bin/') else 0o644
        return entry
    with tarfile.open(archive,'w:gz') as bundle:
        for part in ['src','public','test','docs','README.md','package.json','LICENSE','NOTICE','.gitignore']:
            if (source/part).exists(): bundle.add(source/part, arcname='app/'+part, filter=clean)
        for part in sorted(module.ROOT_FILES):
            if (source/'appliance/rootfs'/part).exists(): bundle.add(source/'appliance/rootfs'/part, arcname='rootfs/'+part, filter=clean)
    schema = package.get('foldback',{}).get('stateSchema',{'min':1,'max':1})
    manifest = {'format':1,'application':'foldback-server','version':version,'archive':name,
        'sha256':module.digest(archive),'minimumNode':'20.19.0','applianceApi':1,'stateSchema':schema,'commit':commit}
    module.validate_manifest(manifest)
    (output/'update.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (output/'foldback-update').write_bytes((source/'appliance/rootfs/usr/local/bin/foldback-update').read_bytes())
    (output/'foldback-update').chmod(0o755)
    files=[name,'update.json','foldback-update']
    for document in ('CORPORATE-HANDOFF.md', 'PCO-LIVE.md'):
        if (source/'docs'/document).is_file():
            (output/document).write_bytes((source/'docs'/document).read_bytes())
            files.append(document)
    (output/'SHA256SUMS').write_text(''.join(module.digest(output/file)+'  '+file+'\n' for file in files))
    return manifest

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--output',type=Path,default=ROOT/'artifacts/update');parser.add_argument('--allow-dirty',action='store_true');args=parser.parse_args()
    status=subprocess.run(['git','status','--porcelain'],cwd=ROOT,text=True,capture_output=True,check=True).stdout
    if status and not args.allow_dirty: raise SystemExit('Commit the release source first, or use --allow-dirty for a local test build.')
    revision=subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,text=True,capture_output=True)
    commit=revision.stdout.strip() if revision.returncode == 0 else 'working-tree'
    result=build(ROOT,args.output,commit);print(json.dumps(result,indent=2))
