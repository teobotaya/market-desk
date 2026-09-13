import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;

/* SEC exige identificarse. Cambiá el mail si publicás esto con otro dueño. */
const UA = process.env.SEC_UA || "market-desk/1.0 (teobotaya@gmail.com)";


/* Lee las claves sin dependencias, de varios archivos posibles. Todos están
   cubiertos por el .gitignore, así que nunca llegan al repositorio.
   El de _privado/ existe porque macOS oculta los archivos que empiezan con
   punto y encontrarlos es una pelea innecesaria. */
const ARCHIVOS_CLAVES = [".env", "_privado/claves.txt", "_privado/EJEMPLO.env.txt", "claves.txt"];

for (const archivo of ARCHIVOS_CLAVES) {
  try {
    const raw = await fs.readFile(path.join(ROOT, archivo), "utf8");
    for (const linea of raw.split("\n")) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* archivo ausente: se prueba el siguiente */ }
}

/* Proveedor de análisis: el que tenga clave en el .env. Gemini tiene capa
   gratuita sin tarjeta; Anthropic se cobra por uso. Si hay las dos, manda
   la que se elija con IA_PROVEEDOR. */
const CLAVES = {
  gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
  anthropic: process.env.ANTHROPIC_API_KEY || ""
};
const PREFERIDO = (process.env.IA_PROVEEDOR || "").toLowerCase();
const PROVEEDOR = CLAVES[PREFERIDO] ? PREFERIDO : (CLAVES.gemini ? "gemini" : (CLAVES.anthropic ? "anthropic" : null));
let IA_MODELO = process.env.IA_MODELO || process.env.CLAUDE_MODEL || "";

const SISTEMA = "Sos un analista financiero escéptico. Trabajás solo con los datos que te dan y decís explícitamente cuándo algo es un supuesto tuyo. Nunca recomendás comprar ni vender, ni das asesoramiento financiero personalizado: describís riesgos, evidencia y escenarios para que la persona decida. Respondés en español rioplatense, sin relleno.";

/* No adivinamos identificadores de modelo: se los preguntamos a cada API. */
async function elegirModelo() {
  if (IA_MODELO) return IA_MODELO;
  if (PROVEEDOR === "gemini") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${CLAVES.gemini}`);
    if (!r.ok) throw new Error(`Google rechazó la consulta de modelos (${r.status}). Revisá GEMINI_API_KEY en el .env`);
    const j = await r.json();
    const aptos = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((m) => !/vision|embed|aqa|tuning/i.test(m));
    /* El listado incluye versiones viejas que la API ya rechaza para cuentas
       nuevas, así que ordenamos por número de versión y nos quedamos con la
       más alta: primero pro, si no flash. */
    const version = (m) => {
      const v = m.match(/gemini-(\d+)(?:\.(\d+))?/);
      return v ? Number(v[1]) * 100 + Number(v[2] || 0) : 0;
    };
    const porVersion = (a, b) => version(b) - version(a);
    const pros = aptos.filter((m) => /pro/i.test(m)).sort(porVersion);
    const flashes = aptos.filter((m) => /flash/i.test(m)).sort(porVersion);
    IA_MODELO = pros[0] || flashes[0] || aptos[0];
  } else {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=20", {
      headers: { "x-api-key": CLAVES.anthropic, "anthropic-version": "2023-06-01" }
    });
    if (!r.ok) throw new Error(`Anthropic rechazó la consulta de modelos (${r.status}). Revisá ANTHROPIC_API_KEY en el .env`);
    const j = await r.json();
    const ids = (j.data || []).map((m) => m.id);
    IA_MODELO = ids.find((i) => /sonnet/i.test(i)) || ids[0];
  }
  if (!IA_MODELO) throw new Error("la API no devolvió ningún modelo disponible");
  return IA_MODELO;
}

async function analizar(prompt) {
  if (!PROVEEDOR) {
    throw new Error("No hay ninguna clave en el .env. Poné GEMINI_API_KEY (capa gratuita de Google AI Studio) o ANTHROPIC_API_KEY. Sin clave la app funciona igual: copiás el prompt y lo usás donde quieras.");
  }
  const modelo = await elegirModelo();

  if (PROVEEDOR === "gemini") {
    return geminiLlamar(prompt, modelo, true);
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": CLAVES.anthropic, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: modelo, max_tokens: 2400, system: SISTEMA, messages: [{ role: "user", content: prompt }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `Anthropic respondió ${r.status}`);
  return { proveedor: "Claude", modelo, texto: (j.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n") };
}

/* Google a veces retira un modelo para cuentas nuevas y dice en el error cuál
   usar en su lugar. En vez de fallar, le hacemos caso una vez y recordamos. */
async function geminiLlamar(prompt, modelo, puedeReintentar) {
  {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${CLAVES.gemini}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SISTEMA }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2400, temperature: 0.4 }
      })
    });
    const j = await r.json();
    if (!r.ok) {
      const msg = j?.error?.message || `Google respondió ${r.status}`;
      const sugerido = msg.match(/models\/([a-z0-9.\-]+)/gi)?.map((x) => x.replace("models/", "")).find((x) => x !== modelo);
      if (puedeReintentar && sugerido) {
        IA_MODELO = sugerido;
        return geminiLlamar(prompt, sugerido, false);
      }
      throw new Error(msg);
    }
    const texto = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text).filter(Boolean).join("\n");
    if (!texto) throw new Error(`Google no devolvió texto (motivo: ${j.candidates?.[0]?.finishReason || "desconocido"})`);
    return { proveedor: "Gemini", modelo, texto };
  }
}

/* ------------------------------------------------------------ riesgo */

function perfilRiesgo(rows, bench) {
  const c = rows.map((r) => r.c);
  const ret = [];
  for (let i = 1; i < c.length; i++) ret.push(c[i] / c[i - 1] - 1);

  const orden = [...ret].sort((a, b) => a - b);
  const percentil = (p) => orden[Math.max(0, Math.floor(orden.length * p))] * 100;

  const anual = (arr) => {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(v * 252) * 100;
  };
  const bajistas = ret.filter((x) => x < 0);

  const ventana = (n) => {
    let peor = 0;
    for (let i = n; i < c.length; i++) peor = Math.min(peor, c[i] / c[i - n] - 1);
    return peor * 100;
  };

  let peak = -Infinity, dd = 0, iPeak = 0, iFondo = 0, recuperado = null;
  rows.forEach((r, i) => {
    if (r.c > peak) { peak = r.c; iPeak = i; }
    const d = r.c / peak - 1;
    if (d < dd) { dd = d; iFondo = i; }
  });
  for (let i = iFondo; i < rows.length; i++) if (rows[i].c >= rows[iPeak].c) { recuperado = i - iFondo; break; }

  let beta = null, correl = null, volBench = null;
  if (bench?.length) {
    const mapa = new Map(bench.map((r) => [r.d, r.c]));
    const pares = [];
    for (let i = 1; i < rows.length; i++) {
      const b1 = mapa.get(rows[i].d), b0 = mapa.get(rows[i - 1].d);
      if (b1 && b0) pares.push([rows[i].c / rows[i - 1].c - 1, b1 / b0 - 1]);
    }
    if (pares.length > 60) {
      const n = pares.length;
      const ma = pares.reduce((a, p) => a + p[0], 0) / n;
      const mb = pares.reduce((a, p) => a + p[1], 0) / n;
      let cov = 0, va = 0, vb = 0;
      for (const [a, b] of pares) { cov += (a - ma) * (b - mb); va += (a - ma) ** 2; vb += (b - mb) ** 2; }
      beta = cov / (vb || 1e-12);
      correl = cov / (Math.sqrt(va * vb) || 1e-12);
      volBench = anual(pares.map((p) => p[1]));
    }
  }

  const big = (u) => (ret.filter((x) => Math.abs(x) > u).length / ret.length) * 100;

  /* Frecuencia histórica por ventana de tenencia. NO es probabilidad futura:
     es con qué frecuencia, en este período, mantener N ruedas terminó en verde. */
  const ventanas = [5, 10, 21, 63].map((n) => {
    const res = [];
    for (let i = n; i < c.length; i++) res.push((c[i] / c[i - n] - 1) * 100);
    if (res.length < 20) return { dias: n, muestras: res.length };
    const ord = [...res].sort((a, b) => a - b);
    const pc = (p) => ord[Math.floor(ord.length * p)];
    const ganan = res.filter((x) => x > 0);
    const pierden = res.filter((x) => x <= 0);
    const pGana = (ganan.length / res.length) * 100;
    const mediaGana = ganan.length ? ganan.reduce((a, b) => a + b, 0) / ganan.length : 0;
    const mediaPierde = pierden.length ? pierden.reduce((a, b) => a + b, 0) / pierden.length : 0;
    return {
      dias: n,
      muestras: res.length,
      pctPositivas: pGana,
      mediana: pc(0.5),
      media: res.reduce((a, b) => a + b, 0) / res.length,
      p10: pc(0.1),
      p90: pc(0.9),
      peor: ord[0],
      mejor: ord[ord.length - 1],
      mediaGana,
      mediaPierde,
      expectativa: (pGana / 100) * mediaGana + (1 - pGana / 100) * mediaPierde,
      asimetria: mediaPierde ? Math.abs(mediaGana / mediaPierde) : null
    };
  });

  return {
    ventanas,
    ruedas: ret.length,
    volAnual: anual(ret),
    volBench,
    volRelativa: volBench ? anual(ret) / volBench : null,
    desvBajista: bajistas.length > 5 ? anual(bajistas) : null,
    var95: percentil(0.05),
    var99: percentil(0.01),
    peorDia: Math.min(...ret) * 100,
    mejorDia: Math.max(...ret) * 100,
    peorSemana: ventana(5),
    peorMes: ventana(21),
    diasMas3: big(0.03),
    diasMas5: big(0.05),
    maxDrawdown: dd * 100,
    ruedasHastaRecuperar: recuperado,
    beta,
    correl
  };
}


const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

/* Node no descomprime si uno fija Accept-Encoding a mano: no lo fijamos.
   La SEC exige un User-Agent con contacto; el resto de las fuentes rechazan
   agentes que no parezcan un navegador. */
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

async function get(url, { text = true, limit = 12_000_000 } = {}) {
  const agent = /\.sec\.gov/.test(url) ? UA : BROWSER_UA;
  const res = await fetch(url, { headers: { "User-Agent": agent, "Accept": "*/*" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} al pedir ${url}`);
  if (!text) return res;
  const body = await res.text();
  return body.length > limit ? body.slice(0, limit) : body;
}

/* ---------------------------------------------------------------- precio */

function parseStooq(csv) {
  const lines = csv.trim().split("\n");
  if (lines.length < 3 || !/^Date,/i.test(lines[0])) {
    throw new Error(`Stooq no devolvió una serie válida. Respondió: ${csv.slice(0, 160).replace(/\s+/g, " ")}`);
  }
  return lines.slice(1).map((l) => {
    const [d, o, h, lo, c, v] = l.split(",");
    return { d, o: +o, h: +h, l: +lo, c: +c, v: +v };
  }).filter((r) => Number.isFinite(r.c));
}

const pct = (a, b) => (b ? (a / b - 1) * 100 : null);

function stats(rows) {
  const n = rows.length;
  const close = rows.map((r) => r.c);
  const last = close[n - 1];
  const at = (back) => (n > back ? close[n - 1 - back] : null);

  const logret = [];
  for (let i = 1; i < n; i++) logret.push(Math.log(close[i] / close[i - 1]));
  const vol = (win) => {
    const s = logret.slice(-win);
    if (s.length < 5) return null;
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    const v = s.reduce((a, b) => a + (b - m) ** 2, 0) / (s.length - 1);
    return Math.sqrt(v * 252) * 100;
  };

  const sma = (win) => (n >= win ? close.slice(-win).reduce((a, b) => a + b, 0) / win : null);

  let tr = [];
  for (let i = Math.max(1, n - 14); i < n; i++) {
    tr.push(Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c)));
  }
  const atr = tr.length ? tr.reduce((a, b) => a + b, 0) / tr.length : null;

  const yr = rows.slice(-252);
  const hi = Math.max(...yr.map((r) => r.h));
  const lo = Math.min(...yr.map((r) => r.l));
  let peak = -Infinity, dd = 0;
  for (const r of yr) { peak = Math.max(peak, r.c); dd = Math.min(dd, r.c / peak - 1); }

  const vols = rows.slice(-21).map((r) => r.v).filter(Number.isFinite);
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;

  return {
    last, date: rows[n - 1].d,
    ret1: pct(last, at(1)), ret5: pct(last, at(5)), ret21: pct(last, at(21)),
    ret63: pct(last, at(63)), ret252: pct(last, at(252)),
    vol21: vol(21), vol63: vol(63),
    sma20: sma(20), sma50: sma(50), sma200: sma(200),
    atr14: atr, atrPct: atr ? (atr / last) * 100 : null,
    high52: hi, low52: lo,
    fromHigh: pct(last, hi), fromLow: pct(last, lo),
    maxDrawdown: dd * 100,
    avgVol21: avgVol,
    relVol: avgVol ? rows[n - 1].v / avgVol : null
  };
}

/* Las fuentes gratuitas de precios bloquean peticiones sin cookies: Yahoo
   responde 429 y Stooq devuelve un desafío de JavaScript. Por eso hay tres
   fuentes en cadena y Yahoo arranca pidiendo cookies como haría un navegador. */

let yahooCookie = null;

async function yahooCookies() {
  if (yahooCookie) return yahooCookie;
  try {
    const r = await fetch("https://finance.yahoo.com/", {
      headers: { "User-Agent": BROWSER_UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" }
    });
    const raw = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")].filter(Boolean);
    yahooCookie = raw.map((c) => String(c).split(";")[0]).join("; ");
  } catch { yahooCookie = ""; }
  return yahooCookie;
}

async function fromYahoo(sym) {
  const cookie = await yahooCookies();
  const headers = {
    "User-Agent": BROWSER_UA,
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `https://finance.yahoo.com/quote/${sym}`,
    ...(cookie ? { Cookie: cookie } : {})
  };
  let last = "";
  for (const host of ["query2", "query1"]) {
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) { last = `${host}: ${res.status}`; continue; }
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r?.timestamp?.length) { last = `${host}: ${j?.chart?.error?.description || "sin serie"}`; continue; }
      const q = r.indicators.quote[0];
      const rows = r.timestamp.map((t, i) => ({
        d: new Date(t * 1000).toISOString().slice(0, 10),
        o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i]
      })).filter((x) => Number.isFinite(x.c) && Number.isFinite(x.h) && Number.isFinite(x.l));
      if (rows.length >= 30) return rows;
      last = `${host}: serie de ${rows.length} ruedas`;
    } catch (e) { last = `${host}: ${e.message}`; }
  }
  yahooCookie = null;
  throw new Error(last || "sin respuesta");
}

const money = (v) => Number(String(v).replace(/[$,]/g, ""));

async function fromNasdaq(sym) {
  const to = new Date(), from = new Date(Date.now() - 730 * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10);
  let j = null, last = "";
  for (const clase of ["stocks", "etf", "index"]) {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/historical?assetclass=${clase}&fromdate=${iso(from)}&todate=${iso(to)}&limit=9999`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9" } });
      if (!res.ok) { last = `${clase}: ${res.status}`; continue; }
      const body = await res.json();
      if (body?.data?.tradesTable?.rows?.length) { j = body; break; }
      last = `${clase}: ${body?.status?.bCodeMessage?.[0]?.errorMessage || "sin filas"}`;
    } catch (e) { last = `${clase}: ${e.message}`; }
  }
  if (!j) throw new Error(last || "sin datos");
  const rows = (j?.data?.tradesTable?.rows || []).map((r) => {
    const [m, d, y] = r.date.split("/");
    return { d: `${y}-${m}-${d}`, o: money(r.open), h: money(r.high), l: money(r.low), c: money(r.close), v: money(r.volume) };
  }).filter((x) => Number.isFinite(x.c) && Number.isFinite(x.h)).reverse();
  if (rows.length < 30) throw new Error(`serie de ${rows.length} ruedas`);
  return rows;
}

async function fromStooq(sym) {
  let last = "";
  for (const host of ["stooq.com", "stooq.pl"]) {
    try { return parseStooq(await get(`https://${host}/q/d/l/?s=${encodeURIComponent(sym)}.us&i=d`)); }
    catch (e) { last = e.message; }
  }
  throw new Error(last);
}

/* Los índices no se sirven como serie diaria en estas fuentes gratuitas.
   Se sustituyen por el ETF que los replica y se avisa en la respuesta. */
const ALIAS = {
  "SP500": "SPY", "S&P500": "SPY", "SP-500": "SPY", "SPX": "SPY", "^GSPC": "SPY", "SEP500": "SPY", "ES": "SPY",
  "NASDAQ100": "QQQ", "NDX": "QQQ", "^NDX": "QQQ", "NQ": "QQQ",
  "DOW": "DIA", "DJI": "DIA", "^DJI": "DIA",
  "RUSSELL2000": "IWM", "RUT": "IWM", "^RUT": "IWM",
  "SOX": "SOXX", "^SOX": "SOXX"
};
const NOMBRE = { SPY: "S&P 500", QQQ: "Nasdaq 100", DIA: "Dow Jones", IWM: "Russell 2000", SOXX: "índice de semiconductores" };

/* "S&P 500", "s&p500", "S y P 500" y "SP 500" son la misma cosa escrita de
   seis maneras. Normalizamos antes de buscar el alias. */
function normalizar(txt) {
  const crudo = txt.trim().toUpperCase();
  const limpio = crudo
    .replace(/\s+Y\s+/g, "")
    .replace(/[&\s.\-_]/g, "")
    .replace(/^SANDP/, "SP");
  return { crudo, limpio };
}

async function price(ticker) {
  const { crudo, limpio } = normalizar(ticker);
  const pedido = crudo;
  const sym = ALIAS[limpio] || ALIAS[crudo] || (/^[A-Z.^-]{1,6}$/.test(crudo) ? crudo : limpio);
  const note = sym !== pedido ? `${pedido} no cotiza como serie diaria en las fuentes gratuitas: se usa el ETF ${sym}, que replica el ${NOMBRE[sym] || pedido}.` : null;
  const chain = [["Yahoo Finance", () => fromYahoo(sym)], ["Nasdaq", () => fromNasdaq(sym)], ["Stooq", () => fromStooq(sym.toLowerCase())]];
  const fails = [];
  for (const [source, fn] of chain) {
    try {
      const rows = (await fn()).slice(-500);
      return { ticker: sym, requested: pedido, note, source, candles: rows, stats: stats(rows) };
    } catch (e) {
      fails.push(`${source}: ${String(e.message).slice(0, 90)}`);
    }
  }
  throw new Error(`Ninguna fuente devolvió la serie de ${pedido}${sym !== pedido ? ` (probé ${sym})` : ""}. ${fails.join(" · ")}`);
}

/* ------------------------------------------------------------------- SEC */

async function tickerMap() {
  return cached("sec:tickers", 24 * 3600e3, async () => {
    const json = JSON.parse(await get("https://www.sec.gov/files/company_tickers.json"));
    const map = new Map();
    for (const k of Object.keys(json)) {
      const e = json[k];
      map.set(String(e.ticker).toUpperCase(), { cik: String(e.cik_str).padStart(10, "0"), name: e.title });
    }
    return map;
  });
}

const strip = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<br[^>]*>/gi, "\n")
  .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/[ \t ]+/g, " ")
  .replace(/\n{3,}/g, "\n\n");

/* Boilerplate que aparece en casi todos los 10-K del mercado. */
const GENERIC = [
  "general economic", "market volatility", "stock price may", "our stock price", "interest rate",
  "inflation", "natural disaster", "pandemic", "act of war", "terrorism", "litigation",
  "cybersecurity", "cyber-attack", "attract and retain", "key personnel", "intellectual property rights of others",
  "regulatory", "tax law", "accounting standards", "internal control over financial reporting",
  "forward-looking statements", "goodwill impairment", "foreign currency"
];

/* Señales de riesgo realmente específico de la empresa. */
const SPECIFIC = [
  /\b\d{1,3}(\.\d)?%\s+of\s+(our\s+)?(total\s+)?(revenue|net revenue|net sales|sales)/i,
  /\bone customer\b|\ba single customer\b|\btwo customers\b|\bthree customers\b/i,
  /\bsole source\b|\bsingle source\b|\bsole supplier\b|\bsingle supplier\b/i,
  /\bconcentrat(ion|ed)\b/i,
  /\bTaiwan\b|\bChina\b|\bexport control|\bentity list\b|\bsanction/i,
  /\bfoundry\b|\bfabrication\b|\bwafer\b|\bcapacity constraint|\bsupply agreement\b/i,
  /\bour largest\b|\bour top\b|\bdepend(ent|ence) on\b/i
];

function classifyRisks(text) {
  const paras = text.split(/\n{2,}|(?<=\.)\s{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 200 && p.length < 6000);
  return paras.slice(0, 120).map((p) => {
    const low = p.toLowerCase();
    const generic = GENERIC.filter((g) => low.includes(g));
    const signals = SPECIFIC.filter((re) => re.test(p)).length;
    const heading = (p.match(/^([^.]{15,140}\.)/) || [null, p.slice(0, 120)])[1];
    return {
      heading: heading.trim(),
      text: p,
      kind: signals >= 1 ? "especifico" : generic.length >= 2 ? "generico" : "mixto",
      signals,
      genericHits: generic.slice(0, 4)
    };
  });
}

async function riskFactors(ticker) {
  const map = await tickerMap();
  const co = map.get(ticker.toUpperCase());
  if (!co) throw new Error(`${ticker} no figura en el índice de la SEC (¿es una empresa que cotiza en EE.UU.?)`);

  const sub = JSON.parse(await get(`https://data.sec.gov/submissions/CIK${co.cik}.json`));
  const r = sub.filings.recent;
  let idx = -1;
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === "10-K" || r.form[i] === "20-F") { idx = i; break; }
  }
  if (idx < 0) throw new Error(`No encontré un 10-K reciente para ${ticker}`);

  const accn = r.accessionNumber[idx].replace(/-/g, "");
  const doc = r.primaryDocument[idx];
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(co.cik)}/${accn}/${doc}`;
  const text = strip(await get(url));

  /* El índice del 10-K también dice "Item 1A ... Item 1B", así que el primer
     match casi siempre es esa línea. Nos quedamos con el fragmento más largo. */
  const patrones = [
    /item\s*1A[.\s—–-]*risk\s*factors([\s\S]*?)item\s*1B[.\s—–-]*unresolved/gi,
    /item\s*1A[.\s—–-]*risk\s*factors([\s\S]*?)item\s*1B[.\s—–-]/gi,
    /item\s*1A[.\s—–-]*risk\s*factors([\s\S]*?)item\s*2[.\s—–-]*propert/gi,
    /risk\s*factors([\s\S]*?)unresolved\s*staff\s*comments/gi
  ];
  let section = "";
  for (const re of patrones) {
    for (const m of text.matchAll(re)) if (m[1].length > section.length) section = m[1];
  }
  if (section.length < 3000) {
    throw new Error(`Encontré el 10-K pero la sección Item 1A quedó en ${section.length} caracteres. Abrilo a mano: ${url}`);
  }
  return {
    company: co.name,
    cik: co.cik,
    form: r.form[idx],
    filed: r.filingDate[idx],
    period: r.reportDate[idx],
    url,
    chars: section.length,
    risks: classifyRisks(section)
  };
}

/* --------------------------------------------------------------- noticias */

const POS = "beat beats upgrade upgraded record surge rally jumps soars strong growth outperform raises raised bullish demand expansion partnership wins approval breakthrough optimistic momentum".split(" ");
const NEG = "miss misses downgrade downgraded cuts cut plunge slump falls sinks weak warning lawsuit probe investigation recall delay shortage layoffs bearish loss decline halt ban restriction tariff".split(" ");

function scoreHeadline(t) {
  const w = t.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/);
  let s = 0;
  for (const x of w) { if (POS.includes(x)) s++; if (NEG.includes(x)) s--; }
  return s;
}

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const b = m[1];
    const pick = (tag) => {
      const r = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return r ? r[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() : "";
    };
    const title = pick("title");
    return { title, link: pick("link"), source: pick("source"), date: pick("pubDate"), score: scoreHeadline(title) };
  });
}

async function news(query, days) {
  const q = encodeURIComponent(`${query} when:${days}d`);
  const xml = await get(`https://news.google.com/rss/search?q=${q}&hl=es-419&gl=AR&ceid=AR:es-419`);
  const items = parseRss(xml).slice(0, 60);
  const pos = items.filter((i) => i.score > 0).length;
  const neg = items.filter((i) => i.score < 0).length;
  const byDay = new Map();
  for (const i of items) {
    const d = new Date(i.date);
    if (isNaN(d)) continue;
    const key = d.toISOString().slice(0, 10);
    const e = byDay.get(key) || { day: key, n: 0, score: 0 };
    e.n++; e.score += i.score;
    byDay.set(key, e);
  }
  return {
    query, days, items,
    summary: { total: items.length, pos, neg, neutral: items.length - pos - neg, net: pos - neg },
    timeline: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
  };
}


/* --------------------------------------------------- fundamentales (XBRL) */

/* La SEC publica los estados financieros etiquetados. Un mismo concepto
   aparece con distintas etiquetas según la empresa y el año, así que cada
   métrica lleva su lista de alternativas en orden de preferencia. */
const TAGS = {
  ingresos: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  costoVentas: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
  brutoDirecto: ["GrossProfit"],
  operativo: ["OperatingIncomeLoss"],
  neto: ["NetIncomeLoss", "ProfitLoss"],
  id: ["ResearchAndDevelopmentExpense"],
  cfo: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  amortizacion: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"],
  activos: ["Assets"],
  patrimonio: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  caja: ["CashAndCashEquivalentsAtCarryingValue"],
  inversionesCorto: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"],
  deudaLargo: ["LongTermDebtNoncurrent", "LongTermDebt"],
  deudaCorto: ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"],
  intereses: ["InterestExpense", "InterestExpenseDebt", "InterestIncomeExpenseNet"],
  acciones: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  impuestos: ["IncomeTaxExpenseBenefit"],
  antesImpuestos: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"]
};

/* Devuelve { fy: valor } combinando TODAS las etiquetas candidatas: las
   empresas cambian de etiqueta entre ejercicios, y quedarse con la primera
   que aparezca deja la serie llena de huecos. Para cada año gana la etiqueta
   más preferida que lo reporte. */
function serieAnual(facts, nombres) {
  const porAnio = new Map(), filed = {};
  for (let i = nombres.length - 1; i >= 0; i--) {
    const f = facts?.[nombres[i]];
    const u = f?.units?.USD || f?.units?.shares;
    if (!u) continue;
    for (const d of u) {
      if (d.fp !== "FY" || !d.fy || d.val === undefined) continue;
      if (d.form !== "10-K" && d.form !== "10-K/A") continue;
      const dur = d.start && d.end ? (new Date(d.end) - new Date(d.start)) / 864e5 : null;
      if (dur !== null && (dur < 300 || dur > 400)) continue;
      const prev = porAnio.get(d.fy);
      if (!prev || new Date(d.filed) >= new Date(prev.filed)) porAnio.set(d.fy, d);
    }
  }
  if (porAnio.size < 2) return {};
  const orden = [...porAnio.entries()].sort((x, y) => x[0] - y[0]);
  const salida = Object.fromEntries(orden.map(([fy, d]) => [fy, d.val]));
  orden.forEach(([fy, d]) => { filed[fy] = d.filed; });
  Object.defineProperty(salida, "_filed", { value: filed, enumerable: false });
  return salida;
}

async function fundamentales(ticker) {
  const map = await tickerMap();
  const { crudo } = normalizar(ticker);
  const co = map.get(crudo);
  if (!co) throw new Error(`${ticker} no figura en el índice de la SEC`);

  const facts = await cached(`xbrl:${co.cik}`, 6 * 3600e3, async () => {
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${co.cik}.json`, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error(`la SEC respondió ${r.status} al pedir los estados financieros`);
    const j = await r.json();
    return j.facts?.["us-gaap"] || {};
  });

  const S = {};
  for (const k of Object.keys(TAGS)) S[k] = serieAnual(facts, TAGS[k]);

  const anios = [...new Set(Object.values(S).flatMap((x) => Object.keys(x)))].map(Number).sort((a, b) => a - b).slice(-6);
  if (anios.length < 2) throw new Error(`No pude leer suficientes años de estados financieros de ${crudo}`);

  const v = (k, fy) => (S[k]?.[fy] === undefined ? null : S[k][fy]);
  const div = (a, b) => (a !== null && b ? a / b : null);

  const filas = anios.map((fy, i) => {
    const ing = v("ingresos", fy);
    const bruto = v("brutoDirecto", fy) ?? (ing !== null && v("costoVentas", fy) !== null ? ing - v("costoVentas", fy) : null);
    const op = v("operativo", fy);
    const neto = v("neto", fy);
    const cfo = v("cfo", fy);
    const capex = v("capex", fy);
    const fcf = cfo !== null && capex !== null ? cfo - capex : null;
    const patrimonio = v("patrimonio", fy);
    const deuda = (v("deudaLargo", fy) || 0) + (v("deudaCorto", fy) || 0);
    const cajaTotal = (v("caja", fy) || 0) + (v("inversionesCorto", fy) || 0);
    const impuesto = div(v("impuestos", fy), v("antesImpuestos", fy));
    const tasa = impuesto !== null && impuesto > 0 && impuesto < 0.5 ? impuesto : 0.21;
    const capitalInvertido = patrimonio !== null ? patrimonio + deuda - cajaTotal : null;
    const ingPrev = i > 0 ? v("ingresos", anios[i - 1]) : null;
    const ebitda = op !== null ? op + (v("amortizacion", fy) || 0) : null;

    return {
      fy,
      ingresos: ing,
      crecimiento: ing !== null && ingPrev ? (ing / ingPrev - 1) * 100 : null,
      margenBruto: div(bruto, ing) === null ? null : div(bruto, ing) * 100,
      margenOperativo: div(op, ing) === null ? null : div(op, ing) * 100,
      margenNeto: div(neto, ing) === null ? null : div(neto, ing) * 100,
      idSobreVentas: div(v("id", fy), ing) === null ? null : div(v("id", fy), ing) * 100,
      fcf,
      margenFcf: div(fcf, ing) === null ? null : div(fcf, ing) * 100,
      conversion: div(fcf, neto) === null ? null : div(fcf, neto) * 100,
      roe: div(neto, patrimonio) === null ? null : div(neto, patrimonio) * 100,
      roic: op !== null && capitalInvertido ? ((op * (1 - tasa)) / capitalInvertido) * 100 : null,
      deudaNeta: patrimonio !== null ? deuda - cajaTotal : null,
      deudaNetaEbitda: ebitda && ebitda > 0 ? (deuda - cajaTotal) / ebitda : null,
      cobertura: v("intereses", fy) ? Math.abs(op / v("intereses", fy)) : null,
      acciones: v("acciones", fy),
      neto, patrimonio, ebitda
    };
  });

  /* Valuación: hace falta el precio, que viene de la cadena de fuentes. */
  let valuacion = null;
  try {
    const px = await price(crudo);
    const ult = filas[filas.length - 1];
    const capitalizacion = ult.acciones ? px.stats.last * ult.acciones : null;
    if (capitalizacion) {
      const ev = capitalizacion + (ult.deudaNeta || 0);
      valuacion = {
        precio: px.stats.last,
        fecha: px.stats.date,
        capitalizacion,
        per: ult.neto > 0 ? capitalizacion / ult.neto : null,
        precioVentas: ult.ingresos ? capitalizacion / ult.ingresos : null,
        evEbitda: ult.ebitda > 0 ? ev / ult.ebitda : null,
        rentabilidadFcf: ult.fcf ? (ult.fcf / capitalizacion) * 100 : null,
        ejercicio: ult.fy
      };
    }
  } catch { /* sin precio no hay valuación, el resto sigue sirviendo */ }

  const dilucion = filas.length > 1 && filas[0].acciones && filas[filas.length - 1].acciones
    ? ((filas[filas.length - 1].acciones / filas[0].acciones) ** (1 / (filas.length - 1)) - 1) * 100
    : null;

  return { ticker: crudo, empresa: co.name, cik: co.cik, filas, valuacion, dilucionAnual: dilucion };
}


/* ------------------------------------------------------------------- PER */

/* Un PER aislado no dice nada. Estos tres juntos sí: el de hoy, el rango en
   el que la propia empresa cotizó, y el de sus pares. */

async function datosPer(ticker) {
  const map = await tickerMap();
  const { crudo } = normalizar(ticker);
  const co = map.get(crudo);
  if (!co) throw new Error(`${crudo} no figura en el índice de la SEC`);

  const facts = await cached(`xbrl:${co.cik}`, 6 * 3600e3, async () => {
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${co.cik}.json`, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error(`la SEC respondió ${r.status}`);
    return (await r.json()).facts?.["us-gaap"] || {};
  });

  const neto = serieAnual(facts, TAGS.neto);
  const acciones = serieAnual(facts, TAGS.acciones);
  const filed = neto._filed || {};

  /* Beneficio por acción de cada ejercicio, con la fecha desde la cual ese
     dato ya era público. Antes de esa fecha nadie podía conocerlo. */
  const hitos = Object.keys(neto)
    .map(Number)
    .filter((fy) => acciones[fy] && neto[fy] > 0)
    .sort((a, b) => a - b)
    .map((fy) => ({ fy, eps: neto[fy] / acciones[fy], desde: filed[fy] || `${fy}-12-31` }));

  if (!hitos.length) throw new Error(`${crudo} no reporta beneficio positivo en los ejercicios disponibles`);
  return { co, hitos };
}

async function perCompleto(ticker, paresTxt) {
  const { co, hitos } = await datosPer(ticker);
  const px = await price(ticker);

  /* PER de cada rueda, usando el beneficio que ya estaba publicado ese día. */
  const serie = [];
  for (const vela of px.candles) {
    let h = null;
    for (const x of hitos) if (x.desde <= vela.d) h = x;
    if (h && h.eps > 0) serie.push({ d: vela.d, per: vela.c / h.eps });
  }
  if (serie.length < 30) throw new Error(`No pude reconstruir suficiente historia de PER para ${px.ticker}`);

  const valores = serie.map((x) => x.per).sort((a, b) => a - b);
  const pc = (p) => valores[Math.floor(valores.length * p)];
  const actual = serie[serie.length - 1].per;
  const percentil = (valores.filter((v) => v <= actual).length / valores.length) * 100;

  /* Pares: el usuario elige quiénes son. Un "PER del sector" sin saber con
     quién se compara es un número sin dueño. */
  const pares = [];
  for (const nombre of (paresTxt || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 6)) {
    try {
      const d = await datosPer(nombre);
      const p = await price(nombre);
      const ult = d.hitos[d.hitos.length - 1];
      pares.push({ ticker: p.ticker, empresa: d.co.name, per: p.stats.last / ult.eps, ejercicio: ult.fy });
    } catch (e) {
      pares.push({ ticker: nombre.toUpperCase(), error: String(e.message).slice(0, 80) });
    }
  }
  const validos = pares.filter((x) => x.per > 0).map((x) => x.per).sort((a, b) => a - b);
  const medianaPares = validos.length ? validos[Math.floor(validos.length / 2)] : null;

  return {
    ticker: px.ticker,
    empresa: co.name,
    precio: px.stats.last,
    fecha: px.stats.date,
    ejercicio: hitos[hitos.length - 1].fy,
    eps: hitos[hitos.length - 1].eps,
    actual,
    historico: {
      desde: serie[0].d, hasta: serie[serie.length - 1].d, ruedas: serie.length,
      min: valores[0], p25: pc(0.25), mediana: pc(0.5), p75: pc(0.75), max: valores[valores.length - 1],
      percentilActual: percentil,
      serie: serie.filter((_, i) => i % Math.max(1, Math.floor(serie.length / 160)) === 0)
    },
    pares,
    medianaPares,
    vsPares: medianaPares ? (actual / medianaPares - 1) * 100 : null,
    vsPropioMediana: (actual / pc(0.5) - 1) * 100
  };
}

/* ---------------------------------------------------------------- routing */

const routes = {
  "/api/price": (u) => price(u.searchParams.get("t") || ""),
  "/api/risk": (u) => riskFactors(u.searchParams.get("t") || ""),
  "/api/news": (u) => news(u.searchParams.get("q") || "", Math.min(60, +(u.searchParams.get("days") || 14))),
  "/api/estado": async () => ({ ia: Boolean(PROVEEDOR), proveedor: PROVEEDOR, modelo: IA_MODELO || null }),
  "/api/per": (u) => perCompleto(u.searchParams.get("t") || "", u.searchParams.get("pares") || ""),
  "/api/fundamentales": (u) => fundamentales(u.searchParams.get("t") || ""),
  "/api/riesgo": async (u) => {
    const t = u.searchParams.get("t") || "";
    const b = u.searchParams.get("b") || "SPY";
    const activo = await price(t);
    let bench = null;
    try { bench = await price(b); } catch { /* seguimos sin referencia */ }
    return {
      ticker: activo.ticker,
      benchmark: bench ? bench.ticker : null,
      desde: activo.candles[0].d,
      hasta: activo.candles[activo.candles.length - 1].d,
      perfil: perfilRiesgo(activo.candles, bench?.candles)
    };
  },
  "/api/compare": async (u) => ({
    a: await price(u.searchParams.get("a") || ""),
    b: await price(u.searchParams.get("b") || "")
  })
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body, type = "application/json; charset=utf-8") => {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  };

  if (req.method === "POST" && url.pathname === "/api/analizar") {
    let cuerpo = "";
    req.on("data", (c) => { cuerpo += c; if (cuerpo.length > 400_000) req.destroy(); });
    req.on("end", async () => {
      try {
        const { prompt } = JSON.parse(cuerpo || "{}");
        if (!prompt || prompt.length < 20) return send(400, JSON.stringify({ error: "prompt vacío" }));
        send(200, JSON.stringify(await analizar(prompt)));
      } catch (e) {
        send(502, JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
  }

  if (routes[url.pathname]) {
    try {
      send(200, JSON.stringify(await routes[url.pathname](url)));
    } catch (e) {
      send(502, JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }

  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const file = path.join(ROOT, "public", rel);
  if (!file.startsWith(path.join(ROOT, "public"))) return send(403, "prohibido", "text/plain");
  try {
    send(200, await fs.readFile(file), MIME[path.extname(file)] || "application/octet-stream");
  } catch {
    send(404, "no encontrado", "text/plain");
  }
});

server.listen(PORT, () => {
  console.log(`Market Desk en http://localhost:${PORT}`);
  console.log(PROVEEDOR ? `Análisis automático: activado con ${PROVEEDOR} (clave leída del .env local)` : "Análisis automático: desactivado — poné GEMINI_API_KEY o ANTHROPIC_API_KEY en .env, o copiá los dossieres a mano");
  console.log("Fuentes sin clave: Yahoo Finance y Stooq (precios) · SEC EDGAR (10-K) · Google News RSS (noticias)");
});
