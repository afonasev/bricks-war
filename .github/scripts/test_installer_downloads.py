import base64
import copy
import unittest
from installer_downloads import ApiError, BLOCK, REPOSITORIES, download_block, installer_pair, invariant, latest_native, reconcile, replace_block

NOTES = '## Русский\n\n### Исправления\n- Исправлено.\n\n## English\n\n### Fixed\n- Fixed.\n'

def release(repo, rid=1, version='1.0.0', **changes):
    assets=[]
    for index,name in enumerate((f'Game-{version}.exe',f'Game-{version}.pkg')):
        assets.append({'id':rid*10+index,'name':name,'state':'uploaded','size':123,
                       'digest':'sha256:'+'a'*64,'browser_download_url':f'https://github.com/{repo}/releases/download/v{version}/{name}'})
    result={'id':rid,'tag_name':'v'+version,'draft':False,'prerelease':False,'name':'Game '+version,
            'body':NOTES,'published_at':'2026-11-03T00:00:00Z','target_commitish':'a'*40,'assets':assets}
    result.update(changes)
    return result

class FakeGitHub:
    def __init__(self,repo='afonasev/spacewars'):
        self.repo=repo
        old=release(repo)
        self.native=release(repo,2,'2.0.0')
        self.content=release(repo,3,'1.0.0',tag_name='content-9999999999999',assets=[])
        self.channel=release(repo,4,tag_name='channel-production',body='{"signed":"untouched"}',assets=[])
        self.items=[old,self.native,self.content,self.channel,release(repo,5,'9.0.0',prerelease=True),release(repo,6,'8.0.0',draft=True)]
        self.text='# Game\n\n'+download_block(repo,old)+'\n\nAuthored prose.\n'
        self.sha=0
        self.calls=[]
        self.conflicts=0
        self.fail_patch=False

    def __call__(self,method,path,data=None):
        self.calls.append((method,path,copy.deepcopy(data)))
        base='repos/'+self.repo
        if method=='GET' and path==base:return {'default_branch':'main'}
        if method=='GET' and path.startswith(base+'/releases?'):return copy.deepcopy(self.items)
        if path.startswith(base+'/releases/'):
            target=next(r for r in self.items if str(r['id'])==path.rsplit('/',1)[1])
            if method=='GET':return copy.deepcopy(target)
            if method=='PATCH':
                if self.fail_patch:raise ApiError(503,path)
                target['body']=data['body'];return copy.deepcopy(target)
        if method=='GET' and path==base+'/readme?ref=main':
            return {'path':'README.md','encoding':'base64','sha':str(self.sha),'content':base64.b64encode(self.text.encode()).decode()}
        if method=='PUT' and path==base+'/contents/README.md':
            if self.conflicts:
                self.conflicts-=1;self.sha+=1;self.text+='\nConcurrent authored line.\n';raise ApiError(409,path)
            if data['sha']!=str(self.sha):raise ApiError(409,path)
            self.text=base64.b64decode(data['content']).decode();self.sha+=1
            return {'commit':{'sha':str(self.sha)}}
        raise AssertionError((method,path,data))

class InstallerAutomation(unittest.TestCase):
    def test_new_native_release_updates_all_projects_and_keeps_payloads_channels_and_prose(self):
        for repo in sorted(REPOSITORIES):
            with self.subTest(repository=repo):
                api=FakeGitHub(repo);before=copy.deepcopy(api.items)
                result=reconcile(api,repo,apply=True)
                self.assertEqual(result['installer_version'],'2.0.0')
                self.assertIn('Installer version: **2.0.0**',api.text)
                self.assertIn('Authored prose.',api.text)
                self.assertTrue(api.items[2]['body'].startswith('## Русский\n'))
                for old,new in zip(before,api.items):self.assertEqual(invariant(old),invariant(new))
                self.assertEqual(api.channel, before[3])
                self.assertEqual(api.items[4:],before[4:])
                self.assertIn('/v1.0.0/Game-1.0.0.exe',api.items[0]['body'])
                self.assertIn('/v2.0.0/Game-2.0.0.exe',api.items[2]['body'])
                writes=len([c for c in api.calls if c[0]!='GET'])
                reconcile(api,repo,apply=True)
                self.assertEqual(len([c for c in api.calls if c[0]!='GET']),writes)

    def test_source_export_removing_or_staling_block_is_repaired(self):
        api=FakeGitHub();api.text='# Game\n\nUpdated source-export prose.\n'
        reconcile(api,api.repo,apply=True)
        self.assertTrue(api.text.startswith('# Game\n'))
        self.assertIn('Updated source-export prose.',api.text)
        self.assertEqual(len(list(BLOCK.finditer(api.text))),1)
        api.text=api.text.replace('2.0.0','99.0.0')
        reconcile(api,api.repo,apply=True)
        self.assertIn('Installer version: **2.0.0**',api.text)
        self.assertNotIn('99.0.0',api.text)

    def test_audit_has_no_writes_and_failed_discovery_does_not_mutate(self):
        api=FakeGitHub();reconcile(api,api.repo)
        self.assertTrue(all(c[0]=='GET' for c in api.calls))
        api.items=[];api.calls=[]
        with self.assertRaisesRegex(ValueError,'No complete'):reconcile(api,api.repo,True)
        self.assertTrue(all(c[0]=='GET' for c in api.calls))
        api=FakeGitHub();api.fail_patch=True
        with self.assertRaises(ApiError):reconcile(api,api.repo,True)
        self.assertFalse(any(c[0]=='PUT' for c in api.calls))

    def test_readme_conflict_retry_preserves_the_concurrent_author(self):
        api=FakeGitHub();api.conflicts=1
        reconcile(api,api.repo,True)
        self.assertIn('Concurrent authored line.',api.text)
        self.assertIn('Installer version: **2.0.0**',api.text)
        api=FakeGitHub();api.conflicts=3
        with self.assertRaises(ApiError):reconcile(api,api.repo,True)
        self.assertEqual(len([c for c in api.calls if c[0]=='PUT']),3)

    def test_semver_not_event_order_or_channel_tags_and_partial_installers(self):
        repo='afonasev/star-racing'
        newest=release(repo,1,'10.0.0');older=release(repo,2,'9.9.9')
        self.assertEqual(latest_native(repo,[newest,older])['tag_name'],'v10.0.0')
        partial=release(repo,3,'11.0.0');partial['assets'].pop()
        self.assertEqual(latest_native(repo,[partial,newest])['id'],1)
        bad=release(repo);bad['assets'][0]['browser_download_url']='https://evil.test/setup.exe'
        self.assertIsNone(installer_pair(repo,bad))
        for tag in ['v01.2.3','channel-production','content-9999999','v2.0.0-test.1']:
            self.assertIsNone(installer_pair(repo,release(repo,tag_name=tag)))

    def test_legacy_markers_duplicate_blocks_and_bilingual_contract(self):
        api=FakeGitHub('afonasev/star-tournament');block=download_block(api.repo,api.native)
        body=replace_block(NOTES,block)
        self.assertTrue(body.startswith('## Русский\n'))
        self.assertEqual(body.count('## English\n'),1)
        self.assertEqual(body.count('- Исправлено.'),1)
        legacy='<!-- mindbattle-downloads:start -->old<!-- mindbattle-downloads:end -->'
        normalized=replace_block('# Game\n'+legacy+'\n'+legacy,block,True)
        self.assertEqual(len(list(BLOCK.finditer(normalized))),1)
        self.assertEqual(replace_block(normalized,block,True),normalized)

if __name__=='__main__':unittest.main()
