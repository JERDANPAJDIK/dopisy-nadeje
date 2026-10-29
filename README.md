# Dopisy naděje

Webová aplikace na pomoc s psaním dopisů ruským politickým vězňům. Vytvořeno pro Gulag.cz ve spolupráci s Vestochka / OVD-Info.

## Vývoj lokálně

```bash
npm install
npm run dev
```

Aplikace běží na http://localhost:5173

Pro lokální testování AI funkcí potřebuješ:
1. Anthropic API klíč (https://console.anthropic.com/)
2. Spustit Netlify CLI: `npm install -g netlify-cli` → `netlify dev`
3. Nastavit env proměnnou: vytvoř soubor `.env` s `ANTHROPIC_API_KEY=sk-ant-...`

## Build pro produkci

```bash
npm run build
```

Výstup je v `dist/`.

## Nasazení na Netlify

1. Pushni kód na GitHub (viz instrukce v chatu)
2. Na netlify.com → "Add new site" → "Import existing project"
3. Připoj GitHub a vyber tento repository
4. Build settings: 
   - Build command: `npm run build`
   - Publish directory: `dist`
5. **Důležité**: Site settings → Environment variables → přidat:
   - `ANTHROPIC_API_KEY` = tvůj klíč z console.anthropic.com
   - `OVD_API_KEY` = klíč k API OVD-Info (dostali jsme ho přes Věstočku; jen na serveru, nikdy v kódu)
6. Deploy

## Architektura

- **Frontend**: React + Vite + Tailwind, single page app
- **Backend**: Netlify Edge Function (`netlify/edge-functions/claude.js`) jako proxy k Anthropic API
- **Data vězňů**: Netlify Function `netlify/functions/prisoners.mjs` na `/api/prisoners` – stahuje z API OVD-Info (`api-data.ovd.info/profiles`, stejný výběr jako Věstočka), převádí do formátu aplikace a Netlify odpověď drží v CDN cache 6 h. Ručně psané texty Gulag.cz (pole `P` v `App.jsx`) se přes ně překryjí.
- **České popisy vězňů**: předpřeložené Claude Sonnetem v `public/translations-cs.json` (klíč = id vězně + hash ruského textu). Obnovit / doplnit nové: `node scripts/translate-descriptions.mjs` (klíč z `.env.local`) nebo `node scripts/translate-descriptions.mjs --via-proxy` (přes produkční `/api/claude`), pak commit souboru. Co v souboru chybí, přeloží aplikace za běhu.
- API klíče jsou vždy server-side, nikdy se nedostanou do prohlížeče

## Cena provozu

- Netlify Free Tier: 100 GB bandwidth/měsíc, 125k function invocations zdarma
- Anthropic API: zhruba $0.02 za vygenerovaný dopis (Sonnet 4)
- Při 1000 dopisech/měsíc cca $20

## Limity prototypu, které je potřeba řešit pro produkci

1. ~~Databáze vězňů je hardcoded v JS~~ — od 10/2026 živě z API OVD-Info (viz výše)
2. **Sbírka dopisů uživatele se ztratí při refresh** — potřeba persistence (localStorage nebo backend)
3. **Žádné rate limiting** — kdokoli by mohl spamovat AI volání. Doporučuji přidat Cloudflare Turnstile nebo session limit
4. **Žádná analytika** — přidat Plausible nebo Google Analytics

## Licence

MIT
