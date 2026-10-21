# Trzej wróżbici (Lotto i Lotto Plus)

Strona-aplikacja: Claude, Gemini i ChatGPT typują Lotto i Lotto Plus, a ranking pokazuje, kto trafia najlepiej.
Działa za darmo na GitHubie: GitHub Pages pokazuje stronę, a GitHub Actions robi robotę (pobiera losowania, pyta modele, zapisuje wyniki).

## Uruchomienie krok po kroku (komputer, ok. 20 minut)

1. Załóż konto na github.com i utwórz nowe repozytorium **publiczne** (np. `wrozbici`).
2. Wgraj całą zawartość tego folderu do repozytorium (Add file → Upload files; przeciągnij pliki i foldery, w tym ukryty folder `.github`).
3. Ustawienia repozytorium → **Secrets and variables → Actions → New repository secret**. Dodaj sekrety (nazwy dokładnie takie):
   - `LOTTO_API_KEY` – klucz od Totalizatora (wymagany)
   - `GEMINI_API_KEY` – z aistudio.google.com (darmowy limit)
   - `ANTHROPIC_API_KEY` – z console.anthropic.com (doładowanie od ok. 5 USD)
   - `OPENAI_API_KEY` – z platform.openai.com (doładowanie od ok. 5 USD)

   Brak klucza modelu = ten model jest pomijany, reszta działa.
4. Ustawienia → **Pages** → Source: *Deploy from a branch*, Branch: `main`, folder: `/docs` → Save. Po minucie dostaniesz adres strony.
5. Zakładka **Actions** → „Typy Lotto” → Run workflow → wybierz `check-api` → sprawdź w logu, czy API Totalizatora odpowiada i czy losowania są rozpoznane.
6. Ten sam workflow z opcją `backfill` pobiera archiwum losowań (do ok. 25 lat wstecz, ile udostępnia API; może potrwać kilkadziesiąt minut).
7. Ten sam workflow z opcją `run` robi pierwsze typy na najbliższe losowanie. Potem wszystko dzieje się samo: codziennie o 22:30 (rozliczenie + typy na następne) i o 6:00 (zapas).
8. Na telefonie otwórz adres strony → iPhone (Safari): Udostępnij → Dodaj do ekranu początkowego; Android (Chrome): ⋮ → Zainstaluj aplikację.

## Ustawienia (plik docs/data/config.json)

- `startDate` – od kiedy liczy się ranking (domyślnie 2026-10-22).
- `recentDraws` – ile ostatnich losowań dostaje każdy model w zapytaniu (domyślnie 1500). Do tego dostaje zestawienie statystyk z całego archiwum liczone lokalnie. Większa liczba = większy koszt zapytań.
- `models` – nazwy modeli. Sprawdź, czy są aktualne u dostawców, w razie potrzeby zmień tutaj.
- `fixed` – Twoje stałe liczby, np. `"lotto": [3, 11, 19, 27, 34, 45]` (6 różnych liczb 1-49). Dopóki puste, ten gracz jest pomijany.

## Uwagi

- Format odpowiedzi API Totalizatora wzięto z dokumentacji, ale nie był testowany z prawdziwym kluczem. Jeśli `check-api` pokaże „nic nie rozpoznano”, wyślij log, dostosuję parser.
- Własne typy w aplikacji zapisują się tylko w danym telefonie (Info → kopia typów).
- Skrypty: `scripts/run.js`, `backfill.js`, `check-api.js`, `import-history.js` (plan B: archiwum z pliku).
