// i18n: locale registry, loading, translation, and locale-aware formatting.
//
// Adding a language (fr and ru are planned):
//   1. copy locales/en.json -> locales/<code>.json and translate every value
//   2. flip its status below to 'ready'
//   3. add the file to ASSETS in sw.js and bump the cache version
//   4. run `npm test` — tests/i18n.test.js fails on missing keys or placeholders
//
// Plural values are objects keyed by Intl.PluralRules categories
// (en: one/other, ko: other, ru: one/few/many/other, fr: one/many/other).

export const LOCALES = {
  en: { name: 'English', status: 'ready', emergency: '911', tempUnit: 'F' },
  ko: { name: '한국어', status: 'ready', emergency: '119', tempUnit: 'C' },
  fr: { name: 'Français', status: 'planned', emergency: '112', tempUnit: 'C' },
  ru: { name: 'Русский', status: 'planned', emergency: '112', tempUnit: 'C' },
};

export const FALLBACK = 'en';

export const readyLocales = () => Object.keys(LOCALES).filter((k) => LOCALES[k].status === 'ready');

const dicts = {};

export function interpolate(str, vars = {}) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

// Pure lookup, shared with tests.
export function translate(dict, fallbackDict, key, vars = {}, lang = FALLBACK) {
  let v = dict && dict[key] !== undefined ? dict[key] : fallbackDict && fallbackDict[key];
  if (v === undefined) return key;
  if (typeof v === 'object') {
    const n = Number(vars.n);
    const cat = new Intl.PluralRules(lang).select(Number.isFinite(n) ? n : 0);
    v = v[cat] !== undefined ? v[cat] : v.other;
  }
  return interpolate(v, vars);
}

export async function load(lang) {
  if (!LOCALES[lang] || LOCALES[lang].status !== 'ready') lang = FALLBACK;
  const want = lang === FALLBACK ? [FALLBACK] : [FALLBACK, lang];
  await Promise.all(
    want.filter((l) => !dicts[l]).map(async (l) => {
      const res = await fetch(`locales/${l}.json`);
      if (!res.ok) throw new Error(`Failed to load locale ${l}`);
      dicts[l] = await res.json();
    }),
  );
  return lang;
}

export function detect(navLangs = (typeof navigator !== 'undefined' && navigator.languages) || []) {
  const ready = readyLocales();
  for (const l of navLangs) {
    const base = String(l).toLowerCase().split('-')[0];
    if (ready.includes(base)) return base;
  }
  return FALLBACK;
}

// Translator bound to one language. The visit summary uses its own, so the
// printout can be in a different language from the UI.
export function translator(lang) {
  const t = (key, vars) => translate(dicts[lang], dicts[FALLBACK], key, vars, lang);
  t.lang = lang;
  t.date = (iso, opts = { year: 'numeric', month: 'short', day: 'numeric' }) => {
    if (!iso) return '';
    const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
    return new Intl.DateTimeFormat(lang, opts).format(d);
  };
  t.num = (n, opts) => new Intl.NumberFormat(lang, opts).format(n);
  t.list = (items) =>
    typeof Intl.ListFormat === 'function' ? new Intl.ListFormat(lang, { type: 'conjunction' }).format(items) : items.join(', ');
  return t;
}
