# Stav projektu – Dopisy naděje

Aktualizováno: 2026-10-29 · Evaly: 17/18 bez OCR (`npm run eval -- --no-ocr`, stav k 29. 9.; nové případy `sD-faithful-czech` a `sM-live-three-valid-picks` zatím nespuštěné), OCR testy neběží

## Hotovo
- **Vězni živě z OVD-Info (10/2026):** `netlify/functions/prisoners.mjs` na `/api/prisoners` stahuje `profiles` s filtrem Věstočky (`is_imprisoned`, `online_letters_now`, `hide_from_products=false`) – dnes 1 171 lidí, fotky, adresy, tresty. CDN cache 6 h (OVD-Info se aktualizuje po 6 h). Česká jména, profese, města a tresty (správné tvary „года/лет“) se tvoří na serveru.
- Pole `P` v `App.jsx` je teď jen překryv: 45 vězňů s texty Gulag.cz (české jméno a popis, profese, zájmy); věk, trest, adresu a EN/RU popis bere vždy z OVD-Info. 5 ručních záznamů, které OVD-Info nevede, je na konci seznamu. Když API selže, aplikace ukáže jen `P`.
- Česky: popis bez textu od Gulag.cz překládá Claude při otevření profilu / doporučení (`sD`), cache v localStorage (`dopisy-nadeje-cs`), označeno „Automatický překlad“. Výstup ve značkách `<t id>`, ne JSON (uvozovky v názvech organizací rozbíjely JSON); pevné termíny pro ruské kolonie.
- Doporučení (`sM`) dostává zkrácený seznam všech vězňů (id | věk | pohlaví | profese | zájmy), ~15k tokenů na dotaz.
- Seznam: fotky, město, stránkování po 30, hledání ve všech jazycích podle začátků slov (už nenajde „art“ v „party“). Odkaz „Celý příběh na Vestochka.io“ u všech z OVD-Info.
- CZ/EN/RU UI, sbírka dopisů v localStorage, FAQ, návody k odeslání.
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

**Nízká**
- `sW-long-input-kept` kolísá (~91 % běhů): občas „Jako knihovník bych se rád zeptal…“ navzdory zákazu.
  Otázka na příště: je to opravdu vymyšlené, nebo jen přeformulování toho, co uživatel napsal (je knihovník a ptá se na knihy)? Pokud to druhé, uvolnit test a zrušit zákaz „Jako + profese“ v `sW`.
- OCR rukopisu Poljudové: few-shot příklady.
- `netlify/edge-functions/claude.js` má nepoužívanou Gemini větev (obrázky jdou na Worker) – uklidit.
- Evaly: každý případ běží 3×, modely kolísají; sledovat procenta v REPORT.md.

## Čeká na nás / na ověření
- **Ověřit s Gulag.cz (nasazeno 29. 10. v použitelné podobě):** (1) Petra: text publicity OP JAK na úvodní stránce a v patičce (chybí hlavní cíl projektu ze žádosti) a umístění logolinku EU+MŠMT (oficiální soubory z opjak.cz, verze od 4/2026). (2) Saša / Věstočka: formulace „Data a fotografie vězňů: OVD-Info. Děkujeme týmu Věstočky, projektu OVD-Info…“ – chtějí být uvedeni jako OVD-Info, nebo Věstočka? (3) Čísla „2 136 vězňů“ / „přes 2 100 lidí“ na úvodu nemají uvedený zdroj.
- Patička: poděkování jen Alza.cz (Erasmus+ a MZV odstraněny – nefinancují tuto aplikaci).
- **Netlify: nastavit env proměnnou `OVD_API_KEY`** (klíč z mailu Věstočky 6. 10.) – bez ní `/api/prisoners` vrací 500 a aplikace jede jen na ručním seznamu.
- Nasazeno a ověřeno na produkci 29. 10. (1 171 vězňů, CDN cache funguje, český překlad i doporučení s reálným AI). Evaly `npm run eval -- sD` a `npm run eval -- sM-live` zatím nespuštěné.
- **OCR Worker:** v `workers/ocr/worker.js` zvednut limit z 20 na 150 dotazů/h na IP (třída za jednou IP). Worker se nasazuje ručně v Cloudflare dashboardu – změna platí až po vložení nového kódu tam.
- Doporučení nad celým seznamem trvá 13–18 s (~15k tokenů vstupu). Kdyby to vadilo: prompt caching, nebo předvýběr kandidátů.
- Saša: projít 5 ručních záznamů mimo OVD-Info (Vlasovová, Jelcovová, Oleksij a Anželika Děmjaněnkovi, Bujanovová) – nechat, nebo vyřadit? A nové ruské texty v UI (hláška o načítání, patička, „Полная история на «Весточке»“, krok 01 na úvodu).
- Data OVD-Info občas nesedí sama se sebou (Ponomarenková: `sentence_months` = 2 roky 3 měsíce, text „к шести годам“) – ukazujeme, co OVD-Info dává.
- Vyřazeni jako propuštění/v zahraničí: Skočilenko, Orlov, Čanyševa, Fadějeva, Moskaljov. Kozyrevová byla v ručních datech vedená jako propuštěná, OVD-Info ji vede ve vězení – opraveno podle OVD-Info.
- Saša: kontrola nových ruských textů v UI (přepínač rodu, nápovědy, úvodní věta doporučení).
- OCR testy čekají na placený Gemini klíč v `.env.local` (bezplatná úroveň: 20 req/den, data mohou jít na trénink).
- Ověřit, v jakém projektu/úrovni je produkční Gemini klíč Workeru (free tier = 20 OCR/den pro všechny).

## Blokováno externě
- Nic. (Přístup k OVD-Info vyřešen 10/2026 – klíč jen pro čtení, API se obnovuje 01/07/13/19 UTC, data jsou veřejná, fotky smíme používat se zdrojem OVD-Info.)

## Klíčová rozhodnutí a proč
- **Rate limit AI (10/2026):** 40 dotazů/h na prohlížeč (náhodné ID v localStorage, hlavička `X-Client-Id`) + 300/h na IP. Dřív 30/h na IP – celá třída za školní IP by se zasekla po ~6 žácích. Limit je v paměti edge instance, tedy jen orientační.
- **Data vězňů přes Netlify Function, ne edge** – surová data mají ~11 MB, parsování by přesáhlo 50 ms CPU limit edge funkcí. Odpověď v CDN cache 6 h + stale-while-revalidate, OVD-Info tak dostane pár dotazů denně. API OVD-Info za Cloudflare blokuje výchozí user-agent Pythonu – funkce posílá vlastní.
- **Fakta z OVD-Info, české texty z Gulag.cz** – ruční údaje (věk, tresty) byly z velké části zastaralé.
- **Pořadí v seznamu:** nejdřív vězni s texty Gulag.cz, ostatní náhodně, aby se dopisy rozložily mezi všechny.
- **Claude přes Netlify edge, klíč na serveru** – žádný klíč v klientu; rate limit 30 req/h/IP.
- **OCR na Gemini přes Cloudflare Worker** – Netlify edge má 40s limit, OCR ho překračovalo; Worker s origin checkem a rate limitem.
- **Nejdřív česky, překlad zvlášť** – uživatel může text upravit, než se přeloží.
- **Prompty v `src/prompts.js`** – sdílí je aplikace i evaly; `P` a `cleanLetter` čtou evaly přímo z App.jsx.
- **Tagy `<letter>`/`<json>` + prostor na plán** – model přestal „opravovat nahlas“ uvnitř výstupu.
- **Důvod doporučení jen doslovná shoda** – Saša: vymyšlené zdůvodnění („jako architekt víte…“) je horší než žádné.
- **Hodnotitel Haiku jen na jednoduché ano/ne** – na českou gramatiku a jemné nuance nespolehlivý, tam regex.
- **Žádný regex lookbehind** – starší iOS Safari kvůli němu neparsuje bundle.
- **Osobní dopisy nikdy do gitu** – jen odkazy do `evals/fixtures/`.
