---
name: konec
description: Na konci session aktualizuje docs/STATUS.md podle toho, co se v session udělalo, a připraví commit jen tohoto souboru. Spouštěj jen na výslovnou žádost ("/konec").
disable-model-invocation: true
---

# /konec – aktualizace STATUS.md

1. Podklady:
   - `docs/STATUS.md` (aktuální stav),
   - `git log --oneline "$(git log -1 --format=%H -- docs/STATUS.md)"..HEAD` a `git status --short`,
   - `evals/results/REPORT.md`, pokud existuje (souhrn a datum),
   - co se v této session řešilo, rozhodlo nebo zjistilo (z konverzace).
2. Uprav `docs/STATUS.md`:
   - hotové body přesuň do „Hotovo“ (stručně, jedna řádka na věc; starší hotové body slučuj),
   - nové otevřené body přidej s prioritou (vysoká/střední/nízká), vyřešené odeber,
   - aktualizuj „Čeká na nás / na ověření“ a „Blokováno externě“,
   - nové klíčové rozhodnutí zapiš vždy i s důvodem („proč“),
   - aktualizuj řádek „Aktualizováno:“ (dnešní datum) a výsledek evalů,
   - drž soubor do ~80 řádků, česky, bez osobních textů z dopisů.
3. Ukaž uživateli diff (`git diff docs/STATUS.md`).
4. Připrav commit podle CLAUDE.md:
   - `git add docs/STATUS.md` – jen tento soubor, nikdy `git add .` ani `-A`,
   - spusť `git status` a ukaž výstup,
   - navrhni jednořádkovou anglickou commit message bez diakritiky (např. `Update STATUS.md after <téma>`),
   - commitni až po potvrzení uživatele. Nepushuj bez výslovného souhlasu.
