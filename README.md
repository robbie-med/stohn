# First Stone (stohn)

A private, no-account companion for the **first 30 days after a first kidney stone**.
Natively bilingual: **English** and **한국어** (French and Russian planned).

- **Stone report explainer**: enter size and location from the CT report and see published
  passage *ranges* from CT cohorts, typical time to passage, and what the 2026 AUA guideline
  says about medicine to help passage. Population data with citations, never a personal prediction.
- **Daily check-in with danger-sign rules**: a 30-second check (pain, fever, chills, vomiting,
  can't urinate, fainting). Deterministic rules in [`data/rules.json`](data/rules.json) can only
  escalate (call emergency services / go to the ER / contact your clinician). They never say "you're fine".
- **Visit prep**: auto-built questions for the follow-up (stone analysis, 24-hour urine, imaging,
  medicine, stents) plus a high-risk self-check from the EAU list.
- **Printable summary**: a one-page visit summary. Its language can differ from the app's
  (e.g. UI in Korean, printout in English for the clinician).
- **Evidence page**: every number with its source, PubMed/DOI links and a review date.

## Privacy

Everything lives in IndexedDB on the device. No backend, accounts, analytics, cookies,
third-party fonts or CDNs. The CSP is `'self'` only. Backups are downloaded as JSON, optionally
encrypted in the browser (PBKDF2 → AES-GCM). "Delete everything" wipes the local database.

## Not a medical device

Education only. The app gives published population-level figures, escalation-only safety
prompts and no dosing, and never tells anyone to start, stop or skip anything. Guideline
content is summarised in our own words. AUA / Urology Care Foundation text is linked, not copied.

## Run locally

```bash
./scripts/serve.sh      # http://127.0.0.1:3110 (no-cache static server)
npm test                # node --test, no dependencies
```

The service worker is skipped on localhost. Add `?sw=1` to test offline behaviour.

## Deploy

Static files, no build step. Deployed on GitHub Pages at **https://stohn.robbiemed.org** (`CNAME`);
the CSP ships in a `<meta>` tag. Also works on Cloudflare Pages (`_headers` adds the CSP and security
headers).

## Fonts

[Fraunces](https://github.com/undercasetype/Fraunces) (Latin) and
[Gowun Batang](https://github.com/yangheeryu/Gowun-Batang) (Hangul), both SIL OFL 1.1
(licenses in `fonts/`). They are bundled as WOFF2 subsets built by `scripts/build-fonts.py`.
The Korean files load only when Hangul is on screen.

## Evidence

See the in-app evidence page and [`CHANGELOG.md`](CHANGELOG.md). Physician review is pending. Errors in
the rules or numbers can be reported as GitHub issues.
