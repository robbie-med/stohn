# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"First Stone" (live at https://stohn.robbiemed.org via GitHub Pages, `CNAME`): a static, offline-first PWA for adults in the first 30 days after a first kidney stone.
Vanilla ES modules, **no build step, no npm dependencies**, no backend. All user data stays in IndexedDB.
Bilingual EN/KO from day one; fr and ru are registered as `planned` in `js/i18n.js`.

## Commands

```bash
npm test                                   # node --test tests/ (Node 18+, zero deps)
node --test tests/engine.test.js           # one file
node --test --test-name-pattern="safety" tests/   # one test by name
./scripts/serve.sh                         # preview on 127.0.0.1:3110 (no-cache server)
python3 scripts/build-fonts.py <ttf-dir>   # rebuild WOFF2 subsets (fonttools + brotli)
```

Port 3110 is registered to stohn in `/home/user/Projects/PORTS.md`. Don't use another port.
The service worker is **skipped on localhost** (cache-first would serve stale files). Use `?sw=1` to test offline.

## Architecture

- `js/engine.js`: all clinical logic, pure functions (passage band lookup, rule evaluation, course
  timeline, visit-question builder). No DOM, storage or fetch, so tests import it directly. Keep it that way.
- `data/evidence.json`: the single source of every number and citation. Locale strings reference
  numbers through `{placeholders}`. Evidence-page facts pull values with `"$path.into.evidence"`
  references (resolved by `resolveVars`), so a number changes in exactly one place.
- `data/rules.json`: deterministic red-flag rules (`scope`: `checkin` | `safety` | `course`).
  **Escalation-only invariant:** levels are `call > er > contact`, with no "ok" or de-escalating level.
  Every rule must cite a source id from evidence.json. Tests enforce both.
- `js/app.js`: hash router (`#/today`, `#/checkin/<date>`, `#/stone`, `#/visit`, `#/summary`,
  `#/evidence`, `#/settings`, …). Each view returns `{ html, mount }`. HTML is built with the
  `html` tagged template, which **auto-escapes** interpolations. Use `raw()` only for trusted markup.
  User text (notes, custom questions) must never be passed through `raw()`.
- `js/i18n.js`: locale registry, fallback to English, `Intl.PluralRules` plurals (values can be
  `{one, other, few, many}` objects). `translator(lang)` is used separately for the printable summary,
  which can be in a different language from the UI.
- `js/store.js`: IndexedDB `firststone` (`kv` store: profile/stone/settings/visit; `checkins` keyed by
  `YYYY-MM-DD`). Falls back to in-memory storage when IndexedDB is unavailable.
- `js/backup.js`: JSON backup envelope, optionally PBKDF2 + AES-GCM encrypted via WebCrypto.

## Rules that tests enforce

- Every ready locale has exactly the English keys and matching placeholders (`tests/i18n.test.js`).
  Every literal `t('…')` key in app.js must exist in `locales/en.json`.
- `sw.js` ASSETS must list every file in `js/`, `css/`, `data/`, `fonts/*.woff2` and the ready locales.
  **Bump `CACHE` in sw.js on any shipped change**, along with `APP_VERSION` in app.js and package.json.
- `index.html` has no inline script or style attributes (the CSP is `'self'` only). Don't set `style="…"` in templates either.

## Content and safety constraints

- Show population ranges with citations. Never a personal "you will pass it" statement, drug dosing,
  or "start/stop your medicine".
- Don't paste AUA or Urology Care Foundation text (their terms forbid it). Summarise in our own words and link out.
- AUA 2026 statement numbers come from secondary sources (`"secondary": true` in evidence.json).
  Re-verify against the full text before relying on them.
- When changing evidence, update `version` and `reviewed` in evidence.json and add a CHANGELOG entry.

## Adding a language

Copy `locales/en.json` → `locales/<code>.json`, translate it, set the status to `ready` in `LOCALES`, add the file to
sw.js, and run `npm test`. Fraunces has no Cyrillic: add a Cyrillic-capable face (or fall back to
system fonts via `unicode-range`) before shipping ru. Re-run `build-fonts.py` after changing ko.json
so new bold Hangul syllables are included.

## Design

Editorial, not dashboard: no cards or boxed containers. Use hairlines, whitespace and type
(Fraunces variable serif + Gowun Batang). Dark, light and high-contrast themes are CSS tokens on `:root`
(`data-theme` forces light or dark). The top safety reminder can be hidden (`settings.hideBanner`).
Escalation dialogs cannot be disabled.
