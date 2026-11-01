import { BROWSER_UA, cached, getJSON, getText, HttpError } from "./http.mjs";
import { stats } from "./indicadores.mjs";

/* ------------------------------------------------------- resolver tickers */

/* Índices: Yahoo los sirve como serie diaria. Si Yahoo falla, se cae al ETF
   que los replica (Nasdaq y Stooq no publican índices) y se avisa. */
const INDICES = {
  SP500: { y: "^GSPC", etf: "SPY", nombre: "S&P 500" },
  SPX: { y: "^GSPC", etf: "SPY", nombre: "S&P 500" },
  GSPC: { y: "^GSPC", etf: "SPY", nombre: "S&P 500" },
  NASDAQ100: { y: "^NDX", etf: "QQQ", nombre: "Nasdaq 100" },
  NDX: { y: "^NDX", etf: "QQQ", nombre: "Nasdaq 100" },
  NASDAQ: { y: "^IXIC", etf: "QQQ", nombre: "Nasdaq Composite" },
  IXIC: { y: "^IXIC", etf: "QQQ", nombre: "Nasdaq Composite" },
  DJI: { y: "^DJI", etf: "DIA", nombre: "Dow Jones" },
  DOWJONES: { y: "^DJI", etf: "DIA", nombre: "Dow Jones" },
  RUSSELL2000: { y: "^RUT", etf: "IWM", nombre: "Russell 2000" },
  RUT: { y: "^RUT", etf: "IWM", nombre: "Russell 2000" },
  SOX: { y: "^SOX", etf: "SOXX", nombre: "índice de semiconductores" },
  VIX: { y: "^VIX", nombre: "VIX" },
  MERVAL: { y: "^MERV", nombre: "S&P Merval" },
  MERV: { y: "^MERV", nombre: "S&P Merval" },
  BOVESPA: { y: "^BVSP", nombre: "Bovespa" },
  IBOV: { y: "^BVSP", nombre: "Bovespa" },
  BVSP: { y: "^BVSP", nombre: "Bovespa" }
};

/* "S&P 500", "s&p500", "S y P 500" y "SP 500" son la misma cosa escrita de
   seis maneras. Normalizamos antes de buscar el alias. */
export function normalizar(txt) {
  const crudo = String(txt || "").trim().toUpperCase();
  const limpio = crudo
    .replace(/^\^/, "")
    .replace(/\s+Y\s+/g, "")
    .replace(/[&\s.\-_]/g, "")
    .replace(/^SANDP/, "SP");
  return { crudo, limpio };
}

export function resolver(entrada) {
  let { crudo, limpio } = normalizar(entrada);
  if (!crudo) throw new HttpError("Escribí un ticker", 400);
  /* "BCBA:GGAL" es la forma de TradingView para BYMA. */
  if (/^BCBA:/.test(crudo)) crudo = `${crudo.slice(5)}.BA`;
  crudo = crudo.replace(/\s+/g, "");

  const idx = INDICES[limpio];
  if (idx) return { pedido: crudo, tipo: "indice", yahoo: idx.y, etf: idx.etf, nombre: idx.nombre };
  if (!/^[A-Z0-9.^=\-]{1,15}$/.test(crudo)) throw new HttpError(`"${entrada}" no parece un ticker válido`, 400);
  if (/\.BA$/.test(crudo)) return { pedido: crudo, tipo: "ar", yahoo: crudo, local: crudo.replace(/\.BA$/, "") };
  /* Índices (^), monedas (=X), futuros (=F), cripto (-USD) y acciones de otras
     bolsas con sufijo de Yahoo (VALE3.SA, DX-Y.NYB, SAP.DE). */
  if (/^\^|=|-USDT?$|\.[A-Z]{2,4}$/.test(crudo)) return { pedido: crudo, tipo: "global", yahoo: crudo };
  /* Clases de acciones: Yahoo usa BRK-B, la SEC y Nasdaq BRK.B. */
  return { pedido: crudo, tipo: "us", yahoo: crudo.replace(/\.([A-Z])$/, "-$1"), us: crudo };
}

/* -------------------------------------------------------------- Yahoo */

/* Yahoo responde 429 a pedidos sin cookies. La cookie se obtiene como haría
   un navegador; el "crumb" (un token atado a la cookie) solo hace falta para
   los módulos de estimaciones y consenso. */
let yahooSesion = null;

async function yahooCookie(forzar = false) {
  if (yahooSesion && !forzar) return yahooSesion;
  const juntadas = [];
  for (const url of ["https://fc.yahoo.com/", "https://finance.yahoo.com/quote/AAPL/"]) {
    try {
      const r = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": BROWSER_UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(10000)
      });
      const raw = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")].filter(Boolean);
      juntadas.push(...raw.map((c) => String(c).split(";")[0]));
      if (juntadas.some((c) => /^A3=|^A1=/.test(c))) break;
    } catch { /* probamos el siguiente */ }
  }
  yahooSesion = { cookie: juntadas.join("; "), crumb: null };
  return yahooSesion;
}

function yahooHeaders(cookie, sym = "") {
  return {
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`,
    ...(cookie ? { Cookie: cookie } : {})
  };
}

async function yahooCrumb() {
  const s = await yahooCookie();
  if (s.crumb) return s;
  const txt = await getText("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: yahooHeaders(s.cookie) });
  if (!txt || txt.length > 40 || /</.test(txt)) throw new HttpError("Yahoo no entregó el token de sesión (crumb)", 502);
  s.crumb = txt.trim();
  return s;
}

/* La fecha de cada vela se calcula en el huso de la bolsa: el cierre de Tokio
   es medianoche en Japón pero todavía el día anterior en UTC. */
function velasYahoo(r) {
  const q = r.indicators?.quote?.[0] || {};
  const off = (r.meta?.gmtoffset || 0) * 1000;
  const porFecha = new Map();
  (r.timestamp || []).forEach((t, i) => {
    const fila = {
      d: new Date(t * 1000 + off).toISOString().slice(0, 10),
      o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i]
    };
    if (Number.isFinite(fila.c)) porFecha.set(fila.d, fila);
  });
  return [...porFecha.values()];
}

export async function fromYahoo(sym, rango = "2y") {
  let s = await yahooCookie();
  let ultimo = "";
  for (const intento of [0, 1]) {
    for (const host of ["query2", "query1"]) {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${rango}&interval=1d&events=div%2Csplit&includePrePost=false`;
      try {
        const j = await getJSON(url, { headers: yahooHeaders(s.cookie, sym), fuente: "Yahoo Finance" });
        const r = j?.chart?.result?.[0];
        if (!r?.timestamp?.length) { ultimo = j?.chart?.error?.description || "sin serie"; continue; }
        const rows = velasYahoo(r);
        if (rows.length < 30) { ultimo = `serie de ${rows.length} ruedas`; continue; }
        const m = r.meta || {};
        const divs = Object.values(r.events?.dividends || {}).map((x) => ({ d: new Date(x.date * 1000).toISOString().slice(0, 10), monto: x.amount }));
        const splits = Object.values(r.events?.splits || {}).map((x) => ({ d: new Date(x.date * 1000).toISOString().slice(0, 10), factor: x.numerator / (x.denominator || 1) }));
        return {
          rows,
          meta: {
            nombre: m.longName || m.shortName || null,
            moneda: m.currency || null,
            bolsa: m.fullExchangeName || m.exchangeName || null,
            instrumento: m.instrumentType || null,
            precioMercado: m.regularMarketPrice ?? null,
            horaMercado: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null
          },
          dividendos: divs.sort((a, b) => a.d.localeCompare(b.d)),
          splits: splits.sort((a, b) => a.d.localeCompare(b.d))
        };
      } catch (e) {
        ultimo = e.message;
        if (e.status === 404) throw new HttpError(`Yahoo no conoce ${sym}`, 404);
      }
    }
    if (intento === 0) s = await yahooCookie(true);
  }
  throw new HttpError(ultimo || "sin respuesta", 502);
}

/* ------------------------------------------------------- Nasdaq y Stooq */

const dinero = (v) => Number(String(v).replace(/[$,]/g, ""));
const DIAS_RANGO = { "1y": 366, "2y": 731, "5y": 1827, "10y": 3653, max: 3653 };

async function fromNasdaq(sym, rango) {
  const to = new Date(), from = new Date(Date.now() - (DIAS_RANGO[rango] || 731) * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10);
  let ultimo = "";
  for (const clase of ["stocks", "etf"]) {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/historical?assetclass=${clase}&fromdate=${iso(from)}&todate=${iso(to)}&limit=9999`;
    try {
      const body = await getJSON(url, { headers: { "Accept-Language": "en-US,en;q=0.9" } });
      const filas = body?.data?.tradesTable?.rows;
      if (!filas?.length) { ultimo = body?.status?.bCodeMessage?.[0]?.errorMessage || "sin filas"; continue; }
      const rows = filas.map((r) => {
        const [m, d, y] = r.date.split("/");
        return { d: `${y}-${m}-${d}`, o: dinero(r.open), h: dinero(r.high), l: dinero(r.low), c: dinero(r.close), v: dinero(r.volume) };
      }).filter((x) => Number.isFinite(x.c)).reverse();
      if (rows.length >= 30) return { rows, meta: { moneda: "USD" } };
      ultimo = `serie de ${rows.length} ruedas`;
    } catch (e) { ultimo = e.message; }
  }
  throw new HttpError(ultimo || "sin datos", 502);
}

export function parseStooq(csv) {
  const lines = csv.trim().split("\n");
  if (lines.length < 3 || !/^Date,/i.test(lines[0])) {
    throw new HttpError(`Stooq no devolvió una serie válida (respondió: ${csv.slice(0, 80).replace(/\s+/g, " ")})`, 502);
  }
  return lines.slice(1).map((l) => {
    const [d, o, h, lo, c, v] = l.split(",");
    return { d, o: +o, h: +h, l: +lo, c: +c, v: +v };
  }).filter((r) => Number.isFinite(r.c));
}

async function fromStooq(sym) {
  let ultimo = "";
  for (const host of ["stooq.com", "stooq.pl"]) {
    try {
      return { rows: parseStooq(await getText(`https://${host}/q/d/l/?s=${encodeURIComponent(sym.toLowerCase())}.us&i=d`)), meta: { moneda: "USD" } };
    } catch (e) { ultimo = e.message; }
  }
  throw new HttpError(ultimo, 502);
}

/* -------------------------------------------------------------- data912 */

/* data912 publica la historia de BYMA (acciones, CEDEARs y bonos). Es la
   alternativa cuando Yahoo no tiene el instrumento local, típico en bonos. */
async function fromData912(local) {
  let ultimo = "";
  for (const tipo of ["stocks", "cedears", "bonds"]) {
    try {
      const j = await getJSON(`https://data912.com/historical/${tipo}/${encodeURIComponent(local)}`);
      if (!Array.isArray(j) || j.length < 30) { ultimo = `${tipo}: sin serie`; continue; }
      const rows = j.map((r) => ({ d: String(r.date).slice(0, 10), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }))
        .filter((r) => Number.isFinite(r.c) && r.c > 0)
        .sort((a, b) => a.d.localeCompare(b.d));
      const enDolares = tipo !== "stocks" && /[DC]$/.test(local) && local.length > 3;
      return { rows, meta: { moneda: enDolares ? "USD" : "ARS", bolsa: "BYMA", instrumento: tipo } };
    } catch (e) { ultimo = `${tipo}: ${e.message}`; }
  }
  throw new HttpError(ultimo, 502);
}

/* ---------------------------------------------------------------- precio */

const RANGOS = new Set(["1y", "2y", "5y", "10y"]);

export async function price(ticker, { rango = "2y" } = {}) {
  if (!RANGOS.has(rango)) rango = "2y";
  const r = resolver(ticker);
  return cached(`px:${r.pedido}:${rango}`, 5 * 60e3, () => precioSinCache(r, rango));
}

async function precioSinCache(r, rango) {
  const cadena = [];
  if (r.tipo === "indice") {
    cadena.push(["Yahoo Finance", () => fromYahoo(r.yahoo, rango), r.yahoo, null]);
    if (r.etf) {
      const aviso = `Yahoo no respondió con el índice: se usa el ETF ${r.etf}, que replica el ${r.nombre}.`;
      cadena.push(["Nasdaq", () => fromNasdaq(r.etf, rango), r.etf, aviso]);
      cadena.push(["Stooq", () => fromStooq(r.etf), r.etf, aviso]);
    }
  } else if (r.tipo === "ar") {
    cadena.push(["Yahoo Finance", () => fromYahoo(r.yahoo, rango), r.pedido, null]);
    cadena.push(["data912 (BYMA)", () => fromData912(r.local), r.pedido, null]);
  } else if (r.tipo === "global") {
    cadena.push(["Yahoo Finance", () => fromYahoo(r.yahoo, rango), r.pedido, null]);
  } else {
    cadena.push(["Yahoo Finance", () => fromYahoo(r.yahoo, rango), r.pedido, null]);
    cadena.push(["Nasdaq", () => fromNasdaq(r.us, rango), r.pedido, null]);
    cadena.push(["Stooq", () => fromStooq(r.us), r.pedido, null]);
    /* Si no existe en EE.UU., probamos BYMA: YPFD, ALUA o TXAR no llevan sufijo
       en el habla cotidiana. */
    const aviso = `${r.pedido} no figura en EE.UU.: se muestra ${r.pedido}.BA, que cotiza en BYMA en pesos.`;
    cadena.push(["Yahoo Finance", () => fromYahoo(`${r.pedido}.BA`, rango), `${r.pedido}.BA`, aviso]);
    cadena.push(["data912 (BYMA)", () => fromData912(r.pedido), `${r.pedido}.BA`, aviso]);
  }

  const fallos = [];
  for (const [fuente, fn, simbolo, aviso] of cadena) {
    try {
      const out = await fn();
      const dias = { "1y": 252, "2y": 504, "5y": 1260, "10y": 2520 }[rango];
      const rows = out.rows.slice(-dias);
      const hace1a = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
      const div12 = (out.dividendos || []).filter((x) => x.d >= hace1a).reduce((a, x) => a + x.monto, 0);
      const s = stats(rows);
      return {
        ticker: simbolo,
        requested: r.pedido,
        nombre: out.meta?.nombre || r.nombre || null,
        moneda: out.meta?.moneda || (simbolo.endsWith(".BA") ? "ARS" : "USD"),
        bolsa: out.meta?.bolsa || null,
        instrumento: out.meta?.instrumento || null,
        horaMercado: out.meta?.horaMercado || null,
        note: aviso,
        source: fuente,
        rango,
        candles: rows,
        stats: s,
        dividendos12m: div12 || null,
        rentaDividendo: div12 ? (div12 / s.last) * 100 : null,
        splits: out.splits || []
      };
    } catch (e) {
      fallos.push(`${fuente}${simbolo !== r.pedido ? ` (${simbolo})` : ""}: ${String(e.message).slice(0, 90)}`);
    }
  }
  throw new HttpError(`Ninguna fuente devolvió la serie de ${r.pedido}. ${fallos.join(" · ")}`, 502);
}

/* Versión liviana para tableros y watchlist: comparte la cache con price(). */
export async function cotizacionLigera(ticker) {
  const p = await price(ticker, { rango: "1y" });
  const s = p.stats;
  return {
    ticker: p.ticker, pedido: p.requested, nombre: p.nombre, moneda: p.moneda, fecha: s.date, fuente: p.source,
    last: s.last, cambio1: s.cambio1, ret1: s.ret1, ret5: s.ret5, ret21: s.ret21, retYtd: s.retYtd, ret252: s.ret252,
    vol21: s.vol21, rsi14: s.rsi14, vsSma200: s.vsSma200,
    spark: p.candles.slice(-66).map((x) => x.c)
  };
}

/* Splits de los últimos años: hacen falta para ajustar el beneficio por
   acción que la SEC publica sin reexpresar. */
export async function splitsDe(ticker) {
  return cached(`splits:${ticker}`, 24 * 3600e3, async () => {
    try {
      const r = resolver(ticker);
      const s = await yahooCookie();
      const j = await getJSON(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(r.yahoo)}?range=10y&interval=3mo&events=split`, { headers: yahooHeaders(s.cookie, r.yahoo), fuente: "Yahoo Finance" });
      return Object.values(j?.chart?.result?.[0]?.events?.splits || {})
        .map((x) => ({ d: new Date(x.date * 1000).toISOString().slice(0, 10), factor: x.numerator / (x.denominator || 1) }))
        .sort((a, b) => a.d.localeCompare(b.d));
    } catch { return []; }
  });
}

/* ---------------------------------------------------------------- búsqueda */

export async function buscarYahoo(q) {
  const s = await yahooCookie();
  const j = await getJSON(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=false`, { headers: yahooHeaders(s.cookie), fuente: "Yahoo Finance", timeout: 8000 });
  const TIPOS = new Set(["EQUITY", "ETF", "INDEX", "MUTUALFUND", "CURRENCY", "CRYPTOCURRENCY", "FUTURE"]);
  return (j.quotes || []).filter((x) => x.symbol && TIPOS.has(x.quoteType)).map((x) => ({
    ticker: x.symbol,
    nombre: x.longname || x.shortname || "",
    bolsa: x.exchDisp || x.exchange || "",
    tipo: x.typeDisp || x.quoteType || ""
  }));
}

/* ------------------------------------------------- consenso de analistas */

const raw = (o) => (o && typeof o === "object" ? (o.raw ?? null) : (typeof o === "number" ? o : null));

/* Es la misma información que muestran las terminales pagas en la pantalla
   de estimaciones: precio objetivo, recomendaciones, sorpresas de ganancias y
   revisiones. Viene de Yahoo, que la toma de los brokers que la publican. */
export async function consensoYahoo(ticker) {
  const r = resolver(ticker);
  return cached(`consenso:${r.yahoo}`, 30 * 60e3, async () => {
    const modulos = "financialData,defaultKeyStatistics,summaryDetail,recommendationTrend,calendarEvents,earningsHistory,earningsTrend,assetProfile,upgradeDowngradeHistory";
    let ultimo;
    for (const intento of [0, 1]) {
      try {
        const s = await yahooCrumb();
        const j = await getJSON(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(r.yahoo)}?modules=${modulos}&crumb=${encodeURIComponent(s.crumb)}`, { headers: yahooHeaders(s.cookie, r.yahoo), fuente: "Yahoo Finance" });
        const q = j?.quoteSummary?.result?.[0];
        if (!q) throw new HttpError(j?.quoteSummary?.error?.description || "Yahoo no devolvió el resumen", 502);
        return armarConsenso(r.yahoo, q);
      } catch (e) {
        ultimo = e;
        if (intento === 0 && (e.status === 401 || e.status === 403 || /crumb/i.test(e.message))) { await yahooCookie(true); continue; }
        break;
      }
    }
    throw ultimo;
  });
}

function armarConsenso(sym, q) {
  const fd = q.financialData || {}, ks = q.defaultKeyStatistics || {}, sd = q.summaryDetail || {};
  const ap = q.assetProfile || {};
  const tendencia = (q.recommendationTrend?.trend || []).map((t) => ({
    periodo: t.period, compraFuerte: t.strongBuy, compra: t.buy, mantener: t.hold, venta: t.sell, ventaFuerte: t.strongSell
  }));
  const fechas = (q.calendarEvents?.earnings?.earningsDate || []).map(raw).filter(Boolean).map((t) => new Date(t * 1000).toISOString().slice(0, 10));
  const historia = (q.earningsHistory?.history || []).map((h) => ({
    trimestre: raw(h.quarter) ? new Date(raw(h.quarter) * 1000).toISOString().slice(0, 10) : null,
    real: raw(h.epsActual), estimado: raw(h.epsEstimate), sorpresaPct: raw(h.surprisePercent) !== null ? raw(h.surprisePercent) * 100 : null
  })).filter((h) => h.trimestre);
  const NOMBRE_PERIODO = { "0q": "Trimestre en curso", "+1q": "Próximo trimestre", "0y": "Ejercicio en curso", "+1y": "Próximo ejercicio" };
  const estimaciones = (q.earningsTrend?.trend || []).filter((t) => NOMBRE_PERIODO[t.period]).map((t) => ({
    periodo: NOMBRE_PERIODO[t.period],
    fin: t.endDate || null,
    bpa: raw(t.earningsEstimate?.avg), bpaBajo: raw(t.earningsEstimate?.low), bpaAlto: raw(t.earningsEstimate?.high),
    bpaAnioAnterior: raw(t.earningsEstimate?.yearAgoEps),
    crecimientoBpa: raw(t.earningsEstimate?.growth) !== null ? raw(t.earningsEstimate?.growth) * 100 : null,
    analistas: raw(t.earningsEstimate?.numberOfAnalysts),
    ingresos: raw(t.revenueEstimate?.avg),
    crecimientoIngresos: raw(t.revenueEstimate?.growth) !== null ? raw(t.revenueEstimate?.growth) * 100 : null,
    bpaHace30: raw(t.epsTrend?.["30daysAgo"]), bpaHace90: raw(t.epsTrend?.["90daysAgo"]),
    revSuben30: raw(t.epsRevisions?.upLast30days), revBajan30: raw(t.epsRevisions?.downLast30days)
  }));
  const cambios = (q.upgradeDowngradeHistory?.history || []).slice(0, 12).map((h) => ({
    fecha: h.epochGradeDate ? new Date(h.epochGradeDate * 1000).toISOString().slice(0, 10) : null,
    firma: h.firm, desde: h.fromGrade, hacia: h.toGrade, accion: h.action
  }));
  return {
    ticker: sym,
    fuente: "Yahoo Finance",
    perfil: {
      sector: ap.sector || null, industria: ap.industry || null, pais: ap.country || null,
      empleados: ap.fullTimeEmployees || null, web: ap.website || null,
      descripcion: ap.longBusinessSummary || null
    },
    precio: raw(fd.currentPrice),
    objetivo: { medio: raw(fd.targetMeanPrice), mediana: raw(fd.targetMedianPrice), alto: raw(fd.targetHighPrice), bajo: raw(fd.targetLowPrice) },
    recomendacionMedia: raw(fd.recommendationMean),
    recomendacionClave: fd.recommendationKey || null,
    analistas: raw(fd.numberOfAnalystOpinions),
    tendencia,
    proximoBalance: fechas[0] || null,
    historia,
    estimaciones,
    cambios,
    clave: {
      perTrailing: raw(sd.trailingPE), perForward: raw(sd.forwardPE) ?? raw(ks.forwardPE),
      peg: raw(ks.pegRatio), evEbitda: raw(ks.enterpriseToEbitda), precioLibro: raw(ks.priceToBook),
      beta: raw(sd.beta) ?? raw(ks.beta), rentaDividendo: raw(sd.dividendYield) !== null ? raw(sd.dividendYield) * 100 : null,
      capitalizacion: raw(sd.marketCap), cortoSobreFlotante: raw(ks.shortPercentOfFloat) !== null ? raw(ks.shortPercentOfFloat) * 100 : null,
      diasParaCubrir: raw(ks.shortRatio),
      insiders: raw(ks.heldPercentInsiders) !== null ? raw(ks.heldPercentInsiders) * 100 : null,
      institucionales: raw(ks.heldPercentInstitutions) !== null ? raw(ks.heldPercentInstitutions) * 100 : null,
      margenBruto: raw(fd.grossMargins) !== null ? raw(fd.grossMargins) * 100 : null,
      margenOperativo: raw(fd.operatingMargins) !== null ? raw(fd.operatingMargins) * 100 : null,
      crecimientoIngresos: raw(fd.revenueGrowth) !== null ? raw(fd.revenueGrowth) * 100 : null,
      roe: raw(fd.returnOnEquity) !== null ? raw(fd.returnOnEquity) * 100 : null
    }
  };
}

/* Yahoo sugiere tickers "parecidos" según lo que miran sus usuarios. Sirve
   como punto de partida para elegir pares, nunca como lista definitiva. */
export async function paresSugeridos(ticker) {
  const r = resolver(ticker);
  return cached(`pares:${r.yahoo}`, 24 * 3600e3, async () => {
    const s = await yahooCookie();
    const j = await getJSON(`https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/${encodeURIComponent(r.yahoo)}`, { headers: yahooHeaders(s.cookie, r.yahoo), fuente: "Yahoo Finance", timeout: 8000 });
    return (j?.finance?.result?.[0]?.recommendedSymbols || []).map((x) => x.symbol).filter(Boolean).slice(0, 8);
  });
}
