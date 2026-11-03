import importlib.util, json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from github_downloads import with_installer_downloads, installers, prepare, invariant

class DownloadPresentation(unittest.TestCase):
    def test_installer_selection_prefers_dmg_and_ignores_packages(self):
        release={'assets':[{'name':x} for x in ['a.exe','a.dmg','a.pkg','full.nupkg','latest.json']]}
        self.assertEqual(installers(release),('a.exe','a.dmg'))
        self.assertIsNone(installers({'assets':[{'name':'full.nupkg'}]}))

    def test_json_channel_is_never_an_edit_target(self):
        native={'id':1,'tag_name':'v0.1.0','draft':False,'prerelease':False,'body':'## Русский\n- Новое\n\n## English\n- Added','assets':[{'name':'Game.exe'},{'name':'Game.pkg'}]}
        channel=dict(native,id=2,tag_name='channel-production',body='{"platforms":{}}')
        import base64
        def fake(endpoint,*args):
            if '/releases?' in endpoint:return [native,channel]
            if endpoint.endswith('/releases/latest'):return native
            if endpoint.endswith('/readme'):return {'path':'README.md','sha':'a'*40,'content':base64.b64encode(b'# Game\n\nExisting prose.\n').decode()}
            return {'homepage':None}
        with tempfile.TemporaryDirectory() as root, patch('github_downloads.gh',side_effect=fake):
            plan=prepare('afonasev/spacewars',Path(root)/'plan')
            self.assertEqual([r['id'] for r in plan['release_edits']],[1])
            self.assertIn('Existing prose.',plan['readme'])

    def test_input_validation_and_preserved_bilingual_contract(self):
        body='## Русский\n\n### Исправления\n- Исправлено.\n\n## English\n\n### Fixed\n- Fixed.\n'
        args=('0.1.0','afonasev/spacewars','Game.exe','Game.dmg')
        result=with_installer_downloads(body,*args)
        self.assertTrue(result.startswith('## Русский\n'))
        self.assertEqual(with_installer_downloads(result,*args),result)
        for version,repo,win,mac in [('channel-production',*args[1:]),('0.1.0','evil/project',*args[2:]),(*args[:2],'../Game.exe','Game.dmg')]:
            with self.assertRaises(ValueError):with_installer_downloads(body,version,repo,win,mac)
        self.assertIn('tag%3Av0%20prerelease%3Afalse',result)

if __name__=='__main__':unittest.main()
