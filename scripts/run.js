// Główny skrypt: pobiera losowania, rozlicza typy, generuje typy na następne losowanie.
// Jest idempotentny: można go odpalać wiele razy dziennie.
import crypto from 'node:crypto';
import { GAMES, readJson, writeJson, warn, nextDraw, validNumbers } from './lib.js';
import { lastResults, normalize, mergeDraws } from './lotto-api.js';
import { buildPrompt, getPick, PROVIDERS } from './models.js';

const MIN_HISTORY = Number(process.env.MIN_HISTORY || 30);
const LOCK_MARGIN_MS = 5 * 60 * 1000; // typów nie tworzymy tuż przed losowaniem

const config = readJson('config.json');
if (!config) throw new Error('Brak docs/data/config.json');
const now = new Date();
const draws = { lotto: readJson('draws-lotto.json', []), lottoplus: readJson('draws-lottoplus.json', []) };
let predictions = readJson('predictions.json', []);

// 1. Najnowsze losowania
for (const game of Object.keys(GAMES)) {
  try {
    const fresh = normalize(await lastResults(game), game);
    const { merged, added } = mergeDraws(draws[game], fresh);
    draws[game] = merged;
    console.log(`${GAMES[game].label}: ${added} nowych losowań, razem ${merged.length}`);
  } catch (e) {
    warn(`Nie udało się pobrać wyników ${GAMES[game].label}: ${e.message}`);
  }
  writeJson(`draws-${game}.json`, draws[game]);
}

// 2. Rozliczenie typów, dla których jest już wynik
let settled = 0;
for (const p of predictions) {
  if (p.status !== 'ok' || p.hits != null) continue;
  const d = draws[p.game].find((x) => x.date === p.drawDate);
  if (!d) continue;
  p.hits = p.numbers.filter((n) => d.numbers.includes(n)).length;
  p.drawId = d.id;
  settled++;
}
if (settled) console.log(`Rozliczono typów: ${settled}`);

// 3. Typy na następne losowanie
const next = nextDraw(now, config);
const locked = now.getTime() > next.at.getTime() - LOCK_MARGIN_MS;
const modelNames = { ...config.models };
const players = config.players || [];

for (const game of Object.keys(GAMES)) {
  const history = draws[game];
  const have = (id) => predictions.find((p) => p.game === game && p.drawDate === next.date && p.player === id && p.status === 'ok');
  const drop = (id) => {
    predictions = predictions.filter((p) => !(p.game === game && p.drawDate === next.date && p.player === id));
  };
  if (locked) {
    console.log(`${GAMES[game].label}: do losowania mniej niż 5 min, nie tworzę nowych typów.`);
    continue;
  }
  if (config.startDate && next.date < config.startDate) {
    console.log(`${GAMES[game].label}: rywalizacja startuje ${config.startDate}, a najbliższe losowanie to ${next.date}.`);
    continue;
  }
  if (history.length < MIN_HISTORY && players.some((p) => p.kind === 'model')) {
    warn(`Za mało historii dla ${GAMES[game].label} (${history.length} < ${MIN_HISTORY}). Uruchom najpierw „backfill”.`);
  }
  for (const pl of players) {
    if (have(pl.id)) continue;
    const base = { game, drawDate: next.date, player: pl.id, createdAt: new Date().toISOString(), hits: null };

    if (pl.kind === 'model') {
      const provider = PROVIDERS[pl.id];
      if (!provider || !process.env[provider.env]) {
        console.log(`${pl.name}: brak klucza ${provider?.env}, pomijam.`);
        continue;
      }
      if (history.length < MIN_HISTORY) continue;
      const model = process.env[`${pl.id.toUpperCase()}_MODEL`] || modelNames[pl.id];
      try {
        const pick = await getPick(pl.id, model, buildPrompt(game, history, next.date, config.recentDraws ?? 150));
        drop(pl.id);
        predictions.push({ ...base, ...pick, model, status: 'ok' });
        console.log(`${pl.name} ${GAMES[game].label}: ${pick.numbers.join(' ')}`);
      } catch (e) {
        drop(pl.id);
        predictions.push({ ...base, model, status: 'error', error: String(e.message).slice(0, 300) });
        warn(`${pl.name} ${GAMES[game].label}: ${e.message}`);
      }
    } else if (pl.kind === 'random') {
      const set = new Set();
      while (set.size < 6) set.add(crypto.randomInt(1, 50));
      predictions.push({ ...base, numbers: [...set].sort((a, b) => a - b), reasoning: 'Losowanie komputerowe, bez żadnej metody.', status: 'ok' });
    } else if (pl.kind === 'fixed') {
      const nums = config.fixed?.[game];
      if (!validNumbers(nums)) {
        warn(`Stałe liczby dla ${GAMES[game].label} są niepoprawne w config.json (potrzeba 6 różnych liczb 1-49).`);
        continue;
      }
      predictions.push({ ...base, numbers: [...nums].sort((a, b) => a - b), reasoning: 'Te same liczby w każdym losowaniu.', status: 'ok' });
    }
  }
}

predictions.sort((a, b) => a.drawDate.localeCompare(b.drawDate) || a.game.localeCompare(b.game));
writeJson('predictions.json', predictions);
writeJson('meta.json', {
  updatedAt: now.toISOString(),
  next: { date: next.date, at: next.at.toISOString() },
  startDate: config.startDate ?? null,
});
console.log(`Następne losowanie: ${next.date} (${next.at.toISOString()})`);
