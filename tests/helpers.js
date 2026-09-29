import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const readJSON = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
export const readText = (p) => readFileSync(join(ROOT, p), 'utf8');
export const ls = (p) => readdirSync(join(ROOT, p));
export const ev = readJSON('data/evidence.json');
export const rules = readJSON('data/rules.json');
