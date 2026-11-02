#!/usr/bin/env python3
"""Reconcile human installer links using release metadata; never touch update payloads/channels."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPOSITORIES = {'afonasev/' + name for name in ('bricks-war','spacewars','star-tournament','star-racing','mindbattle','wild-spirits','forgottenwars')}
VERSION = re.compile(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z')
BLOCK = re.compile(r'<!-- (?P<kind>desktop-downloads|bricks-war-downloads|mindbattle-downloads):start -->[\s\S]*?<!-- (?P=kind):end -->')

class ApiError(RuntimeError):
    def __init__(self, status, endpoint):
        super().__init__(f'GitHub API {status}: {endpoint}')
        self.status = status

class GitHub:
    def __init__(self, token):
        if not token: raise ValueError('GITHUB_TOKEN is required')
        self.token = token

    def __call__(self, method, endpoint, data=None):
        request = Request('https://api.github.com/' + endpoint, method=method,
            data=None if data is None else json.dumps(data).encode(),
            headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
                     'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'installer-download-links'})
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read(16 * 1024 * 1024 + 1)
        except HTTPError as error:
            raise ApiError(error.code, endpoint) from None
        if len(raw) > 16 * 1024 * 1024: raise ValueError('Oversized metadata response')
        return json.loads(raw)

def version_key(release):
    match = VERSION.fullmatch(release.get('tag_name',''))
    return tuple(map(int, match.groups())) if match else None

def installer_pair(repository, release):
    if release.get('draft') or release.get('prerelease') or version_key(release) is None: return None
    windows = [a for a in release.get('assets',[]) if a.get('name','').endswith('.exe')]
    mac = [a for a in release.get('assets',[]) if a.get('name','').endswith('.dmg')]
    if not mac: mac = [a for a in release.get('assets',[]) if a.get('name','').endswith('.pkg')]
    if len(windows) != 1 or len(mac) != 1: return None
    pair = (windows[0], mac[0])
    for asset in pair:
        name = asset['name']
        if not re.fullmatch(r'[A-Za-z0-9_.-]+',name) or name in ('.','..'): return None
        expected = f'https://github.com/{repository}/releases/download/{release["tag_name"]}/{quote(name)}'
        if asset.get('browser_download_url') != expected or asset.get('state') != 'uploaded': return None
        if type(asset.get('size')) is not int or asset['size'] <= 0: return None
    return pair

def list_releases(api, repository):
    result = []
    for page in range(1, 11):
        batch = api('GET',f'repos/{repository}/releases?per_page=100&page={page}')
        if not isinstance(batch,list): raise ValueError('Invalid release list')
        result.extend(batch)
        if len(batch) < 100: return result
    raise ValueError('Release list truncated; refusing partial discovery')

def latest_native(repository, releases):
    candidates = [r for r in releases if installer_pair(repository,r)]
    if not candidates: raise ValueError('No complete published Windows/macOS native release')
    selected = max(candidates,key=version_key)
    if sum(version_key(r) == version_key(selected) for r in candidates) != 1: raise ValueError('Ambiguous native version')
    return selected

def download_block(repository, release):
    pair = installer_pair(repository,release)
    if pair is None: raise ValueError('Incomplete native release')
    windows, mac = pair
    version = release['tag_name'][1:]
    view = f'https://github.com/{repository}/releases?q=' + quote('tag:v' + version.split('.')[0] + ' prerelease:false',safe='')
    if repository == 'afonasev/bricks-war':
        start, end = '<!-- bricks-war-downloads:start -->', '<!-- bricks-war-downloads:end -->'
        heading = '## Download / Скачать'
        more = f'[Installer releases / Только установщики]({view}) · [Play in browser / Играть в браузере](https://bricks.afonasev.tech/)'
        caption = f'Installer version: **{version}**. The installed game receives newer game content through its updater.'
    else:
        start, end = '<!-- desktop-downloads:start -->', '<!-- desktop-downloads:end -->'
        heading = '**Скачать / Download**'
        more = f'[Только установщики / Installer releases]({view})'
        caption = f'Installer version: **{version}**.'
    extension = mac['name'].rsplit('.',1)[1].upper()
    return (f'{start}\n{heading}\n\n| Windows | macOS |\n| --- | --- |\n'
            f'| **[Download EXE]({windows["browser_download_url"]})** | **[Download {extension}]({mac["browser_download_url"]})** |\n\n'
            f'{more}\n\n{caption}\n{end}')

def replace_block(text, block, readme=False):
    matches = list(BLOCK.finditer(text))
    if matches:
        first = True
        def replace(_match):
            nonlocal first
            if first:
                first = False
                return block
            return ''
        return BLOCK.sub(replace,text)
    if readme:
        title = re.match(r'\A# [^\n]+\n',text)
        if not title: raise ValueError('README heading missing; refusing to replace authored prose')
        return text[:title.end()] + '\n' + block + '\n\n' + text[title.end():].lstrip('\n')
    if text.startswith('## Русский\n'):
        return '## Русский\n\n' + block + '\n\n' + text[len('## Русский\n'):].lstrip('\n')
    return block + '\n\n' + text

def invariant(release):
    return {k:release.get(k) for k in ('id','tag_name','name','draft','prerelease','published_at','target_commitish')} | {
        'assets': sorted([{k:a.get(k) for k in ('id','name','state','size','digest','browser_download_url')} for a in release.get('assets',[])],key=lambda a:a['id'])}

def readme_text(data):
    if data.get('encoding') != 'base64' or not isinstance(data.get('sha'),str): raise ValueError('Invalid README metadata')
    return base64.b64decode(data['content'],validate=False).decode('utf8')

def reconcile(api, repository, apply=False):
    if repository not in REPOSITORIES: raise ValueError('Repository outside installer-link scope')
    info = api('GET',f'repos/{repository}')
    branch = info['default_branch']
    releases = list_releases(api,repository)
    native = latest_native(repository,releases)
    block = download_block(repository,native)
    result = {'repository':repository,'installer_version':native['tag_name'][1:],'apply':apply,'readme_changed':False,'release_descriptions_changed':[]}
    for release in releases:
        if release.get('draft') or release.get('prerelease'): continue
        body = release.get('body') or ''
        try: json.loads(body)
        except ValueError: pass
        else: continue  # Signed JSON channel pointers must remain byte-for-byte intact.
        if installer_pair(repository,release): target = download_block(repository,release)
        elif re.fullmatch(r'(content|shell)-\d+',release.get('tag_name','')): target = block
        else: continue
        wanted = replace_block(body,target)
        if wanted == body: continue
        result['release_descriptions_changed'].append(release['tag_name'])
        if apply:
            current = api('GET',f'repos/{repository}/releases/{release["id"]}')
            if invariant(current) != invariant(release) or current.get('body') != release.get('body'): raise ValueError('Release changed concurrently; retry workflow')
            actual = api('PATCH',f'repos/{repository}/releases/{release["id"]}',{'body':wanted})
            if actual['body'] != wanted or invariant(actual) != invariant(current): raise ValueError('Release update readback mismatch')
    endpoint = f'repos/{repository}/readme?ref={quote(branch,safe="")}'
    for attempt in range(3):
        readme = api('GET',endpoint)
        text = readme_text(readme)
        wanted = replace_block(text,block,readme=True)
        if wanted == text: break
        result['readme_changed'] = True
        if not apply: break
        try:
            api('PUT',f'repos/{repository}/contents/{quote(readme["path"],safe="/")}',{
                'message':'docs: refresh installer download links [skip ci]', 'branch':branch,
                'sha':readme['sha'], 'content':base64.b64encode(wanted.encode()).decode()})
        except ApiError as error:
            if error.status == 409 and attempt < 2: continue
            raise
        if readme_text(api('GET',endpoint)) != wanted: raise ValueError('README update readback mismatch; retry workflow')
        break
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository',default=os.environ.get('GITHUB_REPOSITORY'))
    parser.add_argument('--apply',action='store_true')
    args = parser.parse_args()
    apply = args.apply or os.environ.get('INSTALLER_LINKS_APPLY','').lower() == 'true'
    result = reconcile(GitHub(os.environ.get('GITHUB_TOKEN','')),args.repository,apply)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary,'a') as stream:
            stream.write(f'Installer version: **{result["installer_version"]}**. Mode: **{"apply" if apply else "audit"}**.\n\n')
            stream.write(f'README changes: {result["readme_changed"]}; release descriptions: {len(result["release_descriptions_changed"])}. Assets and update channels untouched.\n')

if __name__ == '__main__': main()
