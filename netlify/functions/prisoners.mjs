// GET /api/prisoners – current list of political prisoners who can receive letters,
// taken from the OVD-Info public API (the same selection as the Vestochka site).
// The API key stays on the server (Netlify env var OVD_API_KEY).
// The response is cached on Netlify's CDN for 6 h (OVD-Info updates every 6 h),
// so OVD-Info gets only a handful of requests a day, whatever the traffic.
//
// This is a regular (Node) function, not an edge function: the raw data is ~11 MB of JSON
// and parsing it would exceed the 50 ms CPU limit of edge functions.

export const config = { path: "/api/prisoners" };

const API = "https://api-data.ovd.info/profiles";
// Vestochka's selection: imprisoned, letters can be sent now, not hidden by OVD-Info
const FILTER = { is_imprisoned: "true", online_letters_now: "true", hide_from_products: "false" };

// ---------- names ----------
// Czech transliteration of Russian (Jurij Dmitrijev, Jevgenija Majboroda)
const CZ = { а:"a",б:"b",в:"v",г:"g",д:"d",ж:"ž",з:"z",и:"i",й:"j",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"ch",ц:"c",ч:"č",ш:"š",щ:"šč",ъ:"",ы:"y",ь:"",э:"e",ю:"ju",я:"ja" };
const VOWELS = "аеёиоуыэюяъь";
export function translitCz(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], lo = ch.toLowerCase(), prev = (s[i - 1] || " ").toLowerCase();
    let r;
    if (lo === "е") r = (i === 0 || VOWELS.includes(prev) || !/[а-яё]/.test(prev)) ? "je" : "e";
    else if (lo === "ё") r = "жчшщ".includes(prev) ? "o" : "jo";
    else if (lo === "и" && prev === "ь") r = "ji";
    else if (lo in CZ) r = CZ[lo];
    else { out += ch; continue; }
    out += ch !== lo && r ? r[0].toUpperCase() + r.slice(1) : r;
  }
  return out;
}
const LAT = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
const translitEn = s => [...s].map(ch => { const lo = ch.toLowerCase(); if (!(lo in LAT)) return ch; const r = LAT[lo]; return ch !== lo && r ? r[0].toUpperCase() + r.slice(1) : r; }).join("");
const isCyr = s => /[а-яё]/i.test(s || "");
// Czech names of places where plain transliteration is not what Czechs use
const CZ_PLACES = { "Санкт-Петербург": "Petrohrad", "Казань": "Kazaň", "Тюмень": "Ťumeň", "Пермь": "Perm", "Рязань": "Rjazaň" };
const cityCz = c => c ? (CZ_PLACES[c] || translitCz(c)) : "";

// "Фамилия Имя Отчество" -> { last, first }
function splitName(full) {
  const parts = (full || "").replace(/\s+/g, " ").trim().split(" ");
  return parts.length >= 2 ? { last: parts[0], first: parts[1] } : { last: parts[0] || "", first: "" };
}

// ---------- occupations (OVD-Info categories, plural) -> singular, by gender ----------
// [cs masc, cs fem, en, ru masc, ru fem]
const OCC = {
  "Рабочие":["dělník","dělnice","Worker","рабочий","рабочая"],
  "Предприниматели":["podnikatel","podnikatelka","Entrepreneur","предприниматель","предпринимательница"],
  "Военнослужащие":["voják","vojačka","Soldier","военнослужащий","военнослужащая"],
  "Строители":["stavař","stavařka","Construction worker","строитель","строитель"],
  "Студенты":["student","studentka","Student","студент","студентка"],
  "Офисные работники":["úředník","úřednice","Office worker","офисный работник","офисная работница"],
  "Водители":["řidič","řidička","Driver","водитель","водитель"],
  "Журналисты":["novinář","novinářka","Journalist","журналист","журналистка"],
  "Пенсионеры":["důchodce","důchodkyně","Retiree","пенсионер","пенсионерка"],
  "Бывшие военнослужащие":["bývalý voják","bývalá vojačka","Former soldier","бывший военнослужащий","бывшая военнослужащая"],
  "Деятели искусства":["umělec","umělkyně","Artist","деятель искусства","деятельница искусства"],
  "Инженеры":["inženýr","inženýrka","Engineer","инженер","инженер"],
  "Безработные":["nezaměstnaný","nezaměstnaná","Unemployed","безработный","безработная"],
  "Преподаватели":["učitel","učitelka","Teacher","преподаватель","преподавательница"],
  "Продавцы":["prodavač","prodavačka","Shop assistant","продавец","продавщица"],
  "IT-специалисты":["IT specialista","IT specialistka","IT specialist","IT-специалист","IT-специалистка"],
  "Юристы":["právník","právnička","Lawyer","юрист","юристка"],
  "Блогеры":["blogger","bloggerka","Blogger","блогер","блогерка"],
  "Политики":["politik","politička","Politician","политик","политик"],
  "Работники сферы услуг":["pracovník ve službách","pracovnice ve službách","Service worker","работник сферы услуг","работница сферы услуг"],
  "Ученые":["vědec","vědkyně","Scientist","учёный","учёная"],
  "Религиозные деятели":["duchovní","duchovní","Religious figure","религиозный деятель","религиозная деятельница"],
  "Медработники":["zdravotník","zdravotnice","Health worker","медработник","медработница"],
  "Правозащитники":["obránce lidských práv","obránkyně lidských práv","Human rights defender","правозащитник","правозащитница"],
  "Повара":["kuchař","kuchařka","Cook","повар","повар"],
  "Электрики":["elektrikář","elektrikářka","Electrician","электрик","электрик"],
  "Слесари":["zámečník","zámečnice","Mechanic","слесарь","слесарь"],
  "Фермеры":["farmář","farmářka","Farmer","фермер","фермерша"],
  "Спортсмены":["sportovec","sportovkyně","Athlete","спортсмен","спортсменка"],
  "Финансисты и бухгалтеры":["finančník, účetní","finančnice, účetní","Finance / accounting","финансист, бухгалтер","финансист, бухгалтер"],
  "Школьники":["školák","školačka","School student","школьник","школьница"],
  "Чиновники":["úředník státní správy","úřednice státní správy","Official","чиновник","чиновница"],
  "Охранники":["ochrankář","ochrankářka","Security guard","охранник","охранница"],
  "Музыканты":["hudebník","hudebnice","Musician","музыкант","музыкантка"],
  "Домохозяйки и домохозяева":["v domácnosti","v domácnosti","Homemaker","домохозяин","домохозяйка"],
  "Бывшие чиновники":["bývalý úředník","bývalá úřednice","Former official","бывший чиновник","бывшая чиновница"],
  "Дворники":["uklízeč","uklízečka","Street cleaner","дворник","дворник"],
  "Сотрудники НКО":["pracovník neziskovky","pracovnice neziskovky","NGO worker","сотрудник НКО","сотрудница НКО"],
  "Парикмахеры":["kadeřník","kadeřnice","Hairdresser","парикмахер","парикмахер"],
  "Адвокаты":["advokát","advokátka","Attorney","адвокат","адвокат"],
  "Зоозащитники":["ochránce zvířat","ochránkyně zvířat","Animal rights activist","зоозащитник","зоозащитница"],
  "Архитекторы":["architekt","architektka","Architect","архитектор","архитектор"],
  "Бывшие силовики":["bývalý příslušník bezpečnostních složek","bývalá příslušnice bezpečnostních složek","Former security officer","бывший силовик","бывший силовик"],
  "Депутаты регионального парламента":["krajský poslanec","krajská poslankyně","Regional MP","депутат регионального парламента","депутат регионального парламента"],
  "Сотрудники правоохранительных органов":["policista","policistka","Law enforcement officer","сотрудник правоохранительных органов","сотрудница правоохранительных органов"],
  "Ветеринары":["veterinář","veterinářka","Veterinarian","ветеринар","ветеринар"],
  "Моряки":["námořník","námořnice","Sailor","моряк","моряк"],
  "Историки":["historik","historička","Historian","историк","историк"],
  "Фотограф":["fotograf","fotografka","Photographer","фотограф","фотограф"],
  "Писатели":["spisovatel","spisovatelka","Writer","писатель","писательница"],
  "Сотрудники МЧС":["záchranář","záchranářka","Emergency worker","сотрудник МЧС","сотрудница МЧС"],
  "Бармены":["barman","barmanka","Bartender","бармен","барменша"],
  "Муниципальные депутаты":["zastupitel","zastupitelka","Municipal deputy","муниципальный депутат","муниципальный депутат"],
  "Работа с волонтерами":["koordinátor dobrovolníků","koordinátorka dobrovolníků","Volunteer coordinator","координатор волонтёров","координатор волонтёров"],
  "Авиадиспетчеры":["letový dispečer","letová dispečerka","Air traffic controller","авиадиспетчер","авиадиспетчер"],
  "Психологи":["psycholog","psycholožka","Psychologist","психолог","психолог"],
};
const SKIP_OCC = new Set(["Неизвестно", "Другое"]);
function occupation(types, typesEn, g) {
  const cs = [], en = [], ru = [];
  (types || []).forEach((ty, i) => {
    if (!ty || SKIP_OCC.has(ty)) return;
    const o = OCC[ty];
    const f = g === "f";
    if (o) { cs.push(f ? o[1] : o[0]); en.push(o[2]); ru.push(f ? o[4] : o[3]); }
    else { cs.push(typesEn?.[i] || ty); en.push(typesEn?.[i] || ty); ru.push(ty.toLowerCase()); }
  });
  const j = a => a.slice(0, 2).join(", ");
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";
  return { p: cap(j(cs)), pe: j(en), pru: cap(j(ru)) };
}

// ---------- sentence ----------
const plCs = (n, one, few, many) => n === 1 ? one : n >= 2 && n <= 4 ? few : many;
const plRu = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; };
function sentence(months, verdicts) {
  if (months) {
    const y = Math.floor(months / 12), m = months % 12;
    const cs = [y && `${y} ${plCs(y, "rok", "roky", "let")}`, m && `${m} ${plCs(m, "měsíc", "měsíce", "měsíců")}`].filter(Boolean).join(" a ");
    const en = [y && `${y} ${y === 1 ? "year" : "years"}`, m && `${m} ${m === 1 ? "month" : "months"}`].filter(Boolean).join(" ");
    const ru = [y && `${y} ${plRu(y, "год", "года", "лет")}`, m && `${m} ${plRu(m, "месяц", "месяца", "месяцев")}`].filter(Boolean).join(" ");
    return { s: cs, se: en, sr: ru };
  }
  const v = (verdicts || []).join(" ");
  if (/Принудительное лечение/.test(v)) return { s: "Nucená psychiatrická léčba", se: "Compulsory psychiatric treatment", sr: "Принудительное лечение" };
  if (!v) return { s: "Ve vazbě", se: "In pre-trial detention", sr: "Под стражей" };
  return { s: "Trest neuveden", se: "Sentence not specified", sr: "Срок не указан" };
}

// ---------- short descriptions ----------
// First paragraph, cut at a sentence end to at most `max` characters
function short(text, max = 320) {
  let s = (text || "").split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.4 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}

export function normalize(x) {
  const g = x.gender === "Ж" ? "f" : x.gender === "М" ? "m" : "";
  const { last, first } = splitName(x.name);
  const nameEn = x.name_en && !isCyr(x.name_en) ? x.name_en : translitEn([first, last].filter(Boolean).join(" "));
  return {
    i: x.slug,
    n: translitCz([first, last].filter(Boolean).join(" ")),
    ne: nameEn,
    nr: [last, first].filter(Boolean).join(" "),
    a: x.age ?? null,
    g,
    ...occupation(x.activity_types, x.activity_types_en, g),
    ...sentence(x.sentence_months, x.verdict_types),
    d: "",
    de: short(x.story_en || x.summary_en),
    dr: short(x.personal_info || x.summary),
    int: [], ie: [],
    c: x.cities_en?.[0] || "",
    cc: cityCz(x.cities?.[0]),
    cr: x.cities?.[0] || "",
    ad: x.letter_address || "",
    ph: x.photos?.[0] || "",
    o: true,
    src: "ovd",
    u: x.updated_at || "",
  };
}

async function fetchAll(key) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ ...FILTER, limit: "1000" });
    if (cursor) q.set("cursor", cursor); else { q.set("sort", "updated_at"); q.set("order", "asc"); }
    const r = await fetch(`${API}?${q}`, {
      headers: { "X-API-Key": key, "Accept": "application/json", "User-Agent": "dopisy-nadeje/1.0 (+https://dopisyveznum.netlify.app; gulag.cz)" },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) throw new Error(`OVD-Info API ${r.status}`);
    const j = await r.json();
    rows.push(...(j.data || []));
    cursor = j.next_cursor;
    if (!cursor) break;
  }
  return rows;
}

export default async (req) => {
  const key = process.env.OVD_API_KEY;
  const json = (body, status, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!key) return json({ error: "Missing OVD_API_KEY" }, 500, { "Cache-Control": "no-store" });
  try {
    const rows = await fetchAll(key);
    const seen = new Set();
    const list = rows.filter(x => x.slug && !seen.has(x.slug) && seen.add(x.slug)).map(normalize);
    return json({ updated: new Date().toISOString(), source: "OVD-Info", count: list.length, prisoners: list }, 200, {
      "Cache-Control": "public, max-age=900",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=21600, stale-while-revalidate=172800",
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 502, { "Cache-Control": "no-store" });
  }
};
