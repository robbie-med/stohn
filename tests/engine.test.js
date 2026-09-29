import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { ev, rules } from './helpers.js';

test('band edges match the documented assignments', () => {
  const coll = (x) => E.findBand(ev.passage.collSize.bands, x).pct;
  assert.equal(coll(1), 87);
  assert.equal(coll(1.5), 76);
  assert.equal(coll(4.4), 76);
  assert.equal(coll(4.5), 60);
  assert.equal(coll(7), 48); // overlap 5–7 / 7–9: 7 mm goes to 7–9
  assert.equal(coll(9), 48);
  assert.equal(coll(9.1), 25);
  const jend = (x) => E.findBand(ev.passage.jendebergWidth.bands, x).pct;
  assert.equal(jend(2), 98);
  assert.equal(jend(4), 81);
  assert.equal(jend(6.4), 33);
  assert.equal(jend(6.5), 9);
  const miller = (x) => E.findBand(ev.passage.millerTime.bands, x);
  assert.equal(miller(2).meanDays, 8.2);
  assert.equal(miller(2.1).meanDays, 12.2);
  assert.equal(miller(4).meanDays, 22.1);
  assert.equal(miller(6.1), null);
});

test('every size in range lands in exactly one band per cohort', () => {
  for (let x = ev.passage.minSizeMm; x <= ev.passage.maxSizeMm; x = Math.round((x + 0.1) * 10) / 10) {
    for (const key of ['collSize', 'jendebergWidth']) {
      const hits = ev.passage[key].bands.filter((b) => E.inBand(x, b));
      assert.equal(hits.length, 1, `${key} at ${x} mm matched ${hits.length} bands`);
    }
    const m = ev.passage.millerTime.bands.filter((b) => E.inBand(x, b));
    assert.ok(m.length <= 1, `millerTime at ${x} mm matched ${m.length} bands`);
  }
});

test('explain returns ranges, never a single personal prediction', () => {
  const r = E.explain({ sizeMm: 6, location: 'distal' }, ev);
  assert.equal(r.valid, true);
  assert.deepEqual(r.sizeRange, { low: 33, high: 60 });
  assert.equal(r.locationEstimate.pct, 75);
  assert.equal(r.met, 'strong');
  assert.equal(r.timing.meanDays, 22.1);
});

test('explain handles kidney, unknown, large and invalid input', () => {
  const k = E.explain({ sizeMm: 5, location: 'kidney' }, ev);
  assert.equal(k.ureteralCohortApplies, false);
  assert.equal(k.sizeEstimates, undefined);
  assert.equal(k.met, 'notUreteral');
  const u = E.explain({ sizeMm: 3, location: 'bogus' }, ev);
  assert.equal(u.loc, 'unknown');
  assert.equal(u.locationEstimate, null);
  assert.equal(u.met, 'locationUnknown');
  assert.equal(E.explain({ sizeMm: 12, location: 'proximal' }, ev).met, 'overMax');
  assert.equal(E.explain({ sizeMm: 10, location: 'mid' }, ev).met, 'conditional');
  assert.equal(E.explain({ sizeMm: 12, location: 'uvj' }, ev).timing.outOfRange, true);
  for (const bad of [0, -1, 31, 'abc', null, undefined, '']) {
    assert.equal(E.explain({ sizeMm: bad, location: 'distal' }, ev).valid, false, `size ${bad}`);
  }
});

test('checkin rules: each danger sign escalates; nothing ever de-escalates', () => {
  const run = (c) => E.evaluate(rules, 'checkin', E.checkinContext(c));
  assert.equal(run({}).length, 0);
  assert.equal(E.topLevel(run({ faint: true })), 'call');
  assert.equal(E.topLevel(run({ fever: true })), 'er');
  assert.equal(E.topLevel(run({ chills: true })), 'er');
  assert.equal(E.topLevel(run({ tempC: 38.0 })), 'er');
  assert.equal(run({ tempC: 37.9 }).length, 0);
  assert.equal(run({ tempC: '' }).length, 0);
  assert.equal(E.topLevel(run({ painUncontrolled: true })), 'er');
  assert.equal(E.topLevel(run({ vomiting: true })), 'er');
  assert.equal(E.topLevel(run({ cantUrinate: true })), 'er');
  // most urgent first
  const both = run({ faint: true, vomiting: true });
  assert.deepEqual(both.map((r) => r.level), ['call', 'er']);
  // pain score alone is not a rule input, and "stone seen" never escalates or clears anything
  assert.equal(run({ pain: 10 }).length, 0);
  assert.equal(E.topLevel(run({ stoneSeen: true, fever: true })), 'er');
});

test('100.4 °F converts to the 38.0 °C threshold', () => {
  assert.equal(E.fToC(100.4), 38);
  assert.equal(E.cToF(38), 100.4);
});

test('safety screen', () => {
  const run = (s) => E.evaluate(rules, 'safety', s);
  const none = Object.fromEntries(E.SAFETY_FIELDS.map((f) => [f, false]));
  assert.equal(run(none).length, 0);
  assert.equal(E.topLevel(run({ ...none, feverNow: true })), 'er');
  for (const f of ['pregnant', 'solitary', 'transplant', 'ckd', 'minor']) {
    const fired = run({ ...none, [f]: true });
    assert.equal(fired.length, 1, f);
    assert.equal(fired[0].outOfScope, true, f);
  }
});

test('course rules: four-week check and local re-check window', () => {
  const now = new Date('2026-10-01T12:00:00');
  const ctx = (o) =>
    E.courseContext({
      profile: { dxAt: o.dxAt || '2026-09-30T08:00:00' },
      stone: o.stone || {},
      settings: o.settings || {},
      latest: o.latest || null,
      now,
    });
  const run = (o) => E.evaluate(rules, 'course', ctx(o)).map((r) => r.id);

  assert.equal(ctx({}).dayNumber, 2);
  assert.deepEqual(run({ dxAt: '2026-09-04T08:00:00' }), []); // 27 days
  assert.deepEqual(run({ dxAt: '2026-09-03T08:00:00' }), ['fourWeeks']); // 28 days
  assert.deepEqual(run({ dxAt: '2026-09-03T08:00:00', stone: { passedDate: '2026-09-20', passedSure: true } }), []);
  // passed but unsure still needs confirmation
  assert.deepEqual(run({ dxAt: '2026-09-03T08:00:00', stone: { passedDate: '2026-09-20', passedSure: false } }), ['fourWeeks']);

  const symptomatic = { date: '2026-10-01', pain: 3 };
  assert.deepEqual(run({ settings: { persistHours: 48 }, latest: symptomatic }), []); // 28 h
  assert.deepEqual(run({ dxAt: '2026-09-28T08:00:00', settings: { persistHours: 48 }, latest: symptomatic }), ['persist']);
  assert.deepEqual(run({ dxAt: '2026-09-28T08:00:00', settings: {}, latest: symptomatic }), []); // off unless configured
  assert.deepEqual(run({ dxAt: '2026-09-28T08:00:00', settings: { persistHours: 48 }, latest: { date: '2026-10-01', pain: 0 } }), []);
});

test('daysBetween is calendar-based', () => {
  assert.equal(E.daysBetween('2026-03-07', '2026-03-09'), 2); // US DST change
  assert.equal(E.daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('visit questions follow the entered state', () => {
  const ids = (o) => E.buildQuestions({ ev, rulesDoc: rules, ...o }).map((q) => q.id);
  const base = ids({});
  for (const id of ['analysis', 'highRisk', 'urine24', 'imaging', 'fluid', 'diet', 'pain']) assert.ok(base.includes(id), id);
  assert.ok(!base.includes('redFlags'));

  assert.ok(ids({ stone: { sizeMm: 4, location: 'distal', onMet: 'no' } }).includes('metConsider'));
  assert.ok(ids({ stone: { sizeMm: 4, location: 'distal', onMet: 'yes' } }).includes('metDuration'));
  assert.ok(!ids({ stone: { sizeMm: 4, location: 'kidney' } }).includes('metConsider'));
  assert.ok(ids({ stone: { sizeMm: 4, location: 'kidney' } }).includes('kidney'));
  assert.ok(ids({ stone: { sizeMm: 6, location: 'distal' } }).includes('options'));
  assert.ok(!ids({ stone: { sizeMm: 6, location: 'distal', passedDate: '2026-09-20' } }).includes('options'));
  assert.ok(ids({ stone: { stent: 'yes' } }).includes('stent'));

  const qs = E.buildQuestions({ ev, rulesDoc: rules, highRisk: { familyHistory: true }, checkins: [{ date: '2026-09-02', fever: true }, { date: '2026-09-01', pain: 2 }] });
  assert.equal(qs.find((q) => q.id === 'urine24').vars.emphasis, true);
  assert.deepEqual(qs.find((q) => q.id === 'redFlags').vars.dates, ['2026-09-02']);
});

test('resolveVars reads numbers from evidence.json', () => {
  assert.deepEqual(E.resolveVars(ev, { a: '$passage.collLocation.values.uvj', b: 7 }), { a: 79, b: 7 });
});

test('°F entries round-trip at 0.1 °F', () => {
  for (let f = 95; f <= 106; f = Math.round((f + 0.1) * 10) / 10) assert.equal(E.cToF(E.fToC(f)), f);
});
