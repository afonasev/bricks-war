import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { catalogs, en } from '../src/i18n/catalogs';
import { LOCALES, LANGUAGE_KEY, loadLocale, normalizeLocale, resolveLocale, saveLocale, setLocale, getLocale, text, translate } from '../src/i18n/locale';
import { gamepadFooterAction, gamepadFaceLabels, footerResetButtonMarkup } from '../src/ui/gamepadFooterHints';
import { startupLocaleScript } from '../src/i18n/bootstrap';
import { DEFAULT_RELEASE_SETTINGS, saveReleaseSettings } from '../src/ui/releaseSettings';

describe('entry language contract', () => {
  it('localizes shared footer actions and unknown face directions while preserving family glyphs', () => {
    vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 960 });
    try {
      for (const locale of LOCALES) {
        setLocale(locale, null);
        expect(gamepadFooterAction('confirm', 'confirm')).toContain(catalogs[locale].confirm);
        expect(footerResetButtonMarkup()).toContain(catalogs[locale].reset);
        expect(gamepadFaceLabels('unknown')).toEqual([catalogs[locale].bottom,catalogs[locale].right,catalogs[locale].left,catalogs[locale].top]);
        expect(gamepadFaceLabels('Xbox')).toEqual(['A','B','X','Y']);
        expect(gamepadFaceLabels('DualSense')).toEqual(['✕','○','□','△']);
      }
    } finally { setLocale('en',null); vi.unstubAllGlobals(); }
  });
  it('resolves manual choice then first supported system family, then English', () => {
    expect(resolveLocale('ja-JP', ['ru-RU'])).toBe('ja');
    expect(resolveLocale('{corrupt', ['it-IT', 'fr-CA', 'de-DE'])).toBe('fr');
    expect(resolveLocale(null, ['it', 'ko'])).toBe('en');
    for (const tag of ['zh', 'zh-CN', 'zh-TW', 'zh-Hant-HK', 'ZH_hans_SG']) expect(normalizeLocale(tag)).toBe('zh-Hans');
    for (const locale of ['ru','en','fr','de','es','ja']) expect(normalizeLocale(`${locale}-XX`)).toBe(locale);
  });
  it('survives absent, corrupt and blocked storage; manual choice persists independently of game reset', () => {
    const data = new Map<string, string>();
    const storage = {getItem: (key: string) => data.get(key) ?? null, setItem: (key: string,value: string) => { data.set(key,value); }};
    expect(saveLocale('de',storage)).toBe(true);
    saveReleaseSettings({...DEFAULT_RELEASE_SETTINGS},storage);
    expect(loadLocale(['ru'],storage)).toBe('de');
    expect(data.get(LANGUAGE_KEY)).toBe('de');
    const blocked = {getItem: () => { throw Error('blocked'); },setItem: () => {throw Error('blocked');}};
    expect(loadLocale(['es'],blocked)).toBe('es');
    expect(setLocale('ja',blocked)).toBe(false);
    expect(getLocale()).toBe('ja');
    expect(text('settings')).toBe('設定');
    expect(saveLocale('en',null)).toBe(false);
    expect(loadLocale([],null)).toBe('en');
    storage.setItem(LANGUAGE_KEY,'[broken]');
    expect(loadLocale(['ru'],storage)).toBe('ru');
    setLocale('en',null);
  });
  it('requires exact catalog key and parameter parity, with English missing-resource fallback', () => {
    const params = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(catalogs[locale]).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(catalogs[locale][key].trim()).not.toBe('');
        expect(params(catalogs[locale][key])).toEqual(params(en[key]));
        expect(translate(locale,key,{value:60})).not.toMatch(/\{\w+\}/);
      }
      expect(translate(locale,'settings',undefined,{})).toBe('Settings');
      expect(translate(locale,'settings',undefined,null as unknown as {})).toBe('Settings');
    }
  });

  it('provides complete localized phone Controls help copy in every supported catalog', () => {
    const phoneHelpKeys = [
      'phoneControlsEyebrow', 'phoneControlsTitle', 'phoneControlsIntro', 'phoneControlsDiagram',
      'phoneControlsRotate', 'phoneControlsRotateArea', 'phoneControlsLeft', 'phoneControlsDown',
      'phoneControlsRight', 'phoneControlsHold', 'phoneControlsPauseTitle', 'phoneControlsPauseHint',
    ] as const;
    for (const locale of LOCALES) {
      for (const key of phoneHelpKeys) expect(catalogs[locale][key].trim(), `${locale}.${key}`).not.toBe('');
    }
  });
  it('runs prepaint bootstrap without app modules for every locale and blocked storage', () => {
    const script = startupLocaleScript();
    for (const locale of LOCALES) {
      const manifest = { href: '' };
      const description = { content: '' };
      const document = {documentElement:{lang:''},title:'',querySelector:(selector:string)=>selector.startsWith('meta')?description:manifest};
      const window: Record<string, any> = {};
      runInNewContext(script,{window,document,navigator:{languages:['it',locale]},localStorage:{getItem:()=>null}});
      expect(document.documentElement.lang).toBe(locale);
      expect(document.title).toBe(catalogs[locale].title);
      expect(window.__bricksLocale.copy.errorTitle).toBe(catalogs[locale].errorTitle);
      expect(manifest.href).toBe(`./manifest-${locale}.webmanifest`);
      expect(description.content).toBe(catalogs[locale].pwaManifestDescription);
    }
    const document = {documentElement:{lang:''},title:'',querySelector:()=>null};
    runInNewContext(script,{window:{},document,navigator:{languages:['ru']},localStorage:{getItem:()=>{throw Error('blocked');}}});
    expect(document.documentElement.lang).toBe('ru');
  });

  it('updates the manifest link when the in-app locale changes', () => {
    const manifest = { href: '' };
      const description = { content: '' };
    vi.stubGlobal('document', { documentElement: { lang: '' }, title: '', querySelector: (selector:string) => selector.startsWith('meta')?description:manifest });
    try {
      for (const locale of LOCALES) {
        setLocale(locale, null);
        expect(manifest.href).toBe(`./manifest-${locale}.webmanifest`);
      expect(description.content).toBe(catalogs[locale].pwaManifestDescription);
        expect(document.documentElement.lang).toBe(locale);
      }
    } finally { setLocale('en', null); vi.unstubAllGlobals(); }
  });
});
