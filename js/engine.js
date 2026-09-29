// Pure logic: passage lookups, red-flag rules, visit questions.
// No DOM, no storage, no fetch — the app passes data in, and tests/ import
// this module directly under Node. Keep it that way.

export const LEVELS = ['call', 'er', 'contact']; // escalation-only; no "ok" level exists
export const URETERAL = ['proximal', 'mid', 'distal', 'uvj'];
export const LOCATIONS = ['kidney', ...URETERAL, 'unknown'];
export const CHECKIN_FLAGS = ['fever', 'chills', 'painUncontrolled', 'vomiting', 'cantUrinate', 'faint'];
export const SAFETY_FIELDS = ['feverNow', 'pregnant', 'solitary', 'transplant', 'ckd', 'minor'];

// ---------- bands ----------

export function inBand(x, b) {
  if (b.gt !== undefined && !(x > b.gt)) return false;
  if (b.gte !== undefined && !(x >= b.gte)) return false;
  if (b.lt !== undefined && !(x < b.lt)) return false;
  if (b.lte !== undefined && !(x <= b.lte)) return false;
  return true;
}

export function findBand(bands, x) {
  return bands.find((b) => inBand(x, b)) || null;
}

// Resolve "$a.b.0.c" references into evidence.json so numbers live in one place.
export function resolveVar(ev, v) {
  if (typeof v !== 'string' || !v.startsWith('$')) return v;
  return v.slice(1).split('.').reduce((o, k) => (o == null ? undefined : o[k]), ev);
}

export function resolveVars(ev, vars = {}) {
  const out = {};
  for (const [k, v] of Object.entries(vars)) out[k] = resolveVar(ev, v);
  return out;
}

// ---------- stone report explainer ----------

export function validSize(size, ev) {
  const n = Number(size);
  return Number.isFinite(n) && n >= ev.passage.minSizeMm && n <= ev.passage.maxSizeMm;
}

export function metCategory(size, loc, maxMm) {
  if (loc === 'kidney') return 'notUreteral';
  if (size > maxMm) return 'overMax';
  if (loc === 'distal' || loc === 'uvj') return 'strong';
  if (loc === 'mid' || loc === 'proximal') return 'conditional';
  return 'locationUnknown';
}

// Population-level figures only. Returns ranges and cited cohort values —
// never a single personal probability.
export function explain(stone, ev) {
  if (!stone || !validSize(stone.sizeMm, ev)) return { valid: false };
  const size = Number(stone.sizeMm);
  const loc = LOCATIONS.includes(stone.location) ? stone.location : 'unknown';
  const p = ev.passage;
  const out = { valid: true, size, loc, ureteralCohortApplies: loc !== 'kidney' };

  if (out.ureteralCohortApplies) {
    const coll = findBand(p.collSize.bands, size);
    const jend = findBand(p.jendebergWidth.bands, size);
    out.sizeEstimates = [
      { source: p.collSize.source, band: coll.label, pct: coll.pct },
      { source: p.jendebergWidth.source, band: jend.label, pct: jend.pct },
    ];
    const pcts = out.sizeEstimates.map((e) => e.pct);
    out.sizeRange = { low: Math.min(...pcts), high: Math.max(...pcts) };
    out.locationEstimate = URETERAL.includes(loc)
      ? { source: p.collLocation.source, pct: p.collLocation.values[loc] }
      : null;
    const m = findBand(p.millerTime.bands, size);
    out.timing = m ? { ...m, source: p.millerTime.source } : { outOfRange: true, source: p.millerTime.source };
  }
  out.met = metCategory(size, loc, ev.met.maxSizeMm);
  return out;
}

// ---------- rules ----------

export function evalCond(c, ctx) {
  if (c.any) return c.any.some((x) => evalCond(x, ctx));
  if (c.all) return c.all.every((x) => evalCond(x, ctx));
  const v = ctx[c.field];
  if ('eq' in c) return v === c.eq;
  if ('gte' in c) return typeof v === 'number' && Number.isFinite(v) && v >= c.gte;
  if ('lte' in c) return typeof v === 'number' && Number.isFinite(v) && v <= c.lte;
  if ('in' in c) return c.in.includes(v);
  throw new Error(`Unsupported rule condition: ${JSON.stringify(c)}`);
}

// Fired rules for one scope, most urgent first.
export function evaluate(rulesDoc, scope, ctx) {
  return rulesDoc.rules
    .filter((r) => r.scope === scope && evalCond(r.when, ctx))
    .sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
}

export function topLevel(fired) {
  return fired.length ? fired[0].level : null;
}

// ---------- dates (local calendar days as YYYY-MM-DD; DST-safe) ----------

export function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysBetween(fromIso, toIso) {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function hasSymptoms(c) {
  if (!c) return false;
  return (Number(c.pain) || 0) > 0 || CHECKIN_FLAGS.some((f) => c[f] === true);
}

// Timeline context for "course" rules.
//   profile.dxAt: ISO datetime of diagnosis/discharge
//   stone.passedDate / stone.passedSure
//   settings.persistHours: optional local re-check window
//   latest: most recent check-in (or null)
export function courseContext({ profile, stone, settings, latest, now = new Date() }) {
  const dxAt = profile && profile.dxAt ? new Date(profile.dxAt) : null;
  const daysElapsed = dxAt ? daysBetween(isoDate(dxAt), isoDate(now)) : 0;
  const passed = !!(stone && stone.passedDate);
  const passedConfirmed = passed && stone.passedSure === true;
  const persistHours = Number(settings && settings.persistHours) || 0;
  const hoursSinceDx = dxAt ? (now - dxAt) / 3600000 : 0;
  const latestIsRecent = latest && daysBetween(latest.date, isoDate(now)) <= 1;
  const persistWindowExceeded =
    persistHours > 0 && hoursSinceDx >= persistHours && !passed && latestIsRecent && hasSymptoms(latest);
  return { daysElapsed, dayNumber: daysElapsed + 1, passed, passedConfirmed, persistWindowExceeded: !!persistWindowExceeded };
}

// Normalise a raw check-in form into the rule context.
export function checkinContext(c) {
  const ctx = {};
  for (const f of CHECKIN_FLAGS) ctx[f] = c[f] === true;
  const t = c.tempC === '' || c.tempC == null ? NaN : Number(c.tempC);
  ctx.tempC = Number.isFinite(t) ? t : null;
  return ctx;
}

export const cToF = (c) => Math.round((c * 9) / 5 * 10 + 320) / 10;
// Stored to 0.01 °C so a value entered in °F round-trips exactly at 0.1 °F.
export const fToC = (f) => Math.round(((f - 32) * 5) / 9 * 100) / 100;

// ---------- visit question builder ----------

// Returns [{id, vars?}] in display order. Order is stable so users can
// toggle items and the ids stay meaningful across sessions.
export function buildQuestions({ stone = {}, highRisk = {}, checkins = [], ev, rulesDoc }) {
  const qs = [];
  const add = (id, vars) => qs.push(vars ? { id, vars } : { id });
  const ex = explain(stone, ev);
  const passed = !!stone.passedDate;

  add('analysis');
  add('highRisk');
  add('urine24', { emphasis: Object.values(highRisk).some(Boolean) });
  add('imaging');

  if (ex.valid) {
    if (stone.onMet === 'yes') add('metDuration');
    else if (ex.met === 'strong' || ex.met === 'conditional') add('metConsider');
    if (!passed && (ex.size >= ev.optionsQuestionMinMm || ex.met === 'overMax' || ex.loc === 'proximal')) add('options');
    if (ex.loc === 'kidney') add('kidney');
  }
  if (stone.stent === 'yes') add('stent');

  add('fluid');
  add('diet');
  add('pain');

  const flaggedDates = checkins
    .filter((c) => evaluate(rulesDoc, 'checkin', checkinContext(c)).length > 0)
    .map((c) => c.date)
    .sort();
  if (flaggedDates.length) add('redFlags', { dates: flaggedDates });

  return qs;
}
