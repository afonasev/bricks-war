#!/usr/bin/env node
// Read-only release identity and menu smoke check for the published game.
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const url = 'https://bricks.afonasev.tech/';
const metadata = JSON.parse(await readFile(new URL('../config/deployment-build.json', import.meta.url), 'utf8'));
if (!metadata.version || !metadata.deployedAt) {
  throw new Error('config/deployment-build.json must contain version and deployedAt from the release being checked');
}

const releaseDate = new Date(metadata.deployedAt);
if (Number.isNaN(releaseDate.getTime())) throw new Error('Invalid release deployedAt');
const expected = `Версия ${metadata.version} · Деплой ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(releaseDate)}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`Release HTTP status: ${response?.status() ?? 'no response'}`);
  const actual = (await page.locator('.release-build-info').first().textContent())?.trim();
  if (actual !== expected) throw new Error(`Release identity mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  const battle = page.getByRole('navigation', { name: 'Главное меню' }).getByRole('button', { name: /^Битва/ });
  if (!(await battle.isVisible())) throw new Error('Published menu has no visible Battle control');
  console.log(JSON.stringify({ url, status: response.status(), version: metadata.version, deployedAt: metadata.deployedAt, footer: actual }));
} finally {
  await browser.close();
}
