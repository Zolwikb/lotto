// Szybki test połączenia z API Totalizatora. Pokazuje surową odpowiedź i to, jak ją rozumiemy.
import { GAMES } from './lib.js';
import { lastResults, normalize } from './lotto-api.js';

for (const game of Object.keys(GAMES)) {
  console.log(`\n== ${GAMES[game].label} ==`);
  try {
    const raw = await lastResults(game);
    console.log('Surowa odpowiedź (początek):');
    console.log(JSON.stringify(raw, null, 1).slice(0, 1500));
    const parsed = normalize(raw, game);
    console.log('Rozpoznane losowania:', JSON.stringify(parsed));
    if (!parsed.length) console.log('UWAGA: nic nie rozpoznano, wyślij mi powyższą odpowiedź, dostosuję parser.');
  } catch (e) {
    console.log('BŁĄD:', e.message);
    process.exitCode = 1;
  }
}
