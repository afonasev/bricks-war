#!/usr/bin/env python3
"""Prepare/apply only GitHub download presentation; never modify release assets or channels."""
import argparse, base64, json, re, subprocess
from pathlib import Path
from urllib.parse import quote
START = '<!-- desktop-downloads:start -->'
END = '<!-- desktop-downloads:end -->'

def with_installer_downloads(body, version, repository, windows_name, mac_name):
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', version):
        raise ValueError('Native version required')
    if not re.fullmatch(r'afonasev/[a-z0-9-]+', repository):
        raise ValueError('Owned release repository required')
    if not windows_name.endswith('.exe') or not mac_name.endswith(('.dmg', '.pkg')):
        raise ValueError('Windows and macOS installers required')
    for name in (windows_name, mac_name):
        if '/' in name or not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
            raise ValueError('Installer basename required')
    base = f'https://github.com/{repository}/releases/download/v{quote(version)}/'
    view = f'https://github.com/{repository}/releases?q=' + quote('tag:v' + version.split('.')[0] + ' prerelease:false', safe='')
    block = f'{START}\n**Скачать / Download**\n\n| Windows | macOS |\n| --- | --- |\n| **[Download EXE]({base}{windows_name})** | **[Download {mac_name.rsplit(".",1)[1].upper()}]({base}{mac_name})** |\n\n[Только установщики / Installer releases]({view})\n\nInstaller version: **{version}**.\n{END}\n\n'
    clean = re.sub(re.escape(START) + r'[\s\S]*?' + re.escape(END) + r'\s*', '', body)
    # Preserve canonical bilingual bodies required by existing publishers/history readers.
    if clean.startswith('## Русский\n'):
        prefix = '## Русский\n\n'
        return prefix + block + clean[len('## Русский\n'):].lstrip('\n')
    return block + clean.lstrip('\n')

PROJECTS = {
 'spacewars': ('Spacewars', 'tools/native-release/release_notes.py', 'tools/native-release/publish.py'),
 'star-tournament': ('Star Tournament', 'distribution/release_changelog.py', 'distribution/publish_release.py'),
 'star-racing': ('Star Racing', 'distribution/changelog.py', 'distribution/release.py'),
 'mindbattle': ('Mindbattle', 'scripts/desktop/download-presentation.mjs', 'scripts/desktop/publish-github.mjs'),
 'wild-spirits': ('Wild Spirits', 'tools/native-release/notes.py', 'tools/native-release/publish.py'),
 'forgottenwars': ('Forgottenwars', 'tools/native-release/release.py', 'tools/native-release/release.py'),
}

def gh(endpoint, method='GET', data=None):
    args = ['gh', 'api', endpoint]
    if method != 'GET': args += ['--method', method]
    if data is not None: args += ['--input', '-']
    return json.loads(subprocess.check_output(args, input=json.dumps(data).encode() if data is not None else None))

def releases(repo):
    entries=[]
    for page in range(1, 11):
        batch=gh(f'repos/{repo}/releases?per_page=100&page={page}'); entries.extend(batch)
        if len(batch)<100:return entries
    raise ValueError('Release coverage incomplete')

def installers(release):
    files=release['assets']
    windows=[a for a in files if a['name'].endswith('.exe')]
    mac=[a for a in files if a['name'].endswith('.dmg')] or [a for a in files if a['name'].endswith('.pkg')]
    if len(windows)!=1 or len(mac)!=1:return None
    return windows[0]['name'],mac[0]['name']

def invariant(release):
    return {k:release.get(k) for k in ['id','tag_name','name','draft','prerelease','published_at','target_commitish']} | {'assets':sorted([{k:a.get(k) for k in ['id','name','size','digest','browser_download_url']} for a in release['assets']], key=lambda a:a['id'])}

def prepare(repo, directory):
    directory.mkdir(parents=True,exist_ok=False)
    before=releases(repo); latest=gh(f'repos/{repo}/releases/latest'); pair=installers(latest)
    if not pair or not re.fullmatch(r'v\d+\.\d+\.\d+', latest['tag_name']):raise ValueError('No complete stable native release')
    edits=[]
    for release in before:
        if release['draft'] or release['prerelease']:continue
        # JSON channel pointers, archives and drafts are never presentation targets.
        if re.fullmatch(r'v\d+\.\d+\.\d+',release['tag_name']) and installers(release):
            version=release['tag_name'][1:]; names=installers(release)
        elif re.fullmatch(r'(content|shell)-\d+',release['tag_name']):version=latest['tag_name'][1:];names=pair
        else:continue
        try:json.loads(release['body'] or '')
        except (ValueError,TypeError):pass
        else:continue
        body=with_installer_downloads(release['body'] or '',version,repo,*names)
        edits.append({'id':release['id'],'body':body})
    readme=gh(f'repos/{repo}/readme'); text=base64.b64decode(readme['content']).decode()
    head=re.match(r'\A# [^\n]+\n',text)
    if not head:raise ValueError('README title missing')
    updated=head[0]+'\n'+with_installer_downloads(text[head.end():],latest['tag_name'][1:],repo,*pair)
    homepage=f'https://github.com/{repo}/releases?q='+quote('tag:v'+latest['tag_name'][1:].split('.')[0]+' prerelease:false',safe='')
    plan={'repo':repo,'latest':latest['tag_name'],'readme_path':readme['path'],'readme_sha':readme['sha'],'readme':updated,'homepage':homepage,'release_edits':edits}
    for name,value in [('releases-before.json',before),('readme-before.json',readme),('repository-before.json',gh(f'repos/{repo}')),('plan.json',plan)]:
        (directory/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    (directory/'README-preview.md').write_text(updated)
    return plan

def apply(directory):
    plan=json.loads((directory/'plan.json').read_text());repo=plan['repo'];before=json.loads((directory/'releases-before.json').read_text());old={r['id']:r for r in before}
    receipt={'repo':repo,'release_edits':[]}
    for edit in plan['release_edits']:
        current=gh(f'repos/{repo}/releases/{edit["id"]}')
        if current['body']!=old[edit['id']]['body'] or invariant(current)!=invariant(old[edit['id']]):raise ValueError('Concurrent release change; stop')
        response=gh(f'repos/{repo}/releases/{edit["id"]}','PATCH',{'body':edit['body']})
        if response['body']!=edit['body'] or invariant(response)!=invariant(current):raise ValueError('Release readback mismatch')
        receipt['release_edits'].append(edit['id']);(directory/'progress.json').write_text(json.dumps(receipt,indent=2))
    result=gh(f'repos/{repo}/contents/{plan["readme_path"]}','PUT',{'message':'docs: make Windows and macOS installers visible','sha':plan['readme_sha'],'content':base64.b64encode(plan['readme'].encode()).decode()})
    receipt['readme_commit']=result['commit']['sha']
    gh(f'repos/{repo}','PATCH',{'homepage':plan['homepage']})
    after=releases(repo)
    if {r['id'] for r in before}!={r['id'] for r in after}:raise ValueError('Release list changed concurrently')
    edits={r['id']:r['body'] for r in plan['release_edits']}
    for r in after:
        if invariant(r)!=invariant(old[r['id']]) or r['body']!=edits.get(r['id'],old[r['id']]['body']):raise ValueError('Release preservation check failed')
    readme=gh(f'repos/{repo}/readme')
    if base64.b64decode(readme['content']).decode()!=plan['readme']:raise ValueError('README readback mismatch')
    if gh(f'repos/{repo}/releases/latest')['tag_name']!=plan['latest']:raise ValueError('Latest native changed')
    if gh(f'repos/{repo}')['homepage']!=plan['homepage']:raise ValueError('Homepage mismatch')
    receipt.update(verified=True,release_count=len(after),assets_visibility_channels_unchanged=True)
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['prepare','apply']);p.add_argument('directory',type=Path);p.add_argument('--repo',choices=list(PROJECTS));a=p.parse_args()
    if a.action=='prepare':
        if not a.repo:p.error('--repo required')
        plan=prepare('afonasev/'+a.repo,a.directory);print(json.dumps({'repo':plan['repo'],'latest':plan['latest'],'release_edits':len(plan['release_edits'])}))
    else:print(json.dumps(apply(a.directory)))
