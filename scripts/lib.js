// Wspólne narzędzia: pliki danych, HTTP, daty w strefie Europe/Warsaw.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = process.env.DATA_DIR || path.join(ROOT, 'docs', 'data');
export const TZ = 'Europe/Warsaw';

export const GAMES = {
  lotto: { apiName: 'Lotto', label: 'Lotto' },
  lottoplus: { apiName: 'LottoPlus', label: 'Lotto Plus' },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(name, data) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(data, null, 1) + '\n');
}

export function warn(msg) {
  console.log(`::warning::${msg}`);
}

// HTTP z ponawianiem przy 429/5xx. Nigdy nie wypisuje nagłówków (klucze).
export async function fetchJson(url, options = {}, { retries = 2, label = url } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`${label}: HTTP ${res.status} ${text.slice(0, 300)}`);
        err.status = res.status;
        if (res.status === 429 || res.status >= 500) throw err;
        err.final = true;
        throw err;
      }
      try {
        return JSON.parse(text);
      } catch {
        throw Object.assign(new Error(`${label}: odpowiedź nie jest JSON-em: ${text.slice(0, 200)}`), { final: true });
      }
    } catch (e) {
      lastErr = e;
      if (e.final || attempt === retries) break;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ---------- Daty (Europe/Warsaw) ----------

function tzParts(date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}

const pad = (n) => String(n).padStart(2, '0');

// Data kalendarzowa YYYY-MM-DD w Warszawie dla chwili (Date) lub tekstu z API.
export function warsawDate(input) {
  if (typeof input === 'string') {
    const hasTz = /(Z|[+-]\d{2}:?\d{2})$/.test(input);
    if (!hasTz) return input.slice(0, 10);
    input = new Date(input);
  }
  const p = tzParts(input);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = niedziela
}

// Chwila (Date), w której w Warszawie jest dana data i godzina.
export function warsawInstant(dateStr, hour, minute = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const p = tzParts(new Date(guess));
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return new Date(guess - (asUtc - guess));
}

// Najbliższe losowanie po chwili `now` według konfiguracji (dni tygodnia + godzina).
export function nextDraw(now, cfg) {
  const days = cfg.schedule?.days ?? [2, 4, 6];
  const hour = cfg.schedule?.hour ?? 22;
  const minute = cfg.schedule?.minute ?? 0;
  let day = warsawDate(now);
  for (let i = 0; i < 9; i++, day = addDays(day, 1)) {
    if (!days.includes(weekday(day))) continue;
    const at = warsawInstant(day, hour, minute);
    if (at > now) return { date: day, at };
  }
  throw new Error('Nie da się wyliczyć następnego losowania – sprawdź schedule w config.json');
}

export function validNumbers(nums, max = 49, count = 6) {
  return (
    Array.isArray(nums) &&
    nums.length === count &&
    nums.every((n) => Number.isInteger(n) && n >= 1 && n <= max) &&
    new Set(nums).size === count
  );
}
