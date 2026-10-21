// Trzej wróżbici: aplikacja kliencka bez frameworków. Dane czyta z data/*.json,
// punktację liczy sama z losowań, własne typy trzyma w telefonie (localStorage).

const TZ = 'Europe/Warsaw';
const GAMES = { lotto: { label: 'Lotto' }, lottoplus: { label: 'Lotto Plus' } };
const COLORS = { claude: '#c4623a', gemini: '#3b6fe0', chatgpt: '#12a4a4', random: '#7b7899', fixed: '#8a4fd0', me: 'var(--ink)' };
const LOCK_MARGIN = 5 * 60 * 1000; // tyle samo co w scripts/run.js
// 6 z 49: średnia liczba trafień przy czystym losowaniu i jej odchylenie na jeden zakład
const EXPECTED = 36 / 49;
const SIGMA = Math.sqrt(6 * (6 / 49) * (43 / 49) * (43 / 48));
const ME_KEY = 'lotto.me.v1';

// ---------- narzędzia ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmtAvg = (x) => x.toFixed(2).replace('.', ',');

function tzParts(date) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}
function warsawDate(date) {
  const p = tzParts(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function warsawInstant(dateStr, hour, minute = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const p = tzParts(new Date(guess));
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return new Date(guess - (asUtc - guess));
}
function nextDraw(now, cfg) {
  const days = cfg.schedule?.days ?? [2, 4, 6];
  const hour = cfg.schedule?.hour ?? 22;
  const minute = cfg.schedule?.minute ?? 0;
  let day = warsawDate(now);
  for (let i = 0; i < 9; i++, day = addDays(day, 1)) {
    if (!days.includes(weekday(day))) continue;
    const at = warsawInstant(day, hour, minute);
    if (at > now) return { date: day, at };
  }
  return { date: day, at: now };
}
const dayLong = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayShort = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
const hitsOf = (nums, drawn) => nums.filter((n) => drawn.includes(n)).length;
const validTip = (a) => Array.isArray(a) && a.length === 6 && a.every((n) => Number.isInteger(n) && n >= 1 && n <= 49) && new Set(a).size === 6;

function countdownText(at) {
  const ms = at - Date.now();
  if (ms <= LOCK_MARGIN) return ms > 0 ? 'Losowanie za chwilę, typy zamknięte.' : 'Losowanie trwa lub właśnie się zakończyło.';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return `Za ${d} ${d === 1 ? 'dzień' : 'dni'} ${h} godz.`;
  if (h > 0) return `Za ${h} godz. ${m} min`;
  return `Za ${m} min`;
}

// ---------- własne typy (tylko w tej przeglądarce) ----------
let memStore = null;
function loadMe() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(ME_KEY)); } catch { v = memStore; }
  v = v && typeof v === 'object' ? v : {};
  for (const g of Object.keys(GAMES)) v[g] = v[g] && typeof v[g] === 'object' ? v[g] : {};
  return v;
}
function saveMe() {
  try { localStorage.setItem(ME_KEY, JSON.stringify(state.me)); } catch { memStore = state.me; }
}

// ---------- stan ----------
const state = { tab: 'typy', game: 'lotto', rankGame: 'all', histCount: 12, data: null, error: null, loadedAt: 0, me: loadMe(), backup: '' };

async function getJson(name, fallback) {
  try {
    const r = await fetch(`data/${name}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    return fallback;
  }
}

async function load() {
  const [cfg, meta, lotto, lottoplus, predictions] = await Promise.all([
    getJson('config.json', null), getJson('meta.json', {}), getJson('draws-lotto.json', []), getJson('draws-lottoplus.json', []), getJson('predictions.json', []),
  ]);
  if (!cfg) {
    state.error = 'Nie udało się wczytać danych. Sprawdź połączenie z internetem i spróbuj ponownie.';
    return;
  }
  state.error = null;
  state.data = { cfg, meta: meta || {}, draws: { lotto, lottoplus }, predictions: Array.isArray(predictions) ? predictions : [] };
  state.loadedAt = Date.now();
}

// ---------- logika danych ----------
function players() {
  const list = (state.data.cfg.players || []).map((p) => ({ id: p.id, name: p.name, kind: p.kind, model: state.data.cfg.models?.[p.id] }));
  return list;
}
const shortName = (n) => String(n).split(' (')[0];
const colorOf = (id) => COLORS[id] || '#7b7899';
function drawFor(game, date) { return state.data.draws[game].find((d) => d.date === date); }

// Wszystkie rozliczalne typy (z backendu + własne): { game, date, player, numbers, hits, drawn }
function entries() {
  const { cfg, predictions } = state.data;
  const start = cfg.startDate || '0000-00-00';
  const out = [];
  for (const p of predictions) {
    if (p.status !== 'ok' || !validTip(p.numbers) || p.drawDate < start) continue;
    out.push({ game: p.game, date: p.drawDate, player: p.player, numbers: p.numbers, reasoning: p.reasoning, model: p.model });
  }
  for (const game of Object.keys(GAMES)) {
    for (const [date, numbers] of Object.entries(state.me[game] || {})) {
      if (date >= start && validTip(numbers)) out.push({ game, date, player: 'me', numbers });
    }
  }
  for (const e of out) {
    const d = drawFor(e.game, e.date);
    if (d) { e.drawn = d.numbers; e.hits = hitsOf(e.numbers, d.numbers); }
  }
  return out;
}

function stats(gameFilter) {
  const all = entries().filter((e) => e.drawn && (gameFilter === 'all' || e.game === gameFilter));
  const ids = [...players().map((p) => p.id)];
  if (all.some((e) => e.player === 'me') || Object.values(state.me).some((g) => Object.keys(g).length)) ids.push('me');
  return ids.map((id) => {
    const mine = all.filter((e) => e.player === id);
    const n = mine.length;
    const total = mine.reduce((s, e) => s + e.hits, 0);
    const p = players().find((x) => x.id === id);
    return { id, name: p ? p.name : 'Ty', n, total, avg: n ? total / n : 0, threes: mine.filter((e) => e.hits >= 3).length };
  });
}

// ---------- widoki ----------
function segHtml(options, current, attr) {
  return `<div class="seg" role="group">${options.map(([v, l]) => `<button type="button" data-${attr}="${v}" aria-pressed="${v === current}">${esc(l)}</button>`).join('')}</div>`;
}

function numsHtml(nums, cls = '', hitSet) {
  return `<div class="nums">${nums.map((n) => `<span class="cell ${hitSet ? (hitSet.includes(n) ? 'hit' : '') : cls}">${n}</span>`).join('')}</div>`;
}

function whoHtml(id, name, model) {
  return `<div class="who"><span class="dot" style="background:${colorOf(id)}"></span><b>${esc(name)}</b>${model ? `<span class="model">${esc(model)}</span>` : ''}</div>`;
}

function viewTypy() {
  const { cfg } = state.data;
  const game = state.game;
  const nd = nextDraw(new Date(), cfg);
  const locked = Date.now() > nd.at.getTime() - LOCK_MARGIN;
  const pre = cfg.startDate && nd.date < cfg.startDate;
  const preds = state.data.predictions.filter((p) => p.game === game && p.drawDate === nd.date);
  let cards = '';
  for (const pl of players()) {
    const p = preds.find((x) => x.player === pl.id);
    let body;
    if (p && p.status === 'ok' && validTip(p.numbers)) {
      body = numsHtml(p.numbers, 'mark') + (p.reasoning ? `<p class="said">${esc(p.reasoning)}</p>` : '');
    } else if (p && p.status === 'error') {
      body = `<p class="err">Ten gracz nie podał typu: ${esc(p.error || 'błąd')}</p>`;
    } else if (pl.kind === 'fixed') {
      body = `<div class="empty"><b>Stałe liczby nie są ustawione</b>Wpisz je w pliku docs/data/config.json (pole „fixed”).</div>`;
    } else {
      body = `<div class="empty"><b>Typ jeszcze nie powstał</b>Pojawi się automatycznie po poprzednim losowaniu (około 22:30) albo po ręcznym uruchomieniu.</div>`;
    }
    cards += `<article class="card">${whoHtml(pl.id, pl.name, pl.model)}${body}</article>`;
  }
  const mine = state.me[game][nd.date];
  const meBody = validTip(mine)
    ? numsHtml(mine, 'mark') + (locked ? '' : `<div class="row-actions"><button class="btn ghost" data-action="pick" data-date="${nd.date}">Zmień typ</button></div>`)
    : locked
      ? `<div class="empty"><b>Typy zamknięte</b>Do losowania zostało mniej niż 5 minut.</div>`
      : `<div class="row-actions"><button class="btn" data-action="pick" data-date="${nd.date}">Wpisz swój typ</button></div>`;
  cards += `<article class="card">${whoHtml('me', 'Ty', 'zapis w tym telefonie')}${meBody}</article>`;

  return `
    <h1>Trzej wróżbici</h1>
    ${segHtml(Object.entries(GAMES).map(([k, v]) => [k, v.label]), game, 'g')}
    <section class="stub">
      <div class="when">${esc(dayLong(nd.date))}<span class="time">${pad(cfg.schedule?.hour ?? 22)}:${pad(cfg.schedule?.minute ?? 0)}</span></div>
      <div class="count" id="count">${pre ? `Rywalizacja rusza ${esc(dayLong(cfg.startDate))}.` : esc(countdownText(nd.at))}</div>
    </section>
    ${cards}
    <p class="muted small">Szansa na szóstkę w ${esc(GAMES[game].label)} to 1 do 13 983 816, niezależnie od tego, kto typuje.</p>`;
}

function viewRanking() {
  const { cfg } = state.data;
  const g = state.rankGame;
  const rows = stats(g).sort((a, b) => (b.n > 0) - (a.n > 0) || b.avg - a.avg || a.name.localeCompare(b.name, 'pl'));
  const maxAvg = Math.max(0, ...rows.map((r) => r.avg));
  const scale = Math.max(1.5, maxAvg * 1.15);
  const pct = (x) => Math.max(0, Math.min(100, (x / scale) * 100));
  const settled = Math.max(0, ...rows.map((r) => r.n));
  const list = rows.map((r, i) => {
    const half = r.n ? (1.96 * SIGMA) / Math.sqrt(r.n) : 0;
    const lo = Math.max(0, EXPECTED - half), hi = EXPECTED + half;
    return `<li class="${r.n ? '' : 'idle'}">
      <span class="pos">${r.n ? i + 1 : '–'}</span>
      <span class="name"><span class="dot" style="background:${colorOf(r.id)}"></span>${esc(shortName(r.name))}</span>
      <span class="avg">${r.n ? fmtAvg(r.avg) : '–'}</span>
      <div class="track">
        ${r.n ? `<div class="band" style="left:${pct(lo)}%;width:${Math.max(0, pct(hi) - pct(lo))}%"></div>` : ''}
        ${r.n ? `<div class="fill" style="width:${pct(r.avg)}%;background:${colorOf(r.id)};opacity:.85"></div>` : ''}
        <div class="expect" style="left:calc(${pct(EXPECTED)}% - 1px)"></div>
      </div>
      <div class="sub">${r.n ? `${r.n} ${r.n === 1 ? 'zakład' : 'zakładów'} · razem ${r.total} trafień · trójki i lepiej: ${r.threes}` : 'jeszcze bez rozliczonego losowania'}</div>
    </li>`;
  }).join('');
  return `
    <h1>Ranking</h1>
    ${segHtml([['lotto', 'Lotto'], ['lottoplus', 'Lotto Plus'], ['all', 'Razem']], g, 'r')}
    <p class="muted small">Średnia liczba trafionych liczb na jeden zakład, od ${esc(dayShort(cfg.startDate || '2026-01-01'))}.${settled ? '' : ' Ranking ruszy po pierwszym losowaniu.'}</p>
    <div class="legend"><span><i class="l-exp"></i>średnia przy czystym losowaniu (${fmtAvg(EXPECTED)})</span><span><i class="l-band"></i>zwykły rozrzut losowego gracza (95%)</span></div>
    <ol class="rank">${list}</ol>
    <p class="muted small" style="margin-top:1rem">Jeśli pasek mieści się w szarym paśmie, wynik nie różni się od szczęścia. Przy tak małej liczbie losowań rozrzut jest duży, dlatego ranking ma sens dopiero po wielu miesiącach.</p>`;
}

function viewHistoria() {
  const g = state.game;
  const all = entries().filter((e) => e.drawn && e.game === g);
  const groups = new Map();
  for (const e of all) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  }
  const dates = [...groups.keys()].sort().reverse();
  const shown = dates.slice(0, state.histCount);
  let body = shown.map((date) => {
    const drawn = drawFor(g, date).numbers;
    const lines = groups.get(date).sort((a, b) => b.hits - a.hits).map((e) => {
      const pl = players().find((p) => p.id === e.player);
      return `<div class="line"><span class="who"><span class="dot" style="background:${colorOf(e.player)}"></span><b>${esc(pl ? shortName(pl.name) : 'Ty')}</b></span>${numsHtml(e.numbers, '', drawn)}<div class="score">${e.hits}/6</div></div>`;
    }).join('');
    return `<article class="card"><div class="draw-head"><b>${esc(dayLong(date))}</b><span class="muted small">${esc(GAMES[g].label)}</span></div>${numsHtml(drawn, 'win')}${lines}</article>`;
  }).join('');
  if (!body) {
    const last = state.data.draws[g].slice(-5).reverse();
    body = `<div class="empty"><b>Brak rozliczonych typów</b>Historia pojawi się po pierwszym losowaniu, na które ktoś postawił typ.</div>`;
    if (last.length) {
      body += `<h2>Ostatnie losowania</h2>` + last.map((d) => `<article class="card"><div class="draw-head"><b>${esc(dayLong(d.date))}</b><span class="muted small">${esc(GAMES[g].label)}</span></div>${numsHtml(d.numbers, 'win')}</article>`).join('');
    }
  }
  const more = dates.length > shown.length ? `<div class="row-actions"><button class="btn ghost" data-action="more">Pokaż starsze</button></div>` : '';
  return `<h1>Historia</h1>${segHtml(Object.entries(GAMES).map(([k, v]) => [k, v.label]), g, 'g')}${body}${more}`;
}

function viewInfo() {
  const { cfg, meta, draws } = state.data;
  const upd = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString('pl-PL', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) : 'jeszcze nie było';
  const models = Object.entries(cfg.models || {}).map(([id, m]) => `${esc(players().find((p) => p.id === id)?.name || id)}: ${esc(m)}`).join(', ');
  return `
    <h1>Info</h1>
    <h2>Jak to działa</h2>
    <p>Po każdym losowaniu Claude, Gemini i ChatGPT dostają historię losowań danej gry i podają jeden typ na następne. Dostają ten sam opis i te same dane. Obok typują komputer (losowo) i stałe liczby. Ty możesz dopisać własny typ, zapisuje się tylko w tym telefonie. Po losowaniu każdy typ jest rozliczany, a ranking liczy średnią trafień.</p>
    <h2>Uczciwie o szansach</h2>
    <p>Losowania są niezależne. Szansa na szóstkę wynosi 1 do 13 983 816 bez względu na historię, więc żaden model nie ma jak „przewidzieć” wyniku. Ranking ma to pokazać w praktyce: przy dużej liczbie losowań wszyscy powinni się zbliżyć do średniej ${fmtAvg(EXPECTED)} trafienia na zakład.</p>
    <h2>Ikona na ekranie głównym</h2>
    <ul class="plain">
      <li><b>iPhone (Safari):</b> Udostępnij → Dodaj do ekranu początkowego.</li>
      <li><b>Android (Chrome):</b> menu ⋮ → Zainstaluj aplikację albo Dodaj do ekranu głównego.</li>
    </ul>
    <h2>Twoje typy</h2>
    <p class="muted small">Zapisane tylko w tej przeglądarce. Kopia pozwala je przenieść na inny telefon.</p>
    <div class="row-actions"><button class="btn ghost" data-action="export">Pokaż kopię</button><button class="btn ghost" data-action="import">Wczytaj z pola</button></div>
    <textarea id="backup" aria-label="Kopia typów" spellcheck="false" placeholder="Tu pojawi się kopia, albo wklej własną i wybierz Wczytaj">${esc(state.backup)}</textarea>
    <p id="backup-msg" class="small muted"></p>
    <h2>Dane</h2>
    <p class="muted small">Losowania w bazie: Lotto ${draws.lotto.length}, Lotto Plus ${draws.lottoplus.length}. Ostatnia aktualizacja: ${esc(upd)}. Modele: ${models || 'brak'}.</p>
    <p class="muted small">To zabawa. Lotto jest grą hazardową dla osób pełnoletnich, a aplikacja niczego nie sprzedaje i nie przyjmuje zakładów.</p>`;
}

// ---------- render ----------
function render() {
  const view = $('#view');
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false'));
  if (state.error && !state.data) {
    view.innerHTML = `<h1>Trzej wróżbici</h1><div class="empty"><b>Brak danych</b>${esc(state.error)}</div><div class="row-actions"><button class="btn" data-action="reload">Spróbuj ponownie</button></div>`;
    return;
  }
  if (!state.data) { view.innerHTML = '<h1>Trzej wróżbici</h1><p class="muted">Wczytuję…</p>'; return; }
  view.innerHTML = { typy: viewTypy, ranking: viewRanking, historia: viewHistoria, info: viewInfo }[state.tab]();
}

// ---------- okno wyboru liczb ----------
function openSheet(game, date) {
  const root = $('#sheet-root');
  const sel = new Set(validTip(state.me[game][date]) ? state.me[game][date] : []);
  root.innerHTML = `<div class="backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Twój typ">
      <div class="sheet-head"><b>Twój typ · ${esc(GAMES[game].label)}</b><span class="muted small">${esc(dayLong(date))}</span></div>
      <p class="muted small" id="sheet-count"></p>
      <div class="grid49">${Array.from({ length: 49 }, (_, i) => `<button type="button" data-n="${i + 1}" aria-pressed="false">${i + 1}</button>`).join('')}</div>
      <p class="err" id="sheet-err" hidden></p>
      <div class="row-actions"><button class="btn" data-save>Zapisz</button><button class="btn ghost" data-clear>Wyczyść</button><button class="btn ghost" data-close>Anuluj</button></div>
    </div>`;
  const sync = () => {
    root.querySelectorAll('.grid49 button').forEach((b) => b.setAttribute('aria-pressed', String(sel.has(+b.dataset.n))));
    $('#sheet-count', root).textContent = `Wybierz 6 liczb (${sel.size}/6)`;
    $('[data-save]', root).disabled = sel.size !== 6;
  };
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.onclick = (e) => {
    const n = e.target.closest('[data-n]');
    if (n) {
      const v = +n.dataset.n;
      if (sel.has(v)) sel.delete(v); else if (sel.size < 6) sel.add(v);
      sync();
    } else if (e.target.closest('[data-clear]')) { sel.clear(); sync(); }
    else if (e.target.closest('[data-close]')) close();
    else if (e.target.closest('[data-save]')) {
      if (sel.size !== 6) return;
      if (Date.now() > nextDraw(new Date(), state.data.cfg).at.getTime() - LOCK_MARGIN && date === nextDraw(new Date(), state.data.cfg).date) {
        const err = $('#sheet-err', root); err.hidden = false; err.textContent = 'Za późno: do losowania zostało mniej niż 5 minut.'; return;
      }
      state.me[game][date] = [...sel].sort((a, b) => a - b);
      saveMe();
      close();
      render();
    }
  };
  sync();
  $('.grid49 button', root).focus();
}

// ---------- zdarzenia ----------
document.addEventListener('click', async (e) => {
  const tab = e.target.closest('#tabs [data-tab]');
  if (tab) { state.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const g = e.target.closest('.seg [data-g]');
  if (g) { state.game = g.dataset.g; render(); return; }
  const r = e.target.closest('.seg [data-r]');
  if (r) { state.rankGame = r.dataset.r; render(); return; }
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  if (act === 'pick') openSheet(state.game, a.dataset.date);
  else if (act === 'more') { state.histCount += 12; render(); }
  else if (act === 'reload') { await load(); render(); }
  else if (act === 'export') { state.backup = JSON.stringify(state.me); render(); }
  else if (act === 'import') {
    const msg = () => $('#backup-msg');
    try {
      const obj = JSON.parse($('#backup').value);
      const next = { lotto: {}, lottoplus: {} };
      let count = 0;
      for (const game of Object.keys(GAMES)) {
        for (const [date, nums] of Object.entries(obj[game] || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(date) && validTip(nums)) { next[game][date] = nums; count++; }
      }
      state.me = next; saveMe(); state.backup = '';
      render();
      $('#backup-msg').textContent = `Wczytano typów: ${count}.`;
    } catch {
      msg().textContent = 'Nie rozpoznałem tej kopii. Wklej całą zawartość pola z drugiego telefonu.';
    }
  }
});

setInterval(() => {
  const c = $('#count');
  if (c && state.data && state.tab === 'typy') {
    const nd = nextDraw(new Date(), state.data.cfg);
    if (!(state.data.cfg.startDate && nd.date < state.data.cfg.startDate)) c.textContent = countdownText(nd.at);
  }
}, 30000);

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > 5 * 60 * 1000) { await load(); render(); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

render();
await load();
render();
