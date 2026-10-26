import {createHash} from 'node:crypto';
import baseline from './fixtures/rules-ru-baseline-hashes.json';
import { describe, expect, it } from 'vitest';
import { rulesEn, rulesRu, rulesFr, rulesDe, rulesEs, rulesJa, rulesZhHans, rulesCopy } from '../src/i18n/rulesCatalogs';
import { RULE_CARDS, ruleCardsForLocale } from '../src/ui/visualRules';
import { LOCALES } from '../src/i18n/locale';

describe('Rules resources', () => {
  it('provide the same typed keys in every supported language', () => {
    const keys = Object.keys(rulesEn).sort();
    for (const locale of [rulesRu, rulesFr, rulesDe, rulesEs, rulesZhHans, rulesJa]) {
      expect(Object.keys(locale).sort()).toEqual(keys);
    }
  });

  it('translates the guide headings, mechanic copy and accessible descriptions in all seven languages', () => {
    const headlines = [rulesEn, rulesRu, rulesFr, rulesDe, rulesEs, rulesZhHans, rulesJa].map(c => c.rulesTitle);
    expect(headlines).toEqual(['Game rules', 'Правила игры', 'Règles du jeu', 'Spielregeln', 'Reglas del juego', '游戏规则', 'ゲームのルール']);
    for (const locale of [rulesEn, rulesRu, rulesFr, rulesDe, rulesEs, rulesZhHans, rulesJa]) {
      expect(locale.rulesAttackNote.length).toBeGreaterThan(20);
      expect(locale.rulesAlt0.length).toBeGreaterThan(30);
      expect(locale.rulesAlt7.length).toBeGreaterThan(50);
    }
  });

  it('renders localized SVG labels directly while preserving card geometry and numeric examples', () => {
    const cyrillic = /[\u0400-\u04ff]/;
    const geometry = (svg: string) => svg.replace(/<text\b[^>]*>.*?<\/text>/gs, '<text/>');
    expect(ruleCardsForLocale('ru')).toEqual(RULE_CARDS);
    const russian = ruleCardsForLocale('ru');
    for (const locale of LOCALES.filter(value => value !== 'ru')) {
      const cards = ruleCardsForLocale(locale);
      const book = rulesCopy(locale);
      expect(cards).toHaveLength(8);
      cards.forEach((card, index) => {
        expect(geometry(card.art)).toBe(geometry(russian[index]!.art));
        for (const value of [card.topic, card.mode, card.title, card.lead, card.alt, ...card.notes]) {
          expect(value).not.toMatch(cyrillic);
        }
        const labels = [...card.art.matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].map(match => match[1]!);
        expect(labels.join(' ')).not.toMatch(cyrillic);
      });
      for (const score of [100, 300, 500, 800]) expect(cards[1]!.art).toContain(`>${score}</text>`);
      for (const shieldCount of [book.shieldCount0, book.shieldCount1, book.shieldCount2]) expect(cards[5]!.art).toContain(shieldCount);
    }
    expect(russian[1]!.art).toContain('100</text>');
    expect(russian[5]!.art).toContain('1 щит');
  });
});

it('preserves every Russian card text and SVG byte against the pre-localization baseline',()=>{
 expect(RULE_CARDS.map(card=>createHash('sha256').update(JSON.stringify(card)).digest('hex'))).toEqual(baseline.hashes);
});
