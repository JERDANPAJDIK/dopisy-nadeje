# Stav projektu – Dopisy naděje

Aktualizováno: 2026-09-29 · Evaly: 17/18 bez OCR (`npm run eval -- --no-ocr`), OCR testy neběží

## Hotovo
- Profily vězňů (55, online 48), CZ/EN/RU UI, sbírka dopisů v localStorage, FAQ, návody k odeslání.
- Generování dopisu (`sW`): jen fakta od uživatele, věty uživatele zachovány, krok `<plan>`, dopis v `<letter>` tagu.
- Rod: přepínač „Píšu jako“ (muž/žena/neuvádět); rod z textu má přednost; lomítkové tvary → 1 opravný požadavek.
- Kontrola cenzury (`sC`): stručná, bez tabulek, neoznačuje běžné vřelé fráze (reálně prošlé dopisy projdou).
- Doporučení (`sM`): vždy 3 platná id, karta ukazuje popis z databáze, důvod jen jako krátká doslovná shoda.
- OCR (Gemini přes Cloudflare Worker): obrázky i PDF (render přes pdf.js), odmítá nečitelný vstup.
- Opraven parser streamu v `ai()` – dřív ztrácel kusy textu na hranicích chunků (i v dopisech).
- Evaly: `evals/run.mjs` + `evals/cases.json`, fixtures a výsledky mimo git.
- Ze Sašina feedbacku: „X let vězení“, jméno odesílatele azbukou, FAQ bez literárních textů.

## Otevřené body
**Vysoká**
- Tlačítko zpět / šipky prohlížeče; návrat ztratí stav (text o sobě i doporučené vězně).
- Nápověda, co o sobě napsat, v kroku psaní (jméno, věk, proč píšu, delší/kratší dopis).
- Regenerace a úprava vygenerovaného dopisu („vygenerovat znovu“, „uprav/zkontroluj můj text“).

**Střední**
- Zjednodušit compose flow (text → kontrola → překlad ve třech oknech, překlad dole přehlédnutelný).
- Kontrola: upozornit, když se pisatel nepředstavil (bez tlaku, jméno není povinné).
- Zastaralý popisek „v češtině i ruštině“ v kroku psaní (dopis se generuje jen česky, překlad zvlášť).
- Ruské tvary trestů v datech: „4 лет“ → „4 года“ (2–4 года, 5+ лет).

**Nízká**
- `sW-long-input-kept` kolísá (~91 % běhů): občas „Jako knihovník bych se rád zeptal…“ navzdory zákazu.
- OCR rukopisu Poljudové: few-shot příklady.
- `netlify/edge-functions/claude.js` má nepoužívanou Gemini větev (obrázky jdou na Worker) – uklidit.
- Evaly: každý případ běží 3×, modely kolísají; sledovat procenta v REPORT.md.

## Čeká na nás / na ověření
- Saša: kontrola nových ruských textů v UI (přepínač rodu, nápovědy, úvodní věta doporučení).
- OCR testy čekají na placený Gemini klíč v `.env.local` (bezplatná úroveň: 20 req/den, data mohou jít na trénink).
- Ověřit, v jakém projektu/úrovni je produkční Gemini klíč Workeru (free tier = 20 OCR/den pro všechny).

## Blokováno externě
Čeká na přístup k databázi OVD-Info přes Věstočku:
- fotky vězňů, adresy (zatím 3 z 55), detailní profily, pravidelná aktualizace dat (propuštění, kdo jde online).

## Klíčová rozhodnutí a proč
- **Claude přes Netlify edge, klíč na serveru** – žádný klíč v klientu; rate limit 30 req/h/IP.
- **OCR na Gemini přes Cloudflare Worker** – Netlify edge má 40s limit, OCR ho překračovalo; Worker s origin checkem a rate limitem.
- **Nejdřív česky, překlad zvlášť** – uživatel může text upravit, než se přeloží.
- **Prompty v `src/prompts.js`** – sdílí je aplikace i evaly; `P` a `cleanLetter` čtou evaly přímo z App.jsx.
- **Tagy `<letter>`/`<json>` + prostor na plán** – model přestal „opravovat nahlas“ uvnitř výstupu.
- **Důvod doporučení jen doslovná shoda** – Saša: vymyšlené zdůvodnění („jako architekt víte…“) je horší než žádné.
- **Hodnotitel Haiku jen na jednoduché ano/ne** – na českou gramatiku a jemné nuance nespolehlivý, tam regex.
- **Žádný regex lookbehind** – starší iOS Safari kvůli němu neparsuje bundle.
- **Osobní dopisy nikdy do gitu** – jen odkazy do `evals/fixtures/`.
