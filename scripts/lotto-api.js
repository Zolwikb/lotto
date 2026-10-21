// Klient oficjalnego API Totalizatora Sportowego (developers.lotto.pl).
// Klucz idzie w nagłówku "secret". Format odpowiedzi czytamy tolerancyjnie.
import { GAMES, fetchJson, warsawDate, validNumbers } from './lib.js';

const BASE = process.env.LOTTO_API_BASE || 'https://developers.lotto.pl/api/open/v1/lotteries/draw-results';

function headers() {
  const key = process.env.LOTTO_API_KEY;
  if (!key) throw new Error('Brak LOTTO_API_KEY (dodaj sekret w ustawieniach repozytorium).');
  return { accept: 'application/json', secret: key };
}

async function get(pathAndQuery, label) {
  return fetchJson(`${BASE}/${pathAndQuery}`, { headers: headers() }, { label });
}

export async function lastResults(game) {
  const q = new URLSearchParams({ gameType: GAMES[game].apiName });
  return get(`last-results-per-game?${q}`, `last-results-per-game ${game}`);
}

export async function byDate(game, drawDateParam) {
  const q = new URLSearchParams({
    gameType: GAMES[game].apiName,
    drawDate: drawDateParam,
    index: '1',
    size: '10',
    sort: 'drawDate',
    order: 'DESC',
  });
  return get(`by-date-per-game?${q}`, `by-date-per-game ${game} ${drawDateParam}`);
}

// Zamienia odpowiedź API na [{ date, id, numbers }] dla jednej gry.
export function normalize(json, game) {
  const apiName = GAMES[game].apiName.toLowerCase();
  let draws = [];
  if (Array.isArray(json)) draws = json;
  else if (json && typeof json === 'object') {
    const list = ['items', 'content', 'data', 'draws'].map((k) => json[k]).find(Array.isArray);
    draws = list || [json];
  }
  const out = new Map();
  const take = (src, parent) => {
    const type = String(src.gameType ?? parent.gameType ?? '').toLowerCase();
    if (type && type !== apiName) return;
    const nums = (src.resultsJson ?? []).map(Number).sort((a, b) => a - b);
    if (!validNumbers(nums)) return;
    const rawDate = src.drawDate ?? parent.drawDate;
    if (!rawDate) return;
    const date = warsawDate(rawDate);
    out.set(date, { date, id: src.drawSystemId ?? parent.drawSystemId ?? null, numbers: nums });
  };
  for (const d of draws) {
    if (!d || typeof d !== 'object') continue;
    if (Array.isArray(d.results) && d.results.length) d.results.forEach((r) => take(r, d));
    else take(d, d);
  }
  return [...out.values()];
}

// Dopisuje nowe losowania do historii (klucz: data), zwraca liczbę nowych.
export function mergeDraws(history, fresh) {
  const byDay = new Map(history.map((d) => [d.date, d]));
  let added = 0;
  for (const d of fresh) {
    if (!byDay.has(d.date)) added++;
    byDay.set(d.date, d);
  }
  const merged = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { merged, added };
}
