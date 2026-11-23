import importlib.machinery
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / 'rootfs/usr/local/bin/foldback-install'
loader = importlib.machinery.SourceFileLoader('foldback_installer', str(path))
spec = importlib.util.spec_from_loader(loader.name, loader)
installer = importlib.util.module_from_spec(spec)
loader.exec_module(installer)

class DiskSafety(unittest.TestCase):
    def disk(self, **values):
        return dict(path='/dev/sda', type='disk', size=16*1024**3, ro=False, model='Test disk', serial='TEST-123', mountpoints=[None], **values)

    def test_requires_explicit_disk_identity(self):
        self.assertEqual(installer.erase_phrase(self.disk()), 'ERASE /dev/sda TEST-123')
        disk = self.disk(); disk['serial'] = None
        self.assertEqual(installer.erase_phrase(disk), 'ERASE /dev/sda NO-SERIAL')

    def test_rejects_boot_usb_and_other_mounted_disks(self):
        disk = self.disk(children=[dict(type='part', mountpoints=['/run/live/medium'])])
        self.assertFalse(installer.installable(disk))
        disk['children'][0]['mountpoints'] = ['/data']
        self.assertFalse(installer.installable(disk))

    def test_rejects_readonly_small_and_active_mapped_disks(self):
        disk = self.disk(); disk['ro'] = True
        self.assertFalse(installer.installable(disk))
        disk = self.disk(); disk['size'] = 1024**3
        self.assertFalse(installer.installable(disk))
        disk = self.disk(children=[dict(type='lvm', mountpoints=[None])])
        self.assertFalse(installer.installable(disk))

    def test_disk_names_support_sata_nvme_and_mmc(self):
        self.assertEqual(installer.partition('/dev/sda', 2), '/dev/sda2')
        self.assertEqual(installer.partition('/dev/nvme0n1', 2), '/dev/nvme0n1p2')
        self.assertEqual(installer.partition('/dev/mmcblk0', 2), '/dev/mmcblk0p2')
        self.assertTrue(installer.installable(self.disk()))

if __name__ == '__main__': unittest.main()
