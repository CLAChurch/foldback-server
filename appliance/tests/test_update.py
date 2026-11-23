"""Exercise update transactions in a temporary fake appliance, never the host OS."""
import copy
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec); loader.exec_module(module)
    return module
update = load('tested_updater', ROOT/'appliance/rootfs/usr/local/bin/foldback-update')
builder = load('tested_builder', ROOT/'tools/build-update.py')

class FakeSystem:
    def __init__(self): self.calls = []; self.fail_health = False; self.fail_prepare = False
    def prepare(self, app, manifest):
        self.calls.append('prepare')
        if self.fail_prepare: raise update.UpdateError('Bad code')
    def stop(self): self.calls.append('stop')
    def start(self): self.calls.append('start')
    def health(self, version=None):
        self.calls.append(('health', version))
        if version and self.fail_health: raise update.UpdateError('Simulated failed startup')

class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'machine'
        self.original = self.root/'opt/foldback'; self.original.mkdir(parents=True)
        (self.original/'package.json').write_text('{"version":"0.2.0"}')
        self.data = self.root/'var/lib/foldback'; self.data.mkdir(parents=True, mode=0o700)
        self.state = self.data/'state.json'
        self.initial = {'version':1, 'auth':{'hash':'fixture-hash'}, 'pco':{'secret':'fixture-private-token'}, 'settings':{'campus':'Fixture'}}
        self.state.write_text(json.dumps(self.initial)); self.state.chmod(0o600)
        self.env = self.root/'etc/foldback/server.env'; self.env.parent.mkdir(parents=True)
        self.env.write_text('fixture original environment')
        self.tls = self.env.parent/'tls/server.key'; self.tls.parent.mkdir(); self.tls.write_text('fixture private TLS identity')
        self.helper = self.root/'usr/local/bin/foldback-console'; self.helper.parent.mkdir(parents=True)
        self.helper.write_text('old console'); self.helper.chmod(0o755)
        self.system = FakeSystem(); self.updater = update.Updater(self.root, self.system)
        self.output = Path(self.temp.name)/'release'
        self.manifest = builder.build(ROOT, self.output)
        self.archive = self.output/self.manifest['archive']

    def install(self): self.updater.install(self.archive, self.manifest, 'CLAChurch/foldback-server')

    def test_success_preserves_private_data_and_switches_code(self):
        before = self.state.read_bytes(); self.install()
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual(self.env.read_text(), 'fixture original environment')
        self.assertEqual(self.tls.read_text(), 'fixture private TLS identity')
        self.assertEqual(json.loads((self.updater.current/'package.json').read_text())['version'], self.manifest['version'])
        self.assertIn(('health', self.manifest['version']), self.system.calls)
        transaction = update.read_json(self.updater.history)
        self.assertEqual(Path(transaction['backup']).stat().st_mode & 0o777, 0o700)
        self.assertEqual((Path(transaction['backup'])/'data/state.json').stat().st_mode & 0o777, 0o600)
        self.assertFalse(self.updater.journal.exists())
        self.assertEqual(update.read_json(self.updater.private/'repository.json')['repository'], 'CLAChurch/foldback-server')

    def test_failed_start_restores_original_and_can_retry(self):
        self.system.fail_health = True
        with self.assertRaisesRegex(update.UpdateError, 'Simulated'): self.install()
        self.assertEqual(self.updater.target(), self.original)
        self.assertEqual(self.helper.read_text(), 'old console')
        self.assertFalse((self.root/update.DROPIN).exists())
        self.assertEqual(update.read_json(self.state), self.initial)
        self.assertFalse(self.updater.journal.exists())
        self.system.fail_health = False; self.install()
        self.assertNotEqual(self.updater.target(), self.original)

    def test_preflight_failure_never_stops_service(self):
        self.system.fail_prepare = True
        with self.assertRaises(update.UpdateError): self.install()
        self.assertNotIn('stop', self.system.calls)
        self.assertEqual(update.read_json(self.state), self.initial)

    def test_manual_rollback_keeps_later_settings_and_credentials(self):
        self.install()
        later = copy.deepcopy(self.initial); later['pco']['secret'] = 'fixture-rotated-token'; later['settings']['campus'] = 'Edited later'
        self.state.write_text(json.dumps(later))
        self.updater.rollback()
        self.assertEqual(self.updater.target(), self.original)
        self.assertEqual(update.read_json(self.state), later)
        self.assertEqual(self.helper.read_text(), 'old console')
        self.assertFalse(self.updater.journal.exists())

    def test_restore_state_rollback_recovers_snapshot(self):
        self.install(); self.state.write_text('{"version":2,"settings":{"campus":"New schema"}}')
        with self.assertRaisesRegex(update.UpdateError, 'cannot read'): self.updater.rollback()
        self.updater.rollback(restore_state=True)
        self.assertEqual(update.read_json(self.state), self.initial)

    def test_recover_interrupted_install_restores_code_and_data(self):
        self.install()
        transaction = update.read_json(self.updater.history)
        update.atomic_json(self.updater.journal, transaction)
        self.state.write_text('{"version":1,"settings":{"campus":"Interrupted"}}')
        self.updater.recover()
        self.assertEqual(self.updater.target(), self.original)
        self.assertEqual(update.read_json(self.state), self.initial)

    def test_corrupt_archive_rejected_before_stop(self):
        with self.archive.open('ab') as stream: stream.write(b'corruption')
        with self.assertRaisesRegex(update.UpdateError, 'checksum'): self.install()
        self.assertNotIn('stop', self.system.calls)

    def test_unsupported_schema_rejected_before_stop(self):
        self.manifest['stateSchema'] = {'min':2,'max':2}
        with self.assertRaisesRegex(update.UpdateError, 'schema'): self.install()
        self.assertNotIn('stop', self.system.calls)

    def test_unsafe_archive_entries_rejected_before_stop(self):
        for name, symbolic in [('app/../../escape',False),('rootfs/etc/shadow',False),('app/src/link',True),('app/src/../bad',False)]:
            with self.subTest(name=name):
                with tarfile.open(self.archive, 'w:gz') as stream:
                    entry=tarfile.TarInfo(name); entry.size=1
                    if symbolic: entry.type=tarfile.SYMTYPE; entry.linkname='/etc/shadow'; entry.size=0
                    stream.addfile(entry, None if symbolic else io.BytesIO(b'x'))
                self.manifest['sha256'] = update.digest(self.archive)
                with self.assertRaises(update.UpdateError): self.install()
                self.assertNotIn('stop', self.system.calls)

    def test_builder_contains_no_campus_state_or_os_credentials(self):
        with tarfile.open(self.archive) as stream:
            names = stream.getnames()
        self.assertTrue(any(n.startswith('app/src/') for n in names))
        self.assertFalse(any(n.startswith(('app/data','app/artifacts','rootfs/etc/foldback')) for n in names))

    def test_cross_origin_redirect_strips_authorization(self):
        handler=update.StripCredentialRedirect()
        request=urllib.request.Request('https://api.github.com/asset', headers={'Authorization':'Bearer fixture'})
        redirected=handler.redirect_request(request,None,302,'Found',{},'https://release-assets.githubusercontent.com/file')
        self.assertIsNone(redirected.get_header('Authorization'))
        with self.assertRaises(update.UpdateError):
            handler.redirect_request(request,None,302,'Found',{},'http://example.com/file')

if __name__ == '__main__': unittest.main()
