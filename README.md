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
6. Deploy

## Architektura

- **Frontend**: React + Vite + Tailwind, single page app
- **Backend**: Netlify Function (`netlify/functions/claude.js`) jako proxy k Anthropic API
- API klíč je vždy server-side, nikdy se nedostane do prohlížeče

## Cena provozu

- Netlify Free Tier: 100 GB bandwidth/měsíc, 125k function invocations zdarma
- Anthropic API: zhruba $0.02 za vygenerovaný dopis (Sonnet 4)
- Při 1000 dopisech/měsíc cca $20

## Limity prototypu, které je potřeba řešit pro produkci

1. **Databáze vězňů je hardcoded v JS** — pro produkci by se měla získávat živě z Vestochka.io API (kontaktovat OVD-Info pro přístup) nebo z gulag.cz
2. **Sbírka dopisů uživatele se ztratí při refresh** — potřeba persistence (localStorage nebo backend)
3. **Žádné rate limiting** — kdokoli by mohl spamovat AI volání. Doporučuji přidat Cloudflare Turnstile nebo session limit
4. **Žádná analytika** — přidat Plausible nebo Google Analytics

## Licence

MIT
