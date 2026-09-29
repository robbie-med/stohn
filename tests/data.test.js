import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { ev, rules } from './helpers.js';

test('rules are escalation-only and use known levels/scopes', () => {
  assert.deepEqual(rules.levels, E.LEVELS);
  const ids = new Set();
  for (const r of rules.rules) {
    assert.ok(E.LEVELS.includes(r.level), `${r.id}: level ${r.level}`);
    assert.ok(['checkin', 'safety', 'course'].includes(r.scope), `${r.id}: scope`);
    assert.ok(!ids.has(r.id), `duplicate rule id ${r.id}`);
    ids.add(r.id);
  }
});

test('every rule cites at least one known source', () => {
  for (const r of rules.rules) {
    assert.ok(r.sources.length > 0, r.id);
    for (const s of r.sources) assert.ok(ev.sources[s], `${r.id} cites unknown source ${s}`);
  }
});

test('every check-in danger field and safety field has a rule', () => {
  const fields = new Set();
  const walk = (c) => (c.any || c.all ? (c.any || c.all).forEach(walk) : fields.add(c.field));
  rules.rules.forEach((r) => walk(r.when));
  for (const f of [...E.CHECKIN_FLAGS, ...E.SAFETY_FIELDS]) assert.ok(fields.has(f), `no rule reads ${f}`);
});

test('evidence facts cite known sources and resolve every $reference', () => {
  for (const sec of ev.sections)
    for (const f of sec.facts) {
      for (const s of f.sources) assert.ok(ev.sources[s], `${f.key} cites unknown ${s}`);
      for (const [k, v] of Object.entries(E.resolveVars(ev, f.vars))) assert.equal(typeof v, 'number', `${f.key}.${k}`);
    }
  for (const s of [...ev.met.sources, ev.highRisk.source]) assert.ok(ev.sources[s], s);
});

test('sources have a way to be looked up', () => {
  for (const [id, s] of Object.entries(ev.sources)) {
    assert.ok(s.short && s.cite, id);
    if (s.pmid) assert.match(s.pmid, /^\d+$/, id);
    if (s.doi) assert.match(s.doi, /^10\.\d{4,}\//, id);
  }
});
