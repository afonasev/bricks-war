import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[2]/'tools/flow.py'
spec=importlib.util.spec_from_file_location('flow',SCRIPT); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        (self.root/'openspec/changes').mkdir(parents=True); self.f=m.Flow(self.root)
    def tearDown(self):self.tmp.cleanup()
    def new(self,cid='example',kind='report',route='quick',parent=None):
        p=self.root/'openspec/changes'/cid;p.mkdir();(p/'.openspec.yaml').write_text('schema: flow-quick\n')
        return self.f.init(cid,route,kind,parent)
    def ready(self,cid='example'):
        self.f.evidence(cid,'scope',{'approved':True});self.f.transition(cid,'ready')
    def report_delivered(self,cid='example'):
        self.ready(cid);self.f.claim(cid,'worker');self.f.transition(cid,'implementing','worker')
        self.f.evidence(cid,'verification',{'result':'pass'});self.f.transition(cid,'verified','worker')
        self.f.evidence(cid,'publication',{'path':'durable/report.md'});self.f.transition(cid,'published','worker')
        self.f.transition(cid,'finalizing','worker')
    def finalize(self,cid='example'):
        for k in ['spec_sync','cleanup']:self.f.evidence(cid,k,{'result':'verified'})
        (self.f.get(cid)[0].parent/'acceptance.md').write_text('Review the published report.')
        self.f.evidence(cid,'acceptance_guide','acceptance.md');self.f.transition(cid,'awaiting-acceptance','worker')
    def test_report_acceptance_and_archive(self):
        self.new();self.report_delivered();self.finalize()
        with self.assertRaises(ValueError):self.f.transition('example','accepted')
        self.f.transition('example','accepted',decision='Все устраивает',source='user message 42')
        self.f.evidence('example','archive',{'commit':'recorded'})
        with self.assertRaises(ValueError):self.f.transition('example','archived')
        dest=self.root/'openspec/changes/archive/2026-09-20-example';dest.parent.mkdir();self.f.get('example')[0].parent.rename(dest)
        self.f.transition('example','archived')
    def test_unresolved_question_and_inline_answer(self):
        self.new();self.f.question('example','What behavior?',['ready']);self.f.evidence('example','scope','agreed')
        with self.assertRaises(ValueError):self.f.transition('example','ready')
        self.f.answer('example','Q1','A','user message')
        with self.assertRaises(ValueError):self.f.transition('example','ready')
        self.f.answer('example','Q1','A','user message','Spec updated');self.f.transition('example','ready')
        self.assertFalse(self.f.inbox()[0]['questions'])
    def test_no_double_claim_concurrent_processes(self):
        self.new();self.ready()
        cmds=[[ 'python3',str(SCRIPT),'--root',str(self.root),'claim','example','--owner',o] for o in ['one','two']]
        ps=[subprocess.Popen(c,stdout=subprocess.PIPE,stderr=subprocess.PIPE) for c in cmds]
        results=[(p.communicate(),p.returncode)[1] for p in ps]
        self.assertEqual(sorted(results),[0,2])
    def test_delivery_debt_and_rework_reset(self):
        self.new();self.report_delivered()
        self.assertTrue(self.f.inbox()[0]['finalization_debt'])
        with self.assertRaises(ValueError):self.f.transition('example','awaiting-acceptance','worker')
        self.finalize();self.f.transition('example','rework-required',decision='Fix totals',source='inline feedback')
        self.assertEqual(set(self.f.get('example')[1]['evidence']),{'scope'})
        self.f.claim('example','new-worker');self.f.transition('example','implementing','new-worker')
        with self.assertRaises(ValueError):self.f.transition('example','verified','new-worker')
    def test_dependencies_and_cycles(self):
        self.new('first');self.new('second');self.f.dependency('second','first','delivered')
        self.f.evidence('second','scope','agreed')
        with self.assertRaises(ValueError):self.f.transition('second','ready')
        with self.assertRaises(ValueError):self.f.dependency('first','second','accepted')
        self.report_delivered('first');self.f.transition('second','ready')
    def test_initiative_child_gate(self):
        self.new('campaign','initiative','initiative');self.new('mission',parent='campaign')
        with self.assertRaises(ValueError):self.f.dependency('mission','campaign','accepted')
        self.report_delivered('campaign')
        for k in ['spec_sync','cleanup']:self.f.evidence('campaign',k,'checked')
        (self.f.get('campaign')[0].parent/'acceptance.md').write_text('Whole campaign')
        self.f.evidence('campaign','acceptance_guide','acceptance.md')
        with self.assertRaises(ValueError):self.f.transition('campaign','awaiting-acceptance','worker')
    def test_merge_real_ancestry(self):
        repo=self.root/'code';repo.mkdir()
        def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.DEVNULL,text=True).strip()
        git('init','-b','main');git('config','user.email','test@example.invalid');git('config','user.name','Test')
        (repo/'a').write_text('a');git('add','.');git('commit','-m','base')
        git('checkout','-b','feature');(repo/'a').write_text('b');git('commit','-am','feature');sha=git('rev-parse','HEAD')
        self.new(kind='software');self.ready();self.f.claim('example','worker');self.f.transition('example','implementing','worker')
        self.f.evidence('example','verification','pass');self.f.evidence('example','commit',sha);self.f.transition('example','verified','worker')
        self.f.evidence('example','merge',{'repo':str(repo),'commit':sha,'main_ref':'main'})
        with self.assertRaises(subprocess.CalledProcessError):self.f.transition('example','merged','worker')
        git('checkout','main');git('merge','--ff-only','feature');self.f.transition('example','merged','worker')
    def test_lease_ownership(self):
        self.f.lease('acquire','integration','a')
        with self.assertRaises(ValueError):self.f.lease('acquire','integration','b')
        with self.assertRaises(ValueError):self.f.lease('release','integration','b')
        self.f.lease('release','integration','a');self.f.lease('acquire','integration','b')
    def test_pause_is_sticky(self):
        self.new();self.ready();p,d=self.f.get('example');d['paused']=True;self.f.save(p,d,'paused')
        self.assertFalse(self.f.inbox()[0]['ready'])
        with self.assertRaises(ValueError):self.f.claim('example','worker')

if __name__=='__main__':unittest.main()
