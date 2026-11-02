import { getLocale, type Locale } from '../i18n/locale';
import { modeGuideCopy } from '../i18n/lobbyModeGuideCopy';
import type { LobbyMode } from './lobbyState';

export type GuideArt = 'clear' | 'attack' | 'pressure' | 'trophy' | 'record';
export function lobbyModeGuide(mode: LobbyMode, timed: boolean, locale: Locale = getLocale()) {
    const c = modeGuideCopy[locale];
    const steps: {art: GuideArt; title: string; body: string}[] = [
        {art:'clear', title:c.clearTitle, body:mode === 'survival' ? c.scoreClearBody : mode === 'team-battle' ? c.teamClearBody : c.clearBody},
        mode === 'survival' ? {art:'pressure', title:c.pressureTitle, body:c.pressureBody} : {art:'attack', title:mode === 'team-battle' ? c.teamAttackTitle : c.attackTitle, body:mode === 'team-battle' ? c.teamAttackBody : c.attackBody},
        mode === 'survival' ? {art:'record', title:c.recordTitle, body:c.recordBody} : mode === 'team-battle' ? {art:'trophy', title:c.teamLastTitle, body:timed ? c.teamTimedBody : c.teamLastBody} : {art:'trophy', title:c.lastTitle, body:timed ? c.timedBody : c.lastBody},
    ];
    return {steps, note:mode === 'survival' ? c.scoreNote : mode === 'team-battle' ? c.teamNote : c.battleNote};
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function guideArt(kind: GuideArt): string {
    let drawing: string;
    if (kind === 'trophy') drawing = '<path class="guide-cup" d="M21 15h22v14a11 11 0 0 1-22 0zM21 19H12v8a9 9 0 0 0 9 9m22-17h9v8a9 9 0 0 1-9 9M32 40v11m-10 1h20"/>';
    else if (kind === 'record') drawing = '<text x="32" y="39" text-anchor="middle">123</text>';
    else {
        const cells = kind === 'pressure' ? [[10,38],[25,38],[40,38],[10,23],[25,23],[40,23],[10,8],[25,8],[40,8]] : kind === 'attack' ? [[10,38],[25,38],[40,38],[25,23],[40,23],[40,8]] : [[10,38],[25,38],[40,38],[10,23],[25,23],[25,8]];
        drawing = cells.map(([x,y],i) => `<rect x="${x}" y="${y}" width="13" height="13" rx="2" class="${kind === 'pressure' || kind === 'attack' && i < 3 ? 'guide-grey' : ''}"/>`).join('');
    }
    return `<svg class="lobby-mode-art art-${kind}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${drawing}</svg>`;
}
/** Detailed markup comes from the existing canonical mode-rules renderer. */
export function lobbyModeGuideMarkup(mode: LobbyMode, timed: boolean, details: string, locale: Locale = getLocale()): string {
    const guide = lobbyModeGuide(mode,timed,locale);
    return `<div class="lobby-mode-guide" data-guide-mode="${mode}" data-guide-timed="${timed}"><div class="lobby-mode-brief"><ol>${guide.steps.map(step => `<li>${guideArt(step.art)}<div><h3>${escape(step.title)}</h3><p>${escape(step.body)}</p></div></li>`).join('')}</ol><p class="lobby-mode-note">${escape(guide.note)}</p></div><div id="lobby-mode-details" class="lobby-mode-details" hidden>${details}</div></div>`;
}
