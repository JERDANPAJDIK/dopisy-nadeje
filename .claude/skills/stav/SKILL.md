---
name: stav
description: Shrne, kde projekt Dopisy naděje je – přečte docs/STATUS.md, commity od jeho poslední aktualizace a poslední eval report, a navrhne další krok. Použij na začátku session nebo když se uživatel ptá "kde jsme", "co dál", "/stav".
---

# /stav – kde jsme a co dál

Nic neměň, jen čti a shrň.

1. Přečti `docs/STATUS.md`.
2. Zjisti commity od poslední aktualizace STATUS.md:
   ```bash
   git log --oneline "$(git log -1 --format=%H -- docs/STATUS.md)"..HEAD
   ```
   Přidej `git status --short` (necommitnutá práce).
3. Přečti `evals/results/REPORT.md`, pokud existuje (je mimo git). Zjisti datum běhu a souhrn prošlo/neprošlo. Pokud chybí, napiš to.
4. Odpověz česky, **max 10 řádků**:
   - kde jsme (1–2 řádky),
   - co se změnilo od aktualizace STATUS.md (commity, necommitnuté změny),
   - evaly: souhrn a co neprošlo (jen jména případů),
   - co čeká na někoho jiného (Saša, klíče, Věstočka), jen pokud je to relevantní,
   - návrh 1–3 dalších kroků podle priorit v STATUS.md; když je STATUS.md zjevně zastaralý, navrhni `/konec`.
