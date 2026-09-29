import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readText, ls } from './helpers.js';
import { readyLocales } from '../js/i18n.js';

const sw = readText('sw.js');
const assets = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);

test('every precached asset exists', () => {
  for (const a of assets) assert.ok(existsSync(join(ROOT, a)), `sw.js lists missing ${a}`);
});

test('every shipped js/css/data/locale file is precached', () => {
  const shipped = [
    ...ls('js').map((f) => `js/${f}`),
    ...ls('css').map((f) => `css/${f}`),
    ...ls('data').map((f) => `data/${f}`),
    ...ls('fonts').filter((f) => f.endsWith('.woff2')).map((f) => `fonts/${f}`),
    ...readyLocales().map((l) => `locales/${l}.json`),
  ];
  for (const f of shipped) assert.ok(assets.includes(f), `sw.js is missing ${f}`);
});

test('index.html has no inline script or style (CSP: self only)', () => {
  const html = readText('index.html');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, 'no third-party requests from the shell');
});
