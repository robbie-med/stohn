import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { LOCALES, readyLocales, translate } from '../js/i18n.js';
import { ev, rules, readJSON, readText } from './helpers.js';

const en = readJSON('locales/en.json');
const placeholders = (v) =>
  new Set((typeof v === 'object' ? Object.values(v).join(' ') : v).match(/\{\w+\}/g) || []);

test('every ready locale has exactly the English keys and placeholders', () => {
  for (const lang of readyLocales()) {
    const d = readJSON(`locales/${lang}.json`);
    const missing = Object.keys(en).filter((k) => !(k in d));
    const extra = Object.keys(d).filter((k) => !(k in en));
    assert.deepEqual(missing, [], `${lang} missing keys`);
    assert.deepEqual(extra, [], `${lang} has extra keys`);
    for (const k of Object.keys(en)) {
      const want = placeholders(en[k]);
      const got = placeholders(d[k]);
      // plural forms may omit {n} where the language spells the number out, but must not invent placeholders
      for (const p of got) assert.ok(want.has(p), `${lang}:${k} has unknown ${p}`);
      if (typeof en[k] === 'string') assert.deepEqual([...got].sort(), [...want].sort(), `${lang}:${k} placeholders`);
      if (typeof d[k] === 'object') assert.ok('other' in d[k], `${lang}:${k} plural needs 'other'`);
    }
  }
});

test('planned locales are registered but not yet shipped', () => {
  assert.equal(LOCALES.fr.status, 'planned');
  assert.equal(LOCALES.ru.status, 'planned');
  assert.deepEqual(readyLocales(), ['en', 'ko']);
});

test('all dynamic keys the app builds exist in English', () => {
  const keys = [
    ...E.LEVELS.flatMap((l) => [`level.${l}`, `esc.${l}.title`, `esc.${l}.body`]),
    ...rules.rules.map((r) => `rule.${r.id}`),
    ...E.LOCATIONS.map((l) => `loc.${l}`),
    ...['strong', 'conditional', 'overMax', 'notUreteral', 'locationUnknown'].map((m) => `ex.met.${m}`),
    ...E.CHECKIN_FLAGS.flatMap((f) => [`flag.${f}`, `checkin.${f}`]),
    ...E.SAFETY_FIELDS.map((f) => `safety.${f}`),
    ...ev.highRisk.factors.map((f) => `hr.${f}`),
    ...ev.sections.flatMap((s) => [`evs.${s.id}`, ...s.facts.map((f) => `evf.${f.key}`)]),
    ...ev.links.map((l) => `link.${l.id}`),
    ...['today', 'checkin', 'stone', 'visit', 'more'].map((n) => `nav.${n}`),
  ];
  const qIds = new Set(['analysis', 'highRisk', 'urine24', 'imaging', 'metConsider', 'metDuration', 'options', 'stent', 'kidney', 'fluid', 'diet', 'pain', 'redFlags']);
  keys.push(...[...qIds].map((q) => `q.${q}`));
  for (const k of keys) assert.ok(k in en, `missing en key ${k}`);
});

test('every literal t("...") key in app.js exists in English', () => {
  const src = readText('js/app.js');
  const used = [...src.matchAll(/\b(?:t|ui)\('([\w.]+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 100);
  for (const k of used) assert.ok(k in en, `app.js uses missing key ${k}`);
});

test('translate: fallback, interpolation, plurals', () => {
  const ko = readJSON('locales/ko.json');
  assert.equal(translate({}, en, 'today.day', { n: 3 }, 'en'), 'Day 3');
  assert.equal(translate(ko, en, 'today.day', { n: 3 }, 'ko'), '3일째');
  assert.equal(translate({}, en, 'visit.hrAny', { n: 1 }, 'en').startsWith('You ticked 1 item.'), true);
  assert.equal(translate({}, en, 'visit.hrAny', { n: 2 }, 'en').startsWith('You ticked 2 items.'), true);
  assert.match(translate(ko, en, 'visit.hrAny', { n: 1 }, 'ko'), /^1개/);
  assert.equal(translate({}, en, 'no.such.key'), 'no.such.key');
});
