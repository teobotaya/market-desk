import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;

/* SEC exige identificarse. Cambiá el mail si publicás esto con otro dueño. */
const UA = process.env.SEC_UA || "market-desk/1.0 (teobotaya@gmail.com)";

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
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/historical?assetclass=stocks&fromdate=${iso(from)}&todate=${iso(to)}&limit=9999`;
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9" } });
  if (!res.ok) throw new Error(String(res.status));
  const j = await res.json();
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

async function price(ticker) {
  const sym = ticker.trim().toUpperCase();
  const chain = [["Yahoo Finance", () => fromYahoo(sym)], ["Nasdaq", () => fromNasdaq(sym)], ["Stooq", () => fromStooq(sym.toLowerCase())]];
  const fails = [];
  for (const [source, fn] of chain) {
    try {
      const rows = (await fn()).slice(-500);
      return { ticker: sym, source, candles: rows, stats: stats(rows) };
    } catch (e) {
      fails.push(`${source}: ${String(e.message).slice(0, 90)}`);
    }
  }
  throw new Error(`Ninguna fuente devolvió la serie de ${sym}. ${fails.join(" · ")}`);
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

/* ---------------------------------------------------------------- routing */

const routes = {
  "/api/price": (u) => price(u.searchParams.get("t") || ""),
  "/api/risk": (u) => riskFactors(u.searchParams.get("t") || ""),
  "/api/news": (u) => news(u.searchParams.get("q") || "", Math.min(60, +(u.searchParams.get("days") || 14))),
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
  console.log("Fuentes sin clave: Yahoo Finance y Stooq (precios) · SEC EDGAR (10-K) · Google News RSS (noticias)");
});
