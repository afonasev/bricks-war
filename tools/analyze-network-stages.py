"""Correlate same-host diagnostic clocks. Never use cross-host subtraction."""
import json,sys,math,gzip
from pathlib import Path
def read(path):
 if path.exists():return json.loads(path.read_text())
 return json.loads(gzip.open(str(path)+'.gz','rt').read())
root=Path(sys.argv[1]); server=read(root/'server.json')['trace']
def first(rows,predicate):return next((r for r in rows if predicate(r)),None)
def p95(values):return sorted(values)[math.ceil(len(values)*.95)-1] if values else None
summary=[]
for path in sorted(root.glob('bricks-network-latency-*.json')):
 if 'failure' in path.name:continue
 metrics=json.loads(path.read_text());variant=path.stem.replace('bricks-network-latency-','')
 client=read(root/f'client-trace-{variant}.json');host,other=client
 rows=[]
 for movement in metrics['movements']:
  inp=movement['input'];seq=inp['sequence'];match=inp['matchId']
  def same(r):return r.get('matchId')==match and r.get('connectionEpoch')==inp['connectionEpoch'] and r.get('inputEpoch')==inp['inputEpoch'] and r.get('sequence')==seq
  send=first(host['transport'],lambda r:r.get('stage')=='send' and same(r))
  ingress=first(server,lambda r:r.get('stage')=='ingress' and same(r))
  execution=first(server,lambda r:r.get('stage')=='execution' and same(r))
  identity=first(other['transport'],lambda r:r.get('type')=='snapshot-manifest' and r.get('ownId'))
  confirmIdentity=first(other['trace'],lambda r:r.get('kind')=='confirm')
  receiver=confirmIdentity['id'] if confirmIdentity else identity['ownId'] if identity else None
  candidates=[r for r in server if r.get('stage')=='publication' and ingress and execution and r.get('id')==receiver and r.get('matchId')==match and r['at']>=execution['at'] and (not r.get('inputs') or any(i.get('id')==ingress['id'] and i.get('connectionEpoch')==inp['connectionEpoch'] and i.get('inputEpoch')==inp['inputEpoch'] and i.get('sequence',-1)>=seq for i in r['inputs']))]
  received={r.get('snapshotId'):r for r in other['transport'] if r.get('type')=='snapshot-part' and r.get('part')==r.get('total',0)-1}
  pub=first(candidates,lambda r:r['snapshotId'] in received)
  receive=received.get(pub['snapshotId']) if pub else None
  confirm=first(other['trace'],lambda r:r.get('kind')=='confirm' and receive and r['at']>=receive['at'])
  render=first(other['trace'],lambda r:r.get('kind')=='postrender' and confirm and r['at']>=confirm['at'] and any(p['id']==ingress['id'] and p.get('x')==movement['x'] and p.get('spawnSerial')==int(movement['spawnSerial']) for p in r['participants']))
  chain=[send,ingress,execution,pub,receive,confirm,render];names=['send_to_ingress','ingress_to_execution','execution_to_publication','publication_to_receive','receive_to_confirm','confirm_to_postrender']
  durations={name:round(b['at']-a['at'],2) if a and b else None for name,a,b in zip(names,chain,chain[1:])}
  completed=first(server,lambda r:r.get('stage')=='send-complete' and pub and r.get('snapshotId')==pub['snapshotId'] and r.get('id')==receiver)
  durations['forwarded_to_ingress']=round(ingress['at']-movement['forwarded'],2) if ingress else None
  durations['publication_to_send_complete']=round(completed['at']-pub['at'],2) if completed and pub else None
  durations['send_complete_to_receive']=round(receive['at']-completed['at'],2) if completed and receive else None
  rows.append({'sequence':seq,'epoch':inp['inputEpoch'],'spawnSerial':inp['spawnSerial'],'targetTick':inp['targetTick'],'executedTick':execution.get('tick') if execution else None,'durationsMs':durations,'confirmedDomMs':round(movement['domAt']-movement['forwarded'],2),'renderedFromIngressMs':round(render['at']-ingress['at'],2) if render and ingress else None})
 stages={name:{'p95':p95([r['durationsMs'][name] for r in rows if r['durationsMs'][name] is not None]),'samples':sum(r['durationsMs'][name] is not None for r in rows)} for name in [*names,'forwarded_to_ingress','publication_to_send_complete','send_complete_to_receive']}
 summary.append({'variant':variant,'localP95':metrics['localMoveMs']['p95'],'remoteDomP95':metrics['confirmedOtherBoardMs']['p95'],'postrenderFromIngressP95':p95([r['renderedFromIngressMs'] for r in rows if r['renderedFromIngressMs'] is not None]),'stages':stages,'movements':rows})
output={'method':'Same Mac absolute performance clocks; execution is queue-consumption before simulation; publication precedes ws compression; postrender is Phaser canvas submission, not physical display scanout','profiles':summary}
(root/'stage-summary.json').write_text(json.dumps(output,indent=2)+'\n')
for s in summary:print(s['variant'],round(s['localP95'],1),round(s['remoteDomP95'],1),{k:v['p95'] for k,v in s['stages'].items()})
