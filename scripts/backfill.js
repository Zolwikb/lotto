// Jednorazowe pobranie archiwum losowań z API (domyślnie ok. 25 lat wstecz, ile API da).
// Użycie: node scripts/backfill.js [--days 9000] [--all-days]
import { GAMES, readJson, writeJson, addDays, warsawDate, weekday, sleep, warn } from './lib.js';
import { lastResults, byDate, normalize, mergeDraws } from './lotto-api.js';

const argv = process.argv.slice(2);
const days = Number(argv[argv.indexOf('--days') + 1]) || Number(process.env.BACKFILL_DAYS) || 9000; // ok. 25 lat; po starszych losowaniach API i tak odpowie 404
const allDays = argv.includes('--all-days');
const config = readJson('config.json', {});
const drawDays = config.schedule?.days ?? [2, 4, 6];

// API chce drawDate jako date-time. Format sprawdzamy na znanym losowaniu.
const FORMATS = [(d) => d, (d) => `${d}T00:00:00`, (d) => `${d}T00:00:00.000Z`, (d) => `${d}T22:00:00`, (d) => `${d}T22:00:00.000Z`];

async function detectFormat(game) {
  const latest = normalize(await lastResults(game), game).at(-1);
  if (!latest) throw new Error('last-results nie zwróciło żadnego losowania');
  for (let i = 0; i < FORMATS.length; i++) {
    try {
      const got = normalize(await byDate(game, FORMATS[i](latest.date)), game);
      if (got.some((d) => d.date === latest.date)) return i;
    } catch (e) {
      console.log(`  format ${i}: ${e.message.slice(0, 120)}`);
    }
    await sleep(300);
  }
  return -1;
}

for (const game of Object.keys(GAMES)) {
  console.log(`== ${GAMES[game].label} ==`);
  let history = readJson(`draws-${game}.json`, []);
  let fmt;
  try {
    fmt = await detectFormat(game);
  } catch (e) {
    warn(`${GAMES[game].label}: ${e.message}`);
    continue;
  }
  if (fmt < 0) {
    warn(`${GAMES[game].label}: żaden format daty nie zadziałał dla by-date-per-game. Użyj import-history.js (patrz README).`);
    continue;
  }
  console.log(`Format daty: ${fmt}`);

  const today = warsawDate(new Date());
  let failures = 0;
  let added = 0;
  const known = new Set(history.map((d) => d.date));
  for (let i = 0; i < days; i++) {
    const day = addDays(today, -i);
    if (!allDays && !drawDays.includes(weekday(day))) continue;
    if (known.has(day)) continue;
    try {
      const fresh = normalize(await byDate(game, FORMATS[fmt](day)), game);
      const r = mergeDraws(history, fresh);
      history = r.merged;
      added += r.added;
      failures = 0;
    } catch (e) {
      if (e.status === 404) failures = 0; // brak losowania tego dnia
      else if (++failures >= 5) {
        warn(`${GAMES[game].label}: 5 błędów z rzędu (${e.message.slice(0, 120)}). Przerywam, zapisuję to, co mam.`);
        break;
      }
    }
    if (i % 40 === 0) writeJson(`draws-${game}.json`, history);
    await sleep(250);
  }
  writeJson(`draws-${game}.json`, history);
  console.log(`${GAMES[game].label}: dodano ${added}, razem ${history.length}`);
}
