// First Stone — app shell: router, views, dialogs. Vanilla ES modules, no build.
// All clinical logic lives in engine.js; all text lives in locales/*.json.

import * as E from './engine.js';
import * as I from './i18n.js';
import * as S from './store.js';
import * as B from './backup.js';

export const APP_VERSION = '1.3.0';
const REPO_URL = 'https://github.com/robbie-med/stohn';

const state = {
  ev: null,
  rules: null,
  profile: null,
  stone: {},
  settings: {},
  visit: { excluded: [], custom: [], highRisk: {} },
  checkins: [],
  persistent: true,
  t: null,
  flash: null,
};

// ---------- tiny safe templating ----------

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
const raw = (s) => new Raw(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function fmt(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s + (i < vals.length ? fmt(vals[i]) : '');
  });
  return raw(out);
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- helpers ----------

const today = () => E.isoDate(new Date());
const emergencyNumber = () => state.settings.emergency || I.LOCALES[state.t.lang].emergency;
const telHref = (n) => `tel:${String(n).replace(/[^\d+]/g, '')}`;

function sourceChips(ids) {
  const { t } = state;
  return html`<span class="chips" aria-label="${t('common.sources')}">${ids.map((id) => {
    const s = state.ev.sources[id];
    if (!s) return '';
    const href = s.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/` : s.url || '#/evidence';
    const ext = href.startsWith('http');
    return html`<a class="chip" href="${href}" ${ext ? raw('target="_blank" rel="noopener noreferrer"') : ''}>${s.short}</a>`;
  })}</span>`;
}

function radios(name, options, current, required = false) {
  return options.map(
    (o) => html`<label class="choice"><input type="radio" name="${name}" value="${o.value}" ${current === o.value ? raw('checked') : ''} ${required ? raw('required') : ''}><span>${o.label}</span></label>`,
  );
}

function yesNo(name, current, required = false) {
  const { t } = state;
  return radios(name, [{ value: 'yes', label: t('common.yes') }, { value: 'no', label: t('common.no') }], current, required);
}

function yesNoUnsure(name, current) {
  const { t } = state;
  return radios(
    name,
    [
      { value: 'yes', label: t('common.yes') },
      { value: 'no', label: t('common.no') },
      { value: 'unsure', label: t('common.unsure') },
    ],
    current,
  );
}

function localDateTimeValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flash(msg) {
  state.flash = msg;
}

async function saveKV(key) {
  await S.set(key, state[key]);
}

// ---------- escalation dialog ----------

function showEscalation(fired, { onClose } = {}) {
  const { t } = state;
  const level = E.topLevel(fired);
  if (!level) return;
  const outOfScope = fired.some((r) => r.outOfScope);
  const num = emergencyNumber();
  const dlg = $('#escalation');
  const sources = [...new Set(fired.flatMap((r) => r.sources))];
  dlg.className = `escalation level-${level}`;
  dlg.innerHTML = html`
    <form method="dialog">
      <p class="label label-${level}">${t(`level.${level}`)}</p>
      <h2 id="esc-title">${t(`esc.${level}.title`)}</h2>
      <p>${t(`esc.${level}.body`, { number: num })}</p>
      ${level !== 'contact' ? html`<a class="btn btn-danger btn-block" href="${telHref(num)}">${t('banner.call', { number: num })}</a>` : ''}
      ${outOfScope ? html`<div class="scope-box"><h3>${t('scope.title')}</h3><p>${t('scope.body')}</p><p class="muted">${t('scope.limited')}</p></div>` : ''}
      <h3>${t('esc.why')}</h3>
      <ul class="reasons">${fired.map((r) => html`<li>${t(`rule.${r.id}`, { hours: state.settings.persistHours })}</li>`)}</ul>
      <p class="muted small">${t('common.sources')}: ${sourceChips(sources)}</p>
      <button class="btn btn-block" value="ack">${outOfScope ? t('scope.continue') : t('esc.ack')}</button>
    </form>`.s;
  dlg.setAttribute('aria-labelledby', 'esc-title');
  dlg.addEventListener('close', () => onClose && onClose(), { once: true });
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

// ---------- shared fragments ----------

// Plain answer first (will it pass, how long, does medicine matter, what to do),
// with the cited cohort figures folded under "Where these numbers come from".
function plainAnswer(ex, stone) {
  const { t, ev } = state;
  const weeks = (d) => t('ex.weeks', { n: E.toWeeks(d) });
  const lines = [];
  if (ex.outlook) lines.push(html`<p class="lead">${t(`ex.pass.${ex.outlook}`)}</p>`);
  else lines.push(html`<p class="lead">${t('ex.pass.kidney')}</p>`);
  if (ex.loc === 'distal' || ex.loc === 'uvj') lines.push(html`<p>${t('ex.where.low')}</p>`);
  else if (ex.loc === 'proximal' || ex.loc === 'mid') lines.push(html`<p>${t('ex.where.high')}</p>`);
  if (ex.timing) {
    lines.push(
      html`<p class="lead">${ex.timing.outOfRange
        ? t('ex.time.big')
        : t('ex.time.typical', { typ: weeks(ex.timing.meanDays), max: weeks(ex.timing.p95Days) })}</p>`,
    );
  }
  if (ex.metEffect) lines.push(html`<p>${t(`ex.metEffect.${ex.metEffect}`, { days: Math.round(ev.met.fasterDays) })} ${t('ex.metDecision')}</p>`);
  return html`
    <h2>${t('ex.answerTitle')}</h2>
    ${lines}
    <p class="note">${t('ex.population')}</p>
    <h3>${t('ex.doTitle')}</h3>
    <ul class="dolist">
      <li>${t('ex.do.strain')}</li>
      <li>${t('ex.do.checkin')}</li>
      <li>${t('ex.do.fourWeeks')}</li>
    </ul>`;
}

function explainerHtml(stone) {
  const { t, ev } = state;
  const ex = E.explain(stone, ev);
  if (!ex.valid) return '';
  const p = ev.passage;
  const parts = [];

  if (ex.ureteralCohortApplies) {
    const { low, high } = ex.sizeRange;
    const [coll, jend] = ex.sizeEstimates;
    parts.push(html`
      <p>${low === high ? t('ex.sizeSingle', { pct: low }) : t('ex.sizeRange', { low, high })}</p>
      <ul class="plain">
        <li>${t('ex.collRow', { band: coll.band, pct: coll.pct, n: p.collSize.n })} ${sourceChips([coll.source])}</li>
        <li>${t('ex.jendRow', { band: jend.band, pct: jend.pct, n: p.jendebergWidth.n, weeks: p.jendebergWidth.windowWeeks })} ${sourceChips([jend.source])}</li>
      </ul>`);
    if (ex.locationEstimate) {
      parts.push(html`<p>${t('ex.locationRow', { pct: ex.locationEstimate.pct })} ${sourceChips([ex.locationEstimate.source])}</p>`);
    } else {
      const v = p.collLocation.values;
      parts.push(html`<p>${t('ex.unknownLoc', { p: v.proximal, u: v.uvj })} ${sourceChips([p.collLocation.source])}</p>`);
    }
    const tm = ex.timing;
    parts.push(html`<h3>${t('ex.timingTitle')}</h3><p>${
      tm.outOfRange
        ? t('ex.timingOut')
        : t('ex.timing', { n: p.millerTime.n, band: tm.label, mean: t.num(tm.meanDays), p95: tm.p95Days, intervention: t.num(tm.interventionPct) })
    } ${t('ex.timingNoMet')} ${sourceChips([tm.source])}</p>`);
  } else {
    parts.push(html`<p>${t('ex.kidney')}</p>`);
  }

  parts.push(html`
    <h3>${t('ex.metTitle')}</h3>
    <p>${t(`ex.met.${ex.met}`, { mm: ev.met.maxSizeMm, days: ev.met.windowDays })}</p>
    ${ex.met === 'strong' || ex.met === 'conditional' ? html`<p>${t('ex.metTrials')}</p>` : ''}
    ${stone.onMet === 'yes' ? html`<p>${t('ex.metYou')}</p>` : ''}
    <p>${sourceChips(ev.met.sources)}</p>
    <p>${t('ex.confirm')} ${sourceChips(['aua2026surg'])}</p>
    <h3>${t('ex.limitsTitle')}</h3>
    <ul class="limits">
      <li>${t('ex.limit0')}</li><li>${t('ex.limit1')}</li><li>${t('ex.limit2')}</li><li>${t('ex.limit3')}</li><li>${t('ex.limit4')}</li>
    </ul>`);

  return html`
    ${plainAnswer(ex, stone)}
    <details class="more">
      <summary>${t('ex.detailsTitle')}</summary>
      ${parts}
    </details>`;
}

function firedCard(fired) {
  const { t } = state;
  const level = E.topLevel(fired);
  return html`<div class="alert level-${level}" role="alert">
    <p class="label label-${level}">${t(`level.${level}`)}</p>
    <ul class="reasons">${fired.map((r) => html`<li>${t(`rule.${r.id}`, { hours: state.settings.persistHours })}</li>`)}</ul>
    ${level !== 'contact' ? html`<a class="btn btn-danger" href="${telHref(emergencyNumber())}">${t('banner.call', { number: emergencyNumber() })}</a>` : ''}
    <p class="small">${sourceChips([...new Set(fired.flatMap((r) => r.sources))])}</p>
  </div>`;
}

function flagList(c, t) {
  const names = E.CHECKIN_FLAGS.filter((f) => c[f]).map((f) => t(`flag.${f}`));
  if (typeof c.tempC === 'number') {
    const unit = state.settings.tempUnit || 'C';
    const v = unit === 'F' ? `${E.cToF(c.tempC)} °F` : `${Math.round(c.tempC * 10) / 10} °C`;
    if (c.tempC >= 38) names.push(v);
  }
  return names;
}

// ---------- views ----------

const views = {};

views.start = () => {
  const { t } = state;
  const s = (state.profile && state.profile.safety) || {};
  const dx = state.profile && state.profile.dxAt ? new Date(state.profile.dxAt) : new Date();
  return {
    html: html`
      <h1 tabindex="-1">${t('start.title')}</h1>
      <p>${t('start.intro')}</p>
      <p class="note">${t('start.private')}</p>
      <form id="start-form" novalidate>
        <fieldset>
          <legend><h2>${t('start.safetyTitle')}</h2></legend>
          <p class="muted">${t('start.safetyHelp')}</p>
          ${E.SAFETY_FIELDS.map(
            (f) => html`<div class="q" role="radiogroup" aria-labelledby="lbl-${f}"><p id="lbl-${f}">${t(`safety.${f}`)}</p><div class="choices">${yesNo(f, s[f] === undefined ? null : s[f] ? 'yes' : 'no', true)}</div></div>`,
          )}
        </fieldset>
        <label class="field"><span>${t('start.dxLabel')}</span>
          <input type="datetime-local" name="dxAt" value="${localDateTimeValue(dx)}" max="${localDateTimeValue(new Date())}" required>
          <small class="muted">${t('start.dxHelp')}</small>
        </label>
        <p class="error" id="start-error" hidden>${t('start.needAll')}</p>
        <button class="btn btn-primary btn-block" type="submit">${t('start.continue')}</button>
      </form>`,
    mount(root) {
      $('#start-form', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const safety = {};
        for (const f of E.SAFETY_FIELDS) {
          const v = fd.get(f);
          if (!v) {
            $('#start-error', root).hidden = false;
            $(`[name="${f}"]`, root).focus();
            return;
          }
          safety[f] = v === 'yes';
        }
        const dxVal = fd.get('dxAt');
        const fired = E.evaluate(state.rules, 'safety', safety);
        state.profile = {
          ...(state.profile || {}),
          createdAt: (state.profile && state.profile.createdAt) || new Date().toISOString(),
          dxAt: dxVal ? new Date(dxVal).toISOString() : new Date().toISOString(),
          safety,
          outOfScope: fired.some((r) => r.outOfScope),
          onboarded: true,
        };
        await saveKV('profile');
        const next = () => go(E.explain(state.stone, state.ev).valid ? '#/today' : '#/stone');
        if (fired.length) showEscalation(fired, { onClose: next });
        else next();
      });
    },
  };
};

views.today = () => {
  const { t, ev } = state;
  const latest = state.checkins[state.checkins.length - 1] || null;
  const course = E.courseContext({ profile: state.profile, stone: state.stone, settings: state.settings, latest });
  const courseFired = E.evaluate(state.rules, 'course', course);
  const todays = state.checkins.find((c) => c.date === today());
  const todaysFired = todays ? E.evaluate(state.rules, 'checkin', E.checkinContext(todays)) : [];
  const lastFlagged = !todays && latest && E.evaluate(state.rules, 'checkin', E.checkinContext(latest)).length > 0;
  const ex = E.explain(state.stone, ev);
  const passed = !!state.stone.passedDate;

  return {
    html: html`
      <h1 tabindex="-1" class="sr-only">${t('today.title')}</h1>
      ${state.profile.outOfScope ? html`<div class="alert level-contact"><p>${t('scope.banner')}</p></div>` : ''}
      ${!state.persistent ? html`<div class="alert level-contact"><p>${t('today.memoryWarn')}</p></div>` : ''}
      <section class="day">
        <p class="day-num">${t('today.day', { n: course.dayNumber })}</p>
        <p class="muted">${t('today.since', { date: t.date(state.profile.dxAt) })}</p>
        ${!passed && (ex.met === 'strong' || ex.met === 'conditional') ? html`<p class="small muted">${t('today.window', { days: ev.met.windowDays })}</p>` : ''}
      </section>

      <p><a class="btn" href="#/pain">${t('today.painLink')}</a></p>

      ${courseFired.length ? html`<section><h2>${t('today.alerts')}</h2>${firedCard(courseFired)}</section>` : ''}

      <section class="sec">
        <h2>${t('nav.checkin')}</h2>
        ${todays
          ? html`<p>${t('today.checkinDone')}</p>
              ${todaysFired.length ? firedCard(todaysFired) : html`<p class="muted">${t('today.noFlags')}</p>`}
              <a class="btn" href="#/checkin">${t('today.editCheckin')}</a>`
          : html`<p>${t('today.checkinDue')}</p>
              ${lastFlagged ? html`<p class="warn-text">${t('today.lastCheckin', { date: t.date(latest.date) })}</p>` : ''}
              <a class="btn btn-primary btn-block" href="#/checkin">${t('today.checkinBtn')}</a>`}
      </section>

      <section class="sec">
        <h2>${t('today.stoneTitle')}</h2>
        ${ex.valid
          ? html`<p class="mono">${t('today.stoneLine', { size: t.num(ex.size), location: t(`loc.${ex.loc}`) })}</p>
              <p>${ex.outlook ? t(`ex.pass.${ex.outlook}`) : t('ex.pass.kidney')}</p>
              <a class="btn" href="#/stone">${t('stone.show')}</a>`
          : html`<p>${t('today.noStone')}</p><a class="btn btn-primary" href="#/stone">${t('today.addStone')}</a>`}
        <hr>
        ${passed
          ? html`<p>${state.stone.passedSure ? t('today.passedOn', { date: t.date(state.stone.passedDate) }) : t('today.passedUnsure', { date: t.date(state.stone.passedDate) })}</p>`
          : html`<a class="btn" href="#/passed">${t('today.passedBtn')}</a>`}
      </section>

      <section class="sec">
        <h2>${t('today.next')}</h2>
        <div class="stack">
          <a class="btn" href="#/visit">${t('today.visitBtn')}</a>
          <a class="btn" href="#/summary">${t('today.summaryBtn')}</a>
        </div>
      </section>`,
  };
};

views.checkin = (dateParam) => {
  const { t } = state;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || '') ? dateParam : today();
  const c = state.checkins.find((x) => x.date === date) || { date, pain: 0 };
  const unit = state.settings.tempUnit || 'C';
  const tempVal = typeof c.tempC === 'number' ? (unit === 'F' ? E.cToF(c.tempC) : Math.round(c.tempC * 10) / 10) : '';
  const result = state.lastCheckinResult && state.lastCheckinResult.date === date ? state.lastCheckinResult : null;
  state.lastCheckinResult = null;
  const box = (name) =>
    html`<label class="toggle"><input type="checkbox" name="${name}" ${c[name] ? raw('checked') : ''}><span>${t(`checkin.${name}`)}</span></label>`;

  return {
    html: html`
      <h1 tabindex="-1">${t('checkin.title')}</h1>
      ${result
        ? html`<div aria-live="polite">${result.fired.length ? firedCard(result.fired) : html`<div class="alert level-none"><p>${t('checkin.resultNone')}</p></div>`}
            ${result.pain > 0 ? html`<p><a class="btn" href="#/pain">${t('checkin.painLink')}</a></p>` : ''}
            ${result.stoneSeen && !state.stone.passedDate ? html`<p><a class="btn" href="#/passed">${t('checkin.stoneSeenNext')}</a></p>` : ''}</div>`
        : html`<p class="muted">${t('checkin.intro')}</p>`}
      <form id="checkin-form">
        <label class="field"><span>${t('checkin.date')}</span>
          <input type="date" name="date" value="${date}" max="${today()}" required></label>
        <label class="field"><span>${t('checkin.pain')} — <output id="pain-out" class="mono">${t('checkin.painValue', { n: c.pain || 0 })}</output></span>
          <input type="range" name="pain" min="0" max="10" step="1" value="${c.pain || 0}" aria-describedby="pain-help">
          <small id="pain-help" class="muted">${t('checkin.painScale')}</small></label>
        <fieldset>
          <legend><h2>${t('checkin.flagsTitle')}</h2></legend>
          ${box('fever')}
          <label class="field inline"><span>${t('checkin.temp')} (${unit === 'F' ? t('common.optional') + ', °F' : t('common.optional') + ', °C'})</span>
            <input type="number" name="temp" inputmode="decimal" step="0.1" min="${unit === 'F' ? 90 : 32}" max="${unit === 'F' ? 110 : 43}" value="${tempVal}"></label>
          ${box('chills')}${box('painUncontrolled')}${box('vomiting')}${box('cantUrinate')}${box('faint')}
        </fieldset>
        ${box('stoneSeen')}
        <label class="field"><span>${t('checkin.notes')} (${t('common.optional')})</span>
          <textarea name="notes" rows="3" maxlength="2000" placeholder="${t('checkin.notesPh')}">${c.notes || ''}</textarea></label>
        <button class="btn btn-primary btn-block" type="submit">${t('checkin.save')}</button>
      </form>`,
    mount(root) {
      const range = $('[name="pain"]', root);
      range.addEventListener('input', () => {
        $('#pain-out', root).textContent = t('checkin.painValue', { n: range.value });
      });
      $('[name="date"]', root).addEventListener('change', (e) => {
        if (e.target.value && e.target.value !== date) go(`#/checkin/${e.target.value}`);
      });
      $('#checkin-form', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const rec = { date: fd.get('date') || date, pain: Number(fd.get('pain')) || 0, savedAt: new Date().toISOString() };
        for (const f of [...E.CHECKIN_FLAGS, 'stoneSeen']) rec[f] = fd.get(f) === 'on';
        const tv = parseFloat(String(fd.get('temp') || '').replace(',', '.'));
        rec.tempC = Number.isFinite(tv) ? (unit === 'F' ? E.fToC(tv) : tv) : null;
        rec.notes = String(fd.get('notes') || '').trim();
        await S.putCheckin(rec);
        state.checkins = await S.allCheckins();
        const fired = E.evaluate(state.rules, 'checkin', E.checkinContext(rec));
        state.lastCheckinResult = { date: rec.date, fired, stoneSeen: rec.stoneSeen, pain: rec.pain };
        render();
        if (fired.length) showEscalation(fired);
      });
    },
  };
};

views.log = () => {
  const { t } = state;
  const list = [...state.checkins].reverse();
  return {
    html: html`
      <h1 tabindex="-1">${t('log.title')}</h1>
      ${list.length ? '' : html`<p class="muted">${t('log.empty')}</p>`}
      <ul class="log">${list.map((c) => {
        const flags = flagList(c, t);
        return html`<li class="${flags.length ? 'flagged' : ''}">
          <p><strong>${t.date(c.date, { weekday: 'short', month: 'short', day: 'numeric' })}</strong> · <span class="mono">${t('log.pain', { n: c.pain })}</span></p>
          ${flags.length ? html`<p class="warn-text">${t('log.flags', { list: t.list(flags) })}</p>` : ''}
          ${c.stoneSeen ? html`<p>${t('flag.stoneSeen')}</p>` : ''}
          ${c.notes ? html`<p class="notes">${c.notes}</p>` : ''}
          <div class="row"><a class="btn btn-small" href="#/checkin/${c.date}">${t('common.edit')}</a>
          <button class="btn btn-small btn-ghost" data-del="${c.date}">${t('common.delete')}</button></div>
        </li>`;
      })}</ul>`,
    mount(root) {
      $$('[data-del]', root).forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm(t('log.confirmDelete'))) return;
          await S.deleteCheckin(b.dataset.del);
          state.checkins = await S.allCheckins();
          render();
        }),
      );
    },
  };
};

views.stone = () => {
  const { t, ev } = state;
  const s = state.stone;
  return {
    html: html`
      <h1 tabindex="-1">${t('stone.title')}</h1>
      <p class="muted">${t('stone.intro')}</p>
      <form id="stone-form" novalidate>
        <label class="field"><span>${t('stone.size')}</span>
          <input type="number" name="sizeMm" inputmode="decimal" step="0.1" min="${ev.passage.minSizeMm}" max="${ev.passage.maxSizeMm}" value="${s.sizeMm ?? ''}" required aria-describedby="size-help">
          <small id="size-help" class="muted">${t('stone.sizeHelp')}</small></label>
        <p class="error" id="size-error" hidden>${t('stone.invalid', { min: ev.passage.minSizeMm, max: ev.passage.maxSizeMm })}</p>
        <fieldset><legend>${t('stone.location')}</legend>
          <p class="muted small">${t('stone.locHelp')}</p>
          <div class="choices vertical">${radios('location', E.LOCATIONS.map((l) => ({ value: l, label: t(`loc.${l}`) })), s.location || 'unknown')}</div>
        </fieldset>
        <fieldset><legend>${t('stone.met')}</legend><div class="choices">${yesNoUnsure('onMet', s.onMet || null)}</div></fieldset>
        <fieldset><legend>${t('stone.stent')}</legend><div class="choices">${yesNoUnsure('stent', s.stent || null)}</div></fieldset>
        <button class="btn btn-primary btn-block" type="submit">${t('stone.show')}</button>
      </form>
      <section id="explainer" aria-live="polite">${explainerHtml(s)}</section>`,
    mount(root) {
      $('#stone-form', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const size = parseFloat(String(fd.get('sizeMm') || '').replace(',', '.'));
        if (!E.validSize(size, ev)) {
          $('#size-error', root).hidden = false;
          $('[name="sizeMm"]', root).focus();
          return;
        }
        state.stone = {
          ...state.stone,
          sizeMm: size,
          location: fd.get('location') || 'unknown',
          onMet: fd.get('onMet') || null,
          stent: fd.get('stent') || null,
        };
        await saveKV('stone');
        render();
        $('#explainer').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      });
    },
  };
};

views.passed = () => {
  const { t } = state;
  const s = state.stone;
  return {
    html: html`
      <h1 tabindex="-1">${t('passed.title')}</h1>
      <section class="sec">
        <h2>${t('passed.strainTitle')}</h2>
        <ol><li>${t('passed.strain1')}</li><li>${t('passed.strain2')}</li><li>${t('passed.strain3')}</li></ol>
      </section>
      <form id="passed-form" class="sec">
        <label class="field"><span>${t('passed.dateLabel')}</span>
          <input type="date" name="passedDate" value="${s.passedDate || today()}" max="${today()}" required></label>
        <fieldset><legend>${t('passed.sure')}</legend>
          <div class="choices vertical">${radios('sure', [
            { value: 'yes', label: t('passed.sureYes') },
            { value: 'no', label: t('passed.sureNo') },
          ], s.passedDate ? (s.passedSure ? 'yes' : 'no') : null, true)}</div></fieldset>
        <p class="note">${t('passed.note')} ${sourceChips(['aua2026surg'])}</p>
        <button class="btn btn-primary btn-block" type="submit">${t('passed.save')}</button>
        ${s.passedDate ? html`<button class="btn btn-ghost btn-block" type="button" id="undo-passed">${t('passed.undo')}</button>` : ''}
      </form>`,
    mount(root) {
      $('#passed-form', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (!fd.get('sure')) {
          $('[name="sure"]', root).focus();
          return;
        }
        state.stone = { ...state.stone, passedDate: fd.get('passedDate') || today(), passedSure: fd.get('sure') === 'yes' };
        await saveKV('stone');
        flash(t('common.saved'));
        go('#/today');
      });
      const undo = $('#undo-passed', root);
      if (undo)
        undo.addEventListener('click', async () => {
          const { passedDate, passedSure, ...rest } = state.stone;
          state.stone = rest;
          await saveKV('stone');
          render();
        });
    },
  };
};

function questionText(q, t) {
  if (q.id === 'redFlags') return t('q.redFlags', { dates: t.list(q.vars.dates.map((d) => t.date(d, { month: 'short', day: 'numeric' }))) });
  return t(`q.${q.id}`);
}

function currentQuestions() {
  return E.buildQuestions({ stone: state.stone, highRisk: state.visit.highRisk, checkins: state.checkins, ev: state.ev, rulesDoc: state.rules });
}

views.visit = () => {
  const { t, ev } = state;
  const v = state.visit;
  const qs = currentQuestions();
  const hrCount = ev.highRisk.factors.filter((f) => v.highRisk[f]).length;
  return {
    html: html`
      <h1 tabindex="-1">${t('visit.title')}</h1>
      <p class="muted">${t('visit.intro')}</p>
      <section class="sec">
        <h2>${t('visit.questions')}</h2>
        <ul class="checklist">
          ${qs.map((q) => html`<li><label class="toggle"><input type="checkbox" data-q="${q.id}" ${v.excluded.includes(q.id) ? '' : raw('checked')}>
            <span>${questionText(q, t)}${q.vars && q.vars.emphasis ? html`<br><small class="accent">${t('visit.emphasis')}</small>` : ''}</span></label></li>`)}
          ${v.custom.map((c) => html`<li class="custom"><span>${c.text}</span> <button class="btn btn-small btn-ghost" data-rm="${c.id}">${t('visit.remove')}</button></li>`)}
        </ul>
        <form id="custom-form" class="row">
          <label class="field grow"><span class="sr-only">${t('visit.custom')}</span>
            <input type="text" name="text" maxlength="300" placeholder="${t('visit.custom')}"></label>
          <button class="btn" type="submit">${t('visit.add')}</button>
        </form>
      </section>

      <section class="sec">
        <h2>${t('visit.hrTitle')}</h2>
        <p class="muted">${t('visit.hrIntro')} ${sourceChips([ev.highRisk.source])}</p>
        ${ev.highRisk.factors.map((f) => html`<label class="toggle"><input type="checkbox" data-hr="${f}" ${v.highRisk[f] ? raw('checked') : ''}><span>${t(`hr.${f}`)}</span></label>`)}
        <p class="accent" aria-live="polite">${hrCount ? t('visit.hrAny', { n: hrCount }) : t('visit.hrNone')} ${sourceChips(['aua2014'])}</p>
      </section>

      <section class="sec">
        <h2>${t('visit.knowTitle')}</h2>
        <ul class="plain spaced">
          <li>${t('know.fluid', { l: t.num(2.5) })} ${sourceChips(['aua2014', 'aua2026med', 'eau'])}</li>
          <li>${t('know.calcium')} ${sourceChips(['borghi2002'])}</li>
          <li>${t('know.oxalate')} ${sourceChips(['aua2014'])}</li>
          <li>${t('know.tracking')} ${sourceChips(['push2026'])}</li>
          <li>${t('know.water')} ${sourceChips(['zhang2025', 'qin2025', 'bellizzi1999'])}</li>
        </ul>
      </section>
      <a class="btn btn-primary btn-block" href="#/summary">${t('visit.summaryBtn')}</a>`,
    mount(root) {
      $$('[data-q]', root).forEach((cb) =>
        cb.addEventListener('change', async () => {
          const id = cb.dataset.q;
          v.excluded = cb.checked ? v.excluded.filter((x) => x !== id) : [...new Set([...v.excluded, id])];
          await saveKV('visit');
        }),
      );
      $$('[data-hr]', root).forEach((cb) =>
        cb.addEventListener('change', async () => {
          v.highRisk = { ...v.highRisk, [cb.dataset.hr]: cb.checked };
          await saveKV('visit');
          render();
        }),
      );
      $$('[data-rm]', root).forEach((b) =>
        b.addEventListener('click', async () => {
          v.custom = v.custom.filter((c) => c.id !== b.dataset.rm);
          await saveKV('visit');
          render();
        }),
      );
      $('#custom-form', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = String(new FormData(e.target).get('text') || '').trim();
        if (!text) return;
        v.custom = [...v.custom, { id: `c${Date.now().toString(36)}`, text }];
        await saveKV('visit');
        render();
      });
    },
  };
};

views.summary = () => {
  const ui = state.t;
  const lang = state.summaryLang && I.LOCALES[state.summaryLang] ? state.summaryLang : ui.lang;
  const t = I.translator(lang);
  const s = state.stone;
  const ex = E.explain(s, state.ev);
  const v = state.visit;
  const qs = currentQuestions().filter((q) => !v.excluded.includes(q.id));
  const hr = state.ev.highRisk.factors.filter((f) => v.highRisk[f]);
  const yn = (x) => (x === 'yes' ? t('common.yes') : x === 'no' ? t('common.no') : x === 'unsure' ? t('common.unsure') : t('sum.none'));
  const ready = I.readyLocales();

  return {
    html: html`
      <div class="no-print">
        <h1 tabindex="-1">${ui('sum.title')}</h1>
        <div class="row">
          <label class="field"><span>${ui('sum.lang')}</span>
            <select id="sum-lang">${ready.map((l) => html`<option value="${l}" ${l === lang ? raw('selected') : ''}>${I.LOCALES[l].name}</option>`)}</select></label>
          <button class="btn btn-primary" id="print-btn" type="button">${ui('sum.print')}</button>
        </div>
      </div>
      <article class="printable" lang="${lang}">
        <header>
          <h2>${t('app.name')} — ${t('sum.title')}</h2>
          <p class="small">${t('sum.generated', { date: t.date(new Date().toISOString()) })}</p>
          <p class="small"><strong>${t('banner.text')}</strong></p>
        </header>
        <h3>${t('sum.stoneSection')}</h3>
        <table class="kv">
          <tr><th>${t('sum.dx')}</th><td>${state.profile && state.profile.dxAt ? t.date(state.profile.dxAt) : t('sum.none')}</td></tr>
          <tr><th>${t('sum.size')}</th><td>${ex.valid ? `${t.num(ex.size)} mm` : t('sum.none')}</td></tr>
          <tr><th>${t('sum.location')}</th><td>${ex.valid ? t(`loc.${ex.loc}`) : t('sum.none')}</td></tr>
          <tr><th>${t('sum.met')}</th><td>${yn(s.onMet)}</td></tr>
          <tr><th>${t('sum.stent')}</th><td>${yn(s.stent)}</td></tr>
          <tr><th>${t('sum.passed')}</th><td>${s.passedDate ? (s.passedSure ? t.date(s.passedDate) : t('sum.passedUnsure', { date: t.date(s.passedDate) })) : t('sum.notPassed')}</td></tr>
        </table>

        <h3>${t('sum.questions')}</h3>
        <ol>${qs.map((q) => html`<li>${questionText(q, t)}</li>`)}${v.custom.map((c) => html`<li>${c.text}</li>`)}</ol>

        <h3>${t('sum.hr')}</h3>
        ${hr.length ? html`<ul>${hr.map((f) => html`<li>${t(`hr.${f}`)}</li>`)}</ul>` : html`<p>${t('sum.hrNone')}</p>`}

        <h3>${t('sum.log')}</h3>
        ${state.checkins.length
          ? html`<table class="log-table"><thead><tr><th>${t('sum.colDate')}</th><th>${t('sum.colPain')}</th><th>${t('sum.colFlags')}</th><th>${t('sum.colNotes')}</th></tr></thead>
            <tbody>${state.checkins.map((c) => {
              const flags = flagList(c, t);
              if (c.stoneSeen) flags.push(t('flag.stoneSeen'));
              return html`<tr><td>${t.date(c.date)}</td><td>${c.pain}/10</td><td>${flags.length ? t.list(flags) : t('sum.none')}</td><td>${c.notes || ''}</td></tr>`;
            })}</tbody></table>`
          : html`<p>${t('sum.empty')}</p>`}
        <p class="small muted">${t('sum.evidence', { version: state.ev.version })}</p>
      </article>`,
    async mount(root) {
      $('#print-btn', root).addEventListener('click', () => window.print());
      $('#sum-lang', root).addEventListener('change', async (e) => {
        await I.load(e.target.value);
        state.summaryLang = e.target.value;
        render();
      });
    },
  };
};

views.evidence = () => {
  const { t, ev } = state;
  const refIds = Object.keys(ev.sources);
  return {
    html: html`
      <h1 tabindex="-1">${t('ev.title')}</h1>
      <p>${t('ev.intro')}</p>
      <p class="muted small">${t('ev.reviewed', { date: t.date(ev.reviewed), version: ev.version })}
        ${ev.reviewer ? t('ev.reviewer', { name: ev.reviewer }) : t('ev.reviewerPending')}</p>
      <p class="note">${t('ev.auaNote')}</p>
      ${ev.sections.map((sec) => html`<section class="sec">
        <h2>${t(`evs.${sec.id}`)}</h2>
        <ul class="plain spaced">${sec.facts.map((f) => {
          const vars = E.resolveVars(ev, f.vars);
          for (const k of Object.keys(vars)) if (typeof vars[k] === 'number') vars[k] = t.num(vars[k]);
          return html`<li>${t(`evf.${f.key}`, vars)} ${sourceChips(f.sources)}</li>`;
        })}</ul></section>`)}

      <section class="sec">
        <h2>${t('ev.rulesTitle')}</h2>
        <p>${t('ev.rulesIntro')}</p>
        <p><a href="data/rules.json">rules.json</a> · <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${t('set.source')}</a></p>
      </section>

      <section class="sec">
        <h2>${t('ev.linksTitle')}</h2>
        <p class="muted small">${t('ev.linksNote')}</p>
        <ul class="plain spaced">${ev.links.map((l) => html`<li><a href="${l.url}" target="_blank" rel="noopener noreferrer">${t(`link.${l.id}`)}</a>
          ${l.lang !== t.lang ? html`<small class="muted">(${t('ev.langTag', { lang: I.LOCALES[l.lang] ? I.LOCALES[l.lang].name : l.lang })})</small>` : ''}</li>`)}</ul>
      </section>

      <section class="sec refs">
        <h2>${t('common.sources')}</h2>
        <ol>${refIds.map((id) => {
          const s = ev.sources[id];
          return html`<li id="src-${id}" lang="en">${s.cite}
            ${s.pmid ? html` <a href="https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/" target="_blank" rel="noopener noreferrer">${t('ev.pubmed')}</a>` : ''}
            ${s.doi ? html` · <a href="https://doi.org/${s.doi}" target="_blank" rel="noopener noreferrer">${t('ev.doi')}</a>` : ''}
            ${s.url ? html` · <a href="${s.url}" target="_blank" rel="noopener noreferrer">${new URL(s.url).hostname}</a>` : ''}
            ${s.secondary ? html` <small class="muted">(${t('ev.secondary')})</small>` : ''}</li>`;
        })}</ol>
      </section>`,
  };
};

views.pain = () => {
  const { t, ev } = state;
  const P = ev.pain;
  const num = emergencyNumber();
  const item = (key, vars, sources, extraKey) => html`
    <div class="para">
      <h3>${t(`pain.${key}.title`)}</h3>
      <p>${t(`pain.${key}.body`, vars)} ${sourceChips(sources)}</p>
      ${extraKey ? html`<p class="muted">${t(`pain.${key}.${extraKey}`, vars)}</p>` : ''}
    </div>`;
  return {
    html: html`
      <h1 tabindex="-1">${t('pain.title')}</h1>
      <p>${t('pain.intro')}</p>
      <div class="alert level-er">
        <p>${t('pain.erLine')}</p>
        <a class="banner-call" href="${telHref(num)}">${t('banner.call', { number: num })}</a>
      </div>

      <section class="sec">
        <h2>${t('pain.noDrugTitle')}</h2>
        ${item('heat', { n: P.heat.n, before: P.heat.before, after: P.heat.after, temp: P.heat.tempC }, ['kober2003'], 'safety')}
        ${item('acu', { a: t.num(P.acu.tu[0]), b: t.num(P.acu.tu[1]), c: t.num(P.acu.cao[0]), d: t.num(P.acu.cao[1]), n: P.acu.metaTrials }, ['tu2022', 'cao2025', 'chen2023'], 'note')}
        ${item('tens', { n: P.tens.n, a: P.tens.real, b: P.tens.sham }, ['gulacti2022'], 'note')}
        ${item('fluid', {}, ['worster2012'])}
        <div class="para">
          <h3>${t('pain.cope.title')}</h3>
          <p>${t('pain.cope.body')}</p>
          <ul class="dolist"><li>${t('pain.cope.1')}</li><li>${t('pain.cope.2')}</li><li>${t('pain.cope.3')}</li><li>${t('pain.cope.4')}</li></ul>
        </div>
      </section>

      <section class="sec">
        <h2>${t('pain.drugTitle')}</h2>
        <p class="note">${t('pain.drugIntro')}</p>
        ${item('nsaid', {}, ['holdgate2004', 'pathan2018', 'kser2023', 'eau'], 'caution')}
        ${item('apap', { a: P.ed.nsaid, b: P.ed.apap }, ['pathan2016', 'kser2023', 'medlabel'])}
        ${item('opioid', { c: P.ed.morphine }, ['holdgate2004', 'pathan2016'])}
        <p class="note">${t('pain.ladder')} ${sourceChips(['kser2023'])}</p>
      </section>`,
  };
};

views.more = () => {
  const { t } = state;
  const items = [
    ['#/log', 'more.log'],
    ['#/passed', 'more.passed'],
    ['#/summary', 'more.summary'],
    ['#/evidence', 'more.evidence'],
    ['#/settings', 'more.settings'],
  ];
  return {
    html: html`<h1 tabindex="-1">${t('more.title')}</h1>
      <ul class="menu">${items.map(([href, key]) => html`<li><a href="${href}">${t(key)}</a></li>`)}</ul>`,
  };
};

views.settings = () => {
  const { t } = state;
  const st = state.settings;
  const ready = I.readyLocales();
  const planned = Object.keys(I.LOCALES).filter((k) => I.LOCALES[k].status === 'planned');
  return {
    html: html`
      <h1 tabindex="-1">${t('set.title')}</h1>
      <section class="sec">
        <h2>${t('set.display')}</h2>
        <label class="field"><span>${t('lang.label')}</span>
          <select id="set-lang">${ready.map((l) => html`<option value="${l}" ${l === t.lang ? raw('selected') : ''}>${I.LOCALES[l].name}</option>`)}</select>
          ${planned.length ? html`<small class="muted">${t('lang.planned', { list: planned.map((l) => I.LOCALES[l].name).join(', ') })}</small>` : ''}</label>
        <fieldset><legend>${t('set.theme')}</legend><div class="choices">${radios('theme', [
          { value: 'system', label: t('set.themeSystem') },
          { value: 'light', label: t('set.themeLight') },
          { value: 'dark', label: t('set.themeDark') },
        ], st.theme || 'system')}</div></fieldset>
        <label class="toggle"><input type="checkbox" id="set-banner" ${st.hideBanner ? '' : raw('checked')}><span>${t('set.banner')}<small class="muted">${t('set.bannerHelp')}</small></span></label>
        <label class="toggle"><input type="checkbox" id="set-large" ${st.largeText ? raw('checked') : ''}><span>${t('set.textSize')}</span></label>
        <label class="toggle"><input type="checkbox" id="set-contrast" ${st.highContrast ? raw('checked') : ''}><span>${t('set.contrast')}</span></label>
        <fieldset><legend>${t('set.tempUnit')}</legend><div class="choices">${radios('tempUnit', [{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }], st.tempUnit || 'C')}</div></fieldset>
      </section>

      <section class="sec">
        <h2>${t('set.care')}</h2>
        <label class="field"><span>${t('set.dx')}</span>
          <input type="datetime-local" id="set-dx" value="${state.profile && state.profile.dxAt ? localDateTimeValue(new Date(state.profile.dxAt)) : ''}" max="${localDateTimeValue(new Date())}"></label>
        <label class="field"><span>${t('set.emergency')}</span>
          <input type="tel" id="set-emergency" value="${emergencyNumber()}" maxlength="15" aria-describedby="em-help">
          <small id="em-help" class="muted">${t('set.emergencyHelp')}</small></label>
        <label class="field"><span>${t('set.persist')}</span>
          <input type="number" id="set-persist" min="1" max="720" step="1" inputmode="numeric" value="${st.persistHours || ''}" aria-describedby="persist-help">
          <small id="persist-help" class="muted">${t('set.persistHelp')}</small></label>
        <a class="btn" href="#/start">${t('set.safety')}</a>
      </section>

      <section class="sec">
        <h2>${t('set.data')}</h2>
        <p>${t('set.privacy')}</p>
        <div class="stack">
          <button class="btn" id="export-plain" type="button">${t('set.export')}</button>
          <label class="field"><span>${t('set.passphrase')}</span>
            <input type="password" id="passphrase" autocomplete="new-password" minlength="8" aria-describedby="pp-help">
            <small id="pp-help" class="muted">${t('set.passphraseHelp')}</small></label>
          <button class="btn" id="export-enc" type="button">${t('set.exportEnc')}</button>
          <label class="btn file-btn">${t('set.import')}<input type="file" id="import-file" accept="application/json,.json" class="sr-only"></label>
          <button class="btn btn-danger-outline" id="wipe" type="button">${t('set.delete')}</button>
        </div>
        <p class="error" id="data-msg" role="status" hidden></p>
      </section>

      <section class="sec">
        <h2>${t('set.about')}</h2>
        <p>${t('set.aboutText')}</p>
        <p class="muted small mono">${t('set.version', { v: APP_VERSION, e: state.ev.version })}</p>
        <p><a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${t('set.source')}</a></p>
      </section>`,
    mount(root) {
      const saveSettings = async () => {
        await saveKV('settings');
        applyDisplay();
      };
      const msg = (text) => {
        const el = $('#data-msg', root);
        el.textContent = text;
        el.hidden = false;
      };
      $('#set-lang', root).addEventListener('change', async (e) => {
        await setLang(e.target.value);
      });
      $('#set-banner', root).addEventListener('change', async (e) => {
        state.settings.hideBanner = !e.target.checked;
        await saveSettings();
        renderChrome();
      });
      $('#set-large', root).addEventListener('change', async (e) => {
        state.settings.largeText = e.target.checked;
        await saveSettings();
      });
      $('#set-contrast', root).addEventListener('change', async (e) => {
        state.settings.highContrast = e.target.checked;
        await saveSettings();
      });
      $$('[name="theme"]', root).forEach((r) =>
        r.addEventListener('change', async () => {
          state.settings.theme = r.value;
          await saveSettings();
        }),
      );
      $$('[name="tempUnit"]', root).forEach((r) =>
        r.addEventListener('change', async () => {
          state.settings.tempUnit = r.value;
          await saveSettings();
        }),
      );
      $('#set-emergency', root).addEventListener('change', async (e) => {
        state.settings.emergency = e.target.value.trim() || null;
        await saveSettings();
        renderChrome();
      });
      $('#set-persist', root).addEventListener('change', async (e) => {
        const n = parseInt(e.target.value, 10);
        state.settings.persistHours = Number.isFinite(n) && n > 0 ? n : null;
        await saveSettings();
      });
      $('#set-dx', root).addEventListener('change', async (e) => {
        if (!e.target.value) return;
        state.profile = { ...state.profile, dxAt: new Date(e.target.value).toISOString() };
        await saveKV('profile');
      });
      $('#export-plain', root).addEventListener('click', async () => {
        download(`firststone-backup-${today()}.json`, await B.pack(await S.exportAll(), APP_VERSION));
      });
      $('#export-enc', root).addEventListener('click', async () => {
        const pp = $('#passphrase', root).value;
        if (pp.length < 8) return msg(t('set.passphraseShort'));
        download(`firststone-backup-${today()}.encrypted.json`, await B.pack(await S.exportAll(), APP_VERSION, pp));
      });
      $('#import-file', root).addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
          const text = await file.text();
          let pp = null;
          if (B.isEncrypted(text)) {
            pp = prompt(t('set.importAsk'));
            if (pp === null) return;
          }
          const payload = await B.unpack(text, pp);
          if (!confirm(t('set.importConfirm'))) return;
          await S.importAll(payload);
          await loadAll();
          await setLang(state.settings.lang || state.t.lang);
          flash(t('set.importOk'));
          render();
        } catch (err) {
          msg(err && err.message === 'wrong-passphrase' ? t('set.wrongPass') : t('set.importFail'));
        }
      });
      $('#wipe', root).addEventListener('click', async () => {
        if (!confirm(t('set.deleteConfirm'))) return;
        await S.wipe();
        await loadAll();
        flash(t('set.deleted'));
        go('#/start');
      });
    },
  };
};

// ---------- chrome, routing, boot ----------

function applyDisplay() {
  const root = document.documentElement;
  root.classList.toggle('large-text', !!state.settings.largeText);
  root.classList.toggle('hc', !!state.settings.highContrast);
  root.lang = state.t.lang;
  const theme = state.settings.theme;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').setAttribute('content', dark || state.settings.highContrast ? '#0f110f' : '#f7f6f1');
}

function renderChrome() {
  const { t } = state;
  document.title = `${t('app.name')} — ${t('app.tagline')}`;
  $('#app-name').textContent = t('app.name');
  $('#app-tagline').textContent = t('app.tagline');
  $('#banner').hidden = !!state.settings.hideBanner;
  $('#banner-text').textContent = t('banner.text');
  $('#banner-hide').textContent = t('banner.hide');
  const call = $('#banner-call');
  call.textContent = t('banner.call', { number: emergencyNumber() });
  call.href = telHref(emergencyNumber());
  const ready = I.readyLocales();
  const sw = $('#lang-switch');
  sw.setAttribute('aria-label', t('lang.label'));
  sw.innerHTML = ready
    .map((l) => html`<button type="button" data-lang="${l}" aria-pressed="${l === t.lang}" lang="${l}">${I.LOCALES[l].name}</button>`.s)
    .join('');
  $$('#lang-switch [data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  $('#nav').setAttribute('aria-label', t('nav.main'));
  for (const a of $$('#nav a')) a.querySelector('span').textContent = t(`nav.${a.dataset.nav}`);
}

async function setLang(lang) {
  const loaded = await I.load(lang);
  state.t = I.translator(loaded);
  state.settings.lang = loaded;
  await saveKV('settings');
  applyDisplay();
  renderChrome();
  render();
}

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, param] = h.split('/');
  return { name: name || 'today', param };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

let renderSeq = 0;
function render() {
  let { name, param } = parseRoute();
  if (!state.profile || !state.profile.onboarded) name = 'start';
  if (!views[name]) name = 'today';
  const seq = ++renderSeq;
  const view = views[name](param);
  const main = $('#main');
  main.innerHTML = (state.flash ? html`<p class="flash" role="status">${state.flash}</p>` : '') + view.html;
  state.flash = null;
  const navKey = { log: 'more', passed: 'more', summary: 'more', evidence: 'more', settings: 'more' }[name] || name;
  for (const a of $$('#nav a')) {
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.body.dataset.view = name;
  if (view.mount) view.mount(main);
  if (seq === renderSeq) {
    const h1 = $('h1', main);
    if (h1) h1.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

async function loadAll() {
  state.profile = (await S.get('profile')) || null;
  state.stone = (await S.get('stone')) || {};
  state.settings = (await S.get('settings')) || {};
  state.visit = { excluded: [], custom: [], highRisk: {}, ...((await S.get('visit')) || {}) };
  state.checkins = await S.allCheckins();
}

async function boot() {
  const [ev, rules] = await Promise.all([
    fetch('data/evidence.json').then((r) => r.json()),
    fetch('data/rules.json').then((r) => r.json()),
  ]);
  state.ev = ev;
  state.rules = rules;
  state.persistent = await S.persistent();
  await loadAll();

  const lang = await I.load(state.settings.lang || I.detect());
  state.t = I.translator(lang);
  if (!state.settings.lang) {
    state.settings = { lang, tempUnit: I.LOCALES[lang].tempUnit, ...state.settings };
    await saveKV('settings');
  }
  applyDisplay();
  renderChrome();
  $('#banner-hide').addEventListener('click', async () => {
    state.settings.hideBanner = true;
    await saveKV('settings');
    renderChrome();
    if (parseRoute().name === 'settings') render();
  });
  // Cross-fade between screens where supported; in-place re-renders stay instant.
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  window.addEventListener('hashchange', () => {
    if (document.startViewTransition && !calm.matches) document.startViewTransition(render);
    else render();
  });
  render();

  // Skipped on the local preview (cache-first would serve stale files while
  // editing); add ?sw=1 to test offline behaviour locally.
  const local = ['localhost', '127.0.0.1'].includes(location.hostname) && !/[?&]sw=1\b/.test(location.search);
  if ('serviceWorker' in navigator && window.isSecureContext && !local) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot().catch((err) => {
  console.error(err);
  const main = document.getElementById('main');
  if (main) main.textContent = 'First Stone could not start. Please reload the page.';
});
