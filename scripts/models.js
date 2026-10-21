// Trzej wróżbici: Claude, Gemini, ChatGPT. Ten sam prompt i te same dane dla każdego.
import { GAMES, fetchJson, validNumbers } from './lib.js';

// Zestawienie z CAŁEGO archiwum, liczone lokalnie (nic nie kosztuje): dla każdej liczby 1-49
// ile razy padła i ile losowań temu padła ostatnio, plus rozkład sum i parzystych.
export function archiveStats(history) {
  const n = history.length;
  const count = Array(50).fill(0);
  const last = Array(50).fill(-1);
  const sums = [];
  const evens = Array(7).fill(0);
  history.forEach((d, i) => {
    let sum = 0, ev = 0;
    for (const x of d.numbers) {
      count[x]++;
      last[x] = i;
      sum += x;
      if (x % 2 === 0) ev++;
    }
    sums.push(sum);
    evens[ev]++;
  });
  const avgSum = sums.reduce((a, b) => a + b, 0) / (n || 1);
  const perNumber = Array.from({ length: 49 }, (_, k) => `${k + 1}:${count[k + 1]}x/${last[k + 1] < 0 ? '-' : n - 1 - last[k + 1]}`).join(' ');
  return `Zestawienie z całego archiwum (${n} losowań, od ${history[0].date} do ${history[n - 1].date}).
Każda liczba w formacie liczba:ile razy padła/ile losowań temu padła ostatnio (0 = w ostatnim losowaniu):
${perNumber}
Średnia suma sześciu liczb: ${avgSum.toFixed(1)}. Rozkład liczby parzystych w losowaniu (0 do 6): ${evens.join(', ')}.`;
}

export function buildPrompt(game, history, drawDate, depth = 150) {
  const shown = history.slice(-depth);
  const rows = shown.map((d) => `${d.date}: ${d.numbers.join(' ')}`).join('\n');
  const stats = history.length > shown.length ? `${archiveStats(history)}\n\n` : '';
  return `Gra: ${GAMES[game].label}. Losuje się 6 różnych liczb z zakresu 1-49.
To zabawa: ranking, który model lepiej typuje liczby.

${stats}Dostajesz ostatnie ${shown.length} losowań (od najstarszego do najnowszego):

${rows}

Zaproponuj swój typ na najbliższe losowanie (${drawDate}): dokładnie 6 różnych liczb z zakresu 1-49.
Odpowiedz wyłącznie obiektem JSON, bez dodatkowego tekstu:
{"numbers":[n1,n2,n3,n4,n5,n6],"reasoning":"uzasadnienie po polsku, maksymalnie 3 zdania, własnymi słowami"}`;
}

const CLAUDE_URL = process.env.ANTHROPIC_BASE || 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = process.env.OPENAI_BASE || 'https://api.openai.com/v1/chat/completions';
const GEMINI_BASE = process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta/models';

async function askClaude(prompt, model) {
  const r = await fetchJson(
    CLAUDE_URL,
    {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    },
    { label: `Claude (${model})` },
  );
  return (r.content || []).map((c) => c.text || '').join('');
}

async function askGemini(prompt, model) {
  const r = await fetchJson(
    `${GEMINI_BASE}/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4000 },
      }),
    },
    { label: `Gemini (${model})` },
  );
  return (r.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

async function askChatGPT(prompt, model) {
  const r = await fetchJson(
    OPENAI_URL,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 4000,
      }),
    },
    { label: `ChatGPT (${model})` },
  );
  return r.choices?.[0]?.message?.content || '';
}

export const PROVIDERS = {
  claude: { env: 'ANTHROPIC_API_KEY', ask: askClaude },
  gemini: { env: 'GEMINI_API_KEY', ask: askGemini },
  chatgpt: { env: 'OPENAI_API_KEY', ask: askChatGPT },
};

export function parseReply(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('brak JSON-a w odpowiedzi');
  const obj = JSON.parse(m[0]);
  const numbers = (obj.numbers || []).map(Number).sort((a, b) => a - b);
  if (!validNumbers(numbers)) throw new Error(`niepoprawne liczby: ${JSON.stringify(obj.numbers)}`);
  return { numbers, reasoning: String(obj.reasoning || '').trim().slice(0, 600) };
}

// Pyta model, przy złej odpowiedzi ponawia raz.
export async function getPick(providerId, model, prompt) {
  const p = PROVIDERS[providerId];
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      return parseReply(await p.ask(prompt, model));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
