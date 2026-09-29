# CLAUDE.md

## Projekt
- React/Vite SPA. Veškerý frontend je v `src/App.jsx`.
- Deploy: push na `main` → Netlify se nasadí automaticky.

## Git
- NIKDY nepoužívej `git add .` ani `git add -A`. Soubory přidávej vždy jednotlivě jménem.
- Před commitem spusť `git status` a ukaž mi výstup.
- Commit message piš na jeden řádek, anglicky, bez diakritiky.
- Před pushem se mě vždycky zeptej.

## Build
- Po každé změně kódu spusť `npm run build`. Commituj jen tehdy, když build projde.

## Kód
- Funkce `t()` a proměnná `_lang` musí zůstat definované na úrovni modulu.
- V dceřiných komponentách používej `_lang`, nikdy `lang`.
- V JS stringech nepoužívej české typografické uvozovky („ “).
