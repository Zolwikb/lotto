// Plan B na archiwum: import z pliku tekstowego/CSV, gdzie w każdej linii jest data i 6 liczb.
// Użycie: node scripts/import-history.js lotto plik.txt   (lub: lottoplus plik.txt)
import fs from 'node:fs';
import { GAMES, readJson, writeJson, validNumbers } from './lib.js';
import { mergeDraws } from './lotto-api.js';

const [game, file] = process.argv.slice(2);
if (!GAMES[game] || !file) {
  console.log('Użycie: node scripts/import-history.js <lotto|lottoplus> <plik>');
  process.exit(1);
}
const pad = (n) => String(n).padStart(2, '0');
const fresh = [];
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  let date, rest;
  let m = line.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    date = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    rest = line.slice(m.index + m[0].length);
  } else if ((m = line.match(/(\d{4})-(\d{2})-(\d{2})/))) {
    date = m[0];
    rest = line.slice(m.index + m[0].length);
  } else continue;
  const nums = (rest.match(/\d+/g) || []).map(Number).sort((a, b) => a - b);
  if (validNumbers(nums)) fresh.push({ date, id: null, numbers: nums });
}
const { merged, added } = mergeDraws(readJson(`draws-${game}.json`, []), fresh);
writeJson(`draws-${game}.json`, merged);
console.log(`Wczytano ${fresh.length} linii, dodano ${added}, razem ${merged.length}`);
