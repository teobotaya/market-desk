/* Fetch falso para tests: responde con el formato documentado de cada
   fuente, sin salir a la red.

   - Argentina (DolarApi, ArgentinaDatos): datos REALES recortados, de los
     repositorios públicos de esas APIs (licencia MIT). Ver fixtures/.
   - Todo lo demás: series SINTÉTICAS generadas con semilla fija, rotuladas
     como tales ("Serie sintética", "Empresa de Prueba"). No representan a
     ninguna empresa ni mercado real.

   Uso: node --import ./test/fake-fetch.mjs server.mjs  (o importarlo en un test). */

import fs from "node:fs";
import { TASA_FIJA, ONS, DOLAR_NUEVOS, CER } from "../lib/instrumentos.mjs";

const AR = JSON.parse(fs.readFileSync(new URL("./fixtures/argentina.json", import.meta.url), "utf8"));
export const llamadas = [];

/* ------------------------------------------------------------ utilidades */

const hash = (s) => [...String(s)].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const masDias = (f, n) => iso(Date.parse(f) + n * 864e5);

function habiles(n) {
  const out = [];
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(new Date(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

function base(sym) {
  if (sym === "^MERV") return 2_000_000;
  if (sym.endsWith(".BA")) return 3000 + (hash(sym) % 5000);
  if (/^\^(TNX|FVX|TYX|IRX)$/.test(sym)) return 4;
  if (/=X$/.test(sym)) return 1.1;
  if (sym === "^VIX") return 16;
  if (sym === "PRUEBA") return 110;
  return 50 + (hash(sym) % 400);
}

function velas(sym, n) {
  const r = rng(hash(sym));
  let p = base(sym);
  return habiles(n).map((d) => {
    const ret = 0.0003 + 0.017 * (r() + r() + r() - 1.5) * 1.4;
    const o = p; p *= 1 + ret;
    return { t: d.getTime() / 1000 + 13.5 * 3600, o, h: Math.max(o, p) * (1 + r() * 0.008), l: Math.min(o, p) * (1 - r() * 0.008), c: p, v: Math.round(2e6 * (0.5 + r())) };
  });
}

const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
const texto = (t, status = 200, tipo = "text/plain") => new Response(t, { status, headers: { "content-type": tipo } });

/* ---------------------------------------------------------------- Yahoo */

function yahooChart(sym, rango, intervalo) {
  if (sym.startsWith("NOEXISTE")) return json({ chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } }, 404);
  const n = intervalo === "3mo" ? 40 : ({ "1y": 252, "2y": 504, "5y": 1260, "10y": 2520 }[rango] || 504);
  /* "VIEJO…": una serie que dejó de actualizarse hace más de un mes (como el ^MERV de Yahoo tras el cambio a MSCI). */
  const rows = sym.startsWith("VIEJO") ? velas(sym, n).slice(0, -25) : velas(sym, n);
  const ars = sym.endsWith(".BA") || sym === "^MERV";
  const events = sym === "PRUEBA"
    ? { splits: { a: { date: Date.parse("2025-06-10") / 1000, numerator: 4, denominator: 1 } }, dividends: { b: { date: Date.now() / 1000 - 90 * 864e2, amount: 0.5 } } }
    : {};
  return json({
    chart: {
      result: [{
        meta: {
          currency: ars ? "ARS" : "USD", symbol: sym, exchangeName: "SIM", fullExchangeName: "Mercado sintético", instrumentType: "EQUITY",
          regularMarketPrice: rows.at(-1).c, regularMarketTime: rows.at(-1).t, gmtoffset: -14400, longName: `Serie sintética ${sym}`
        },
        timestamp: rows.map((x) => x.t), events,
        indicators: { quote: [{ open: rows.map((x) => x.o), high: rows.map((x) => x.h), low: rows.map((x) => x.l), close: rows.map((x) => x.c), volume: rows.map((x) => x.v) }] }
      }],
      error: null
    }
  });
}

function quoteSummary(sym) {
  const px = velas(sym, 504).at(-1).c;
  const ts = (f) => ({ raw: Date.parse(f) / 1000, fmt: f });
  const r = (v) => ({ raw: v, fmt: String(v) });
  return json({
    quoteSummary: {
      result: [{
        assetProfile: { sector: "Sector sintético", industry: "Industria de prueba", country: "Ninguno", fullTimeEmployees: 1234, website: "https://example.com", longBusinessSummary: `Descripción sintética de ${sym} para tests. No corresponde a ninguna empresa real.` },
        financialData: { currentPrice: r(px), targetMeanPrice: r(px * 1.12), targetMedianPrice: r(px * 1.1), targetHighPrice: r(px * 1.5), targetLowPrice: r(px * 0.8), recommendationMean: r(2.1), recommendationKey: "buy", numberOfAnalystOpinions: r(31), grossMargins: r(0.6), operatingMargins: r(0.3), revenueGrowth: r(0.17), returnOnEquity: r(0.25) },
        defaultKeyStatistics: { forwardPE: r(24.5), pegRatio: r(1.4), enterpriseToEbitda: r(19.2), shortPercentOfFloat: r(0.021), shortRatio: r(1.8), heldPercentInsiders: r(0.04), heldPercentInstitutions: r(0.68), beta: r(1.3) },
        summaryDetail: { trailingPE: r(28.1), forwardPE: r(24.5), dividendYield: r(0.004), marketCap: r(px * 400e6), beta: r(1.3) },
        recommendationTrend: { trend: [{ period: "0m", strongBuy: 9, buy: 14, hold: 6, sell: 1, strongSell: 1 }, { period: "-1m", strongBuy: 8, buy: 14, hold: 7, sell: 1, strongSell: 1 }] },
        calendarEvents: { earnings: { earningsDate: [ts(masDias(iso(Date.now()), 20))] } },
        earningsHistory: { history: [0, 1, 2, 3].map((k) => ({ quarter: ts(masDias(iso(Date.now()), -90 * (k + 1))), epsActual: r(1.2 - k * 0.05), epsEstimate: r(1.1 - k * 0.05), surprisePercent: r(0.09) })) },
        earningsTrend: { trend: [["0q", 1.3], ["+1q", 1.4], ["0y", 5.1], ["+1y", 6.0]].map(([period, bpa]) => ({ period, endDate: "2026-12-31", earningsEstimate: { avg: r(bpa), low: r(bpa * 0.9), high: r(bpa * 1.1), growth: r(0.15), numberOfAnalysts: r(25) }, revenueEstimate: { avg: r(5e9), growth: r(0.12) }, epsTrend: { "30daysAgo": r(bpa * 0.98) }, epsRevisions: { upLast30days: r(5), downLast30days: r(1) } })) },
        upgradeDowngradeHistory: { history: [{ epochGradeDate: Date.now() / 1000 - 5 * 864e2, firm: "Broker Sintético", fromGrade: "Neutral", toGrade: "Buy", action: "up" }] }
      }],
      error: null
    }
  });
}

/* ------------------------------------------------------------------ SEC */

const SPLIT = "2025-06-10";
const EMPRESAS = { PRUEBA: [999999, "Empresa de Prueba S.A. (datos sintéticos)", 1], PAR1: [999998, "Par Uno Sintético Inc.", 0.6], PAR2: [999997, "Par Dos Sintético Inc.", 1.4] };
const porCik = Object.fromEntries(Object.entries(EMPRESAS).map(([t, [cik, nombre, esc]]) => [cik, { t, nombre, esc }]));

/* Genera presentaciones trimestrales y anuales con la mecánica real de XBRL:
   resultados trimestrales discretos, flujo de fondos acumulado en el año,
   comparativos del año anterior reexpresados y un split 4:1 a mitad de 2025. */
function presentaciones(cik) {
  const e = porCik[cik];
  const trimestres = [];
  for (let y = 2020; y <= 2026; y++) for (let k = 1; k <= 4; k++) if (!(y === 2026 && k > 3)) trimestres.push({ y, k });
  const fin = (y, k) => [`${y}-03-31`, `${y}-06-30`, `${y}-09-30`, `${y}-12-31`][k - 1];
  const ini = (y, k) => [`${y}-01-01`, `${y}-04-01`, `${y}-07-01`, `${y}-10-01`][k - 1];
  const idx = (y, k) => (y - 2020) * 4 + (k - 1);
  const ing = (y, k) => 1000e6 * e.esc * (1 + 0.035 * idx(y, k));
  const acciones = 400e6 * e.esc;
  const q = (y, k) => {
    const i = ing(y, k);
    return { ingresos: i, costo: i * 0.4, op: i * 0.3, neto: i * 0.22, id: i * 0.12, cfo: i * 0.27, capex: i * 0.05, amort: i * 0.03, imp: i * 0.044, antes: i * 0.264, sbc: i * 0.02 };
  };
  const anio = (y) => {
    const s = {};
    for (let k = 1; k <= 4; k++) for (const [c, v] of Object.entries(q(y, k))) s[c] = (s[c] || 0) + v;
    return s;
  };
  const ytd = (y, k) => {
    const s = {};
    for (let j = 1; j <= k; j++) for (const [c, v] of Object.entries(q(y, j))) s[c] = (s[c] || 0) + v;
    return s;
  };
  const balance = (y, k) => ({ patrimonio: ing(y, k) * 6, caja: ing(y, k) * 1.5, deuda: ing(y, k) * 1.1, activos: ing(y, k) * 10 });

  const facts = {}, dei = [];
  const add = (tag, unit, d) => { ((facts[tag] ||= { units: {} }).units[unit] ||= []).push(d); };
  const lista = [];
  let n = 0;
  const hoy = iso(Date.now());

  const emitirFlujos = (meta, start, end, vals, filed) => {
    const pre = filed < SPLIT;
    add("Revenues", "USD", { start, end, val: vals.ingresos, ...meta });
    add("CostOfRevenue", "USD", { start, end, val: vals.costo, ...meta });
    add("OperatingIncomeLoss", "USD", { start, end, val: vals.op, ...meta });
    add("NetIncomeLoss", "USD", { start, end, val: vals.neto, ...meta });
    add("ResearchAndDevelopmentExpense", "USD", { start, end, val: vals.id, ...meta });
    add("IncomeTaxExpenseBenefit", "USD", { start, end, val: vals.imp, ...meta });
    add("IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "USD", { start, end, val: vals.antes, ...meta });
    const acc = pre ? acciones / 4 : acciones;
    add("WeightedAverageNumberOfDilutedSharesOutstanding", "shares", { start, end, val: acc, ...meta });
    add("EarningsPerShareDiluted", "USD/shares", { start, end, val: Math.round((vals.neto / acc) * 100) / 100, ...meta });
    add("EarningsPerShareBasic", "USD/shares", { start, end, val: Math.round((vals.neto / acc) * 102) / 100, ...meta });
    add("SellingGeneralAndAdministrativeExpense", "USD", { start, end, val: vals.ingresos * 0.18, ...meta });
    add("InterestExpense", "USD", { start, end, val: vals.ingresos * 0.006, ...meta });
  };
  const emitirCaja = (meta, start, end, vals) => {
    add("NetCashProvidedByUsedInOperatingActivities", "USD", { start, end, val: vals.cfo, ...meta });
    add("PaymentsToAcquirePropertyPlantAndEquipment", "USD", { start, end, val: vals.capex, ...meta });
    add("DepreciationDepletionAndAmortization", "USD", { start, end, val: vals.amort, ...meta });
    add("ShareBasedCompensation", "USD", { start, end, val: vals.sbc, ...meta });
    add("NetCashProvidedByUsedInInvestingActivities", "USD", { start, end, val: -vals.capex * 1.4, ...meta });
    add("NetCashProvidedByUsedInFinancingActivities", "USD", { start, end, val: -vals.cfo * 0.3, ...meta });
  };
  const emitirBalance = (meta, end, b) => {
    add("StockholdersEquity", "USD", { end, val: b.patrimonio, ...meta });
    add("CashAndCashEquivalentsAtCarryingValue", "USD", { end, val: b.caja, ...meta });
    add("LongTermDebtNoncurrent", "USD", { end, val: b.deuda, ...meta });
    add("Assets", "USD", { end, val: b.activos, ...meta });
    add("AssetsCurrent", "USD", { end, val: b.activos * 0.4, ...meta });
    add("AccountsReceivableNetCurrent", "USD", { end, val: b.activos * 0.08, ...meta });
    add("InventoryNet", "USD", { end, val: b.activos * 0.05, ...meta });
    add("PropertyPlantAndEquipmentNet", "USD", { end, val: b.activos * 0.2, ...meta });
    add("LiabilitiesCurrent", "USD", { end, val: b.activos * 0.15, ...meta });
    add("AccountsPayableCurrent", "USD", { end, val: b.activos * 0.06, ...meta });
    add("LiabilitiesAndStockholdersEquity", "USD", { end, val: b.activos, ...meta });
  };

  for (const { y, k } of trimestres) {
    const esAnual = k === 4;
    const filed = masDias(fin(y, k), esAnual ? 50 : 40);
    if (filed > hoy) continue;
    const accn = `0000${cik}-${String(y).slice(2)}-${String(++n).padStart(6, "0")}`;
    const form = esAnual ? "10-K" : "10-Q";
    const meta = { accn, fy: y, fp: esAnual ? "FY" : `Q${k}`, form, filed };
    if (esAnual) {
      for (const yy of [y, y - 1, y - 2]) if (yy >= 2020) { emitirFlujos(meta, `${yy}-01-01`, `${yy}-12-31`, anio(yy), filed); emitirCaja(meta, `${yy}-01-01`, `${yy}-12-31`, anio(yy)); }
      emitirBalance(meta, fin(y, 4), balance(y, 4));
      if (y > 2020) emitirBalance(meta, fin(y - 1, 4), balance(y - 1, 4));
    } else {
      emitirFlujos(meta, ini(y, k), fin(y, k), q(y, k), filed);
      if (y > 2020) emitirFlujos(meta, ini(y - 1, k), fin(y - 1, k), q(y - 1, k), filed);
      emitirCaja(meta, `${y}-01-01`, fin(y, k), ytd(y, k));
      if (y > 2020) emitirCaja(meta, `${y - 1}-01-01`, fin(y - 1, k), ytd(y - 1, k));
      emitirBalance(meta, fin(y, k), balance(y, k));
    }
    dei.push({ end: masDias(filed, -10), val: filed < SPLIT ? acciones / 4 : acciones, accn, fy: y, fp: meta.fp, form, filed });
    lista.push({ accn, form, filed, periodo: fin(y, k), doc: esAnual ? `prueba-10k-${y}.htm` : `prueba-10q-${y}q${k}.htm` });
  }
  return { facts, dei, lista };
}

function companyFacts(cik) {
  const { facts, dei } = presentaciones(cik);
  return json({ cik, entityName: porCik[cik].nombre, facts: { "us-gaap": facts, dei: { EntityCommonStockSharesOutstanding: { units: { shares: dei } } } } });
}

function submissions(cik) {
  const { lista } = presentaciones(cik);
  const extra = [
    { accn: `0000${cik}-26-900001`, form: "8-K", filed: masDias(iso(Date.now()), -12), periodo: masDias(iso(Date.now()), -12), doc: "prueba-8k.htm", items: "2.02,9.01" },
    { accn: `0000${cik}-26-900002`, form: "8-K", filed: masDias(iso(Date.now()), -40), periodo: masDias(iso(Date.now()), -40), doc: "prueba-8k-2.htm", items: "5.02" },
    { accn: `0000${cik}-26-900003`, form: "4", filed: masDias(iso(Date.now()), -8), periodo: masDias(iso(Date.now()), -9), doc: "xslF345X05/form4-1.xml" },
    { accn: `0000${cik}-26-900004`, form: "4", filed: masDias(iso(Date.now()), -20), periodo: masDias(iso(Date.now()), -21), doc: "xslF345X05/form4-2.xml" }
  ];
  const todas = [...lista, ...extra].sort((a, b) => b.filed.localeCompare(a.filed));
  return json({
    cik: String(cik), name: porCik[cik].nombre, sicDescription: "Actividad sintética",
    filings: { recent: {
      accessionNumber: todas.map((x) => x.accn), filingDate: todas.map((x) => x.filed), reportDate: todas.map((x) => x.periodo),
      form: todas.map((x) => x.form), primaryDocument: todas.map((x) => x.doc), primaryDocDescription: todas.map((x) => x.form), items: todas.map((x) => x.items || "")
    } }
  });
}

function documento10k(nombre) {
  const anio = Number((nombre.match(/10k-(\d{4})/) || [])[1]);
  const p = (titulo, cuerpo) => `<p><b>${titulo}</b></p><p>${cuerpo} ${"This paragraph is synthetic test content used to exercise the parser and has no relation to any real company. ".repeat(3)}</p>`;
  const comunes = [
    p("Our stock price may be volatile.", "General economic conditions, market volatility, interest rate changes and inflation could affect our stock price and results of operations."),
    p("We depend on key personnel.", "Our ability to attract and retain key personnel is important; litigation, cybersecurity incidents and regulatory changes could harm us."),
    p("We rely on a single supplier for our main component.", "We depend on a sole source supplier located in Taiwan for wafer fabrication; capacity constraints or export controls could disrupt supply."),
    p("Changes in tax law could affect us.", "Tax law changes, accounting standards and foreign currency movements could affect reported results."),
    p("Competition in our markets is intense.", "We face intense competition and pricing pressure from established companies and new entrants seeking market share."),
    p("We may not protect our intellectual property.", "Our patents and trade secrets may be challenged, and litigation to defend them could be costly."),
    p("Our indebtedness could limit our flexibility.", "Our credit facility contains covenants, and higher interest rate levels would increase our debt service costs.")
  ];
  const nuevos = anio >= 2025 ? [
    p("A single customer represents a significant portion of our revenue.", "Our largest customer accounted for 35% of our total revenue during the year, and the loss of this customer would harm us."),
    p("New export restrictions may limit sales to certain countries.", "Recently announced export control rules and entity list designations could restrict shipments to China.")
  ] : [p("Our legacy product line faces declining demand.", "Demand for our legacy product line has declined and may continue to decline as customers migrate.")];
  return texto(`<html><body><p>Table of contents Item 1A. Risk Factors 12 Item 1B. Unresolved Staff Comments 30</p>
    <h2>Item 1A. Risk Factors</h2>${[...nuevos, ...comunes].join("\n")}
    <h2>Item 1B. Unresolved Staff Comments</h2><p>None.</p></body></html>`, 200, "text/html");
}

function form4(nombre) {
  const venta = nombre.includes("form4-1");
  return texto(`<?xml version="1.0"?><ownershipDocument><aff10b5One>${venta ? 1 : 0}</aff10b5One>
    <reportingOwner><reportingOwnerId><rptOwnerCik>1</rptOwnerCik><rptOwnerName>${venta ? "Persona Sintética Uno" : "Persona Sintética Dos"}</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>${venta ? 0 : 1}</isDirector><isOfficer>${venta ? 1 : 0}</isOfficer><officerTitle>Director financiero</officerTitle></reportingOwnerRelationship></reportingOwner>
    <nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>${masDias(iso(Date.now()), venta ? -9 : -21)}</value></transactionDate>
    <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${venta ? "S" : "P"}</transactionCode></transactionCoding>
    <transactionAmounts><transactionShares><value>${venta ? 20000 : 5000}</value></transactionShares><transactionPricePerShare><value>${venta ? 120.5 : 101.25}</value><footnoteId id="F1"/></transactionPricePerShare><transactionAcquiredDisposedCode><value>${venta ? "D" : "A"}</value></transactionAcquiredDisposedCode></transactionAmounts>
    <postTransactionAmounts><sharesOwnedFollowingTransaction><value>150000</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`, 200, "application/xml");
}

/* ------------------------------------------------------- otras fuentes */

function fredCsv(id) {
  const bases = { DFF: 4.33, DGS2: 3.9, DGS10: 4.25, T10Y2Y: 0.35, T10Y3M: 0.1, DFII10: 1.9, T10YIE: 2.3, BAMLH0A0HYM2: 3.1, BAMLC0A0CM: 0.95, DGS1MO: 4.3, DGS3MO: 4.25, DGS6MO: 4.15, DGS1: 4.0, DGS3: 3.95, DGS5: 4.0, DGS7: 4.1, DGS20: 4.6, DGS30: 4.7 };
  const r = rng(hash(id));
  let v = bases[id] ?? 2;
  const filas = habiles(760).map((d, i) => { v += (r() - 0.5) * 0.04; return `${iso(d)},${i % 97 === 0 ? "." : v.toFixed(2)}`; });
  return texto(`observation_date,${id}\n${filas.join("\n")}\n`, 200, "text/csv");
}

function rss() {
  const titulos = ["Las acciones suben con fuerza tras un balance récord", "El índice cae por temor a nuevas tasas", "La empresa supera las estimaciones y recupera terreno", "Investigación regulatoria golpea al sector",
    "El mercado opera sin cambios a la espera de datos", "Rebota el sector tecnológico", "Analistas recortan proyecciones de ganancias", "Acuerdo comercial impulsa a las exportadoras"];
  const items = titulos.map((t, i) => `<item><title><![CDATA[${t} - Medio Sintético ${i % 3}]]></title><link>https://example.com/n/${i}</link><pubDate>${new Date(Date.now() - i * 1.3 * 864e5).toUTCString()}</pubDate><source url="https://example.com">Medio Sintético ${i % 3}</source></item>`);
  return texto(`<?xml version="1.0"?><rss><channel>${items.join("")}</channel></rss>`, 200, "application/rss+xml");
}

/* Precios sintéticos en dólares por cada 100 nominales, cerca de su valor técnico. */
const BONOS_USD = { AL29: 58, GD29: 59, AL30: 61, GD30: 62, AL35: 74, GD35: 76, AE38: 78, GD38: 80, AL41: 67, GD41: 69, GD46: 73 };

/* Precio sintético de un instrumento con flujos conocidos: sus flujos
   futuros descontados a una tasa fija (así la TIR calculada es conocida). */
const hoyF = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const valorPresente = (flujos, tasa) => flujos.filter(([f]) => f > hoyF()).reduce((s, [f, m]) => s + m / (1 + tasa) ** ((Date.parse(f) - Date.parse(hoyF())) / 864e5 / 365), 0);
export const TIR_SINTETICA = { ons: 0.075, nuevos: 0.07, temLecap: 0.022, realCer: 0.05 };
/* CER sintético constante: así el coeficiente no depende del día del test. */
export const CER_SINTETICO = 720;
function flujosRealesCer(def) {
  let residual = 1;
  return def.flujos.map(([f, am, tasa, base]) => { const c = residual * tasa * base; residual -= am; return [f, (am + c) * 100]; });
}

/* Dólar MEP y cable implícitos en los precios sintéticos. */
export const MEP_SINTETICO = 1570, CCL_SINTETICO = 1655;
function precioSintetico(tipo, s) {
  const usd = BONOS_USD[s.replace(/[DC]$/, "")];
  if (tipo === "arg_bonds" && usd) return s.endsWith("D") ? usd : s.endsWith("C") ? (usd * MEP_SINTETICO) / CCL_SINTETICO : usd * MEP_SINTETICO;
  if (TASA_FIJA[s]) return TASA_FIJA[s].pagoFinal / (1 + TIR_SINTETICA.temLecap) ** (((Date.parse(TASA_FIJA[s].vence) - Date.parse(hoyF())) / 864e5) / 30);
  if (tipo === "arg_corp" && ONS[s]) return valorPresente(ONS[s].flujos, TIR_SINTETICA.ons);
  if (CER[s]) return valorPresente(flujosRealesCer(CER[s]), TIR_SINTETICA.realCer) * (CER_SINTETICO / CER[s].cerEmision);
  const nuevo = DOLAR_NUEVOS[s.replace(/D$/, "")];
  if (tipo === "arg_bonds" && nuevo) return s.endsWith("D") ? valorPresente(nuevo.flujos, TIR_SINTETICA.nuevos) : valorPresente(nuevo.flujos, TIR_SINTETICA.nuevos) * 1570;
  if (tipo === "arg_cedears" && s.length > 2 && s.endsWith("D") && !s.startsWith("D")) return base(`${s.slice(0, -1)}.BA`) / MEP_SINTETICO;
  if (tipo === "arg_cedears" && s === "AAPLC") return base("AAPL.BA") / CCL_SINTETICO;
  return base(`${s}.BA`);
}

function panelBYMA(tipo) {
  const listas = {
    arg_stocks: ["GGAL", "YPFD", "PAMP", "ALUA", "BMA", "TXAR", "CEPU", "LOMA", "TGSU2", "SUPV", "BBAR", "COME", "EDN", "CRES", "IRSA", "METR", "TECO2", "TRAN", "VALO", "BYMA", "MOLI", "HARG", "AGRO"],
    arg_cedears: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "KO", "MELI", "SPY", "QQQ", "AAPLD", "MSFTD", "KOD", "AAPLC"],
    arg_bonds: [...Object.keys(BONOS_USD).flatMap((t) => [t, `${t}D`, `${t}C`]), "T15E7", "AO27", "AO27D", "AN29D", "TZXD6", "TZXM7", "TZX27", "TZXD7", "TZX28", "TX28", "TX31"],
    arg_notes: ["S13N6", "S30N6", "X30N6"],
    arg_corp: ["YMCXO", "TLC1O", "PNDCO", "YMCXD", "MGCOD", "VSCTD", "TSC4D"],
    usa_adrs: ["GGAL", "YPF", "PAM", "BMA", "TEO", "CEPU"]
  };
  return json((listas[tipo] || []).map((s) => {
    const r = rng(hash(tipo + s));
    const c = precioSintetico(tipo, s);
    return { symbol: s, c, pct_change: (r() - 0.5) * 6, v: Math.round(r() * 5e8), q_op: Math.round(r() * 3000), px_bid: c * 0.998, px_ask: c * 1.002, q_bid: 100, q_ask: 120 };
  }));
}

/* Merval de BYMA con el cambio de base del 19/10/2026: hasta el 16/10 en
   puntos del S&P Merval y desde el 19/10 en la base 100.000 de MSCI. La serie
   "verdadera" (en base nueva) es MERVAL_NUEVA; BYMA la publica cortada. */
export const SALTO_MERVAL = "2026-10-19", FACTOR_MERVAL = 28.4894527;
export const MERVAL_NUEVA = (() => {
  const dias = habiles(320).map(iso), r = rng(hash("merval"));
  let v = 1;
  const w = dias.map(() => (v *= 1 + (r() - 0.5) * 0.03));
  const iBase = dias.findLastIndex((d) => d < SALTO_MERVAL);
  return dias.map((d, i) => ({ d, c: (100000 * w[i]) / (iBase >= 0 ? w[iBase] : 1) }));
})();
function bymaIndice() {
  const filas = MERVAL_NUEVA.map((x) => ({ ...x, c: x.d < SALTO_MERVAL ? x.c * FACTOR_MERVAL : x.c }));
  return json({ s: "ok", t: filas.map((x) => Date.parse(`${x.d}T00:00:00Z`) / 1000), o: filas.map((x) => x.c), h: filas.map((x) => x.c * 1.004), l: filas.map((x) => x.c * 0.996), c: filas.map((x) => x.c), v: filas.map(() => 0) });
}

/* ------------------------------------------------------------- router */

/* Lo que hacen las fuentes reales con cada User-Agent (comprobado en
   noviembre de 2026): Yahoo responde 429 y FRED no responde a quien se
   presenta como un navegador completo; CNN exige uno de navegador; la SEC,
   uno con email de contacto. El fetch falso hace lo mismo, así un cambio que
   vuelva a mandar el agente equivocado rompe los tests. */
const cabecera = (init, nombre) => {
  const h = init?.headers || {};
  if (typeof h.get === "function") return h.get(nombre) || "";
  const k = Object.keys(h).find((x) => x.toLowerCase() === nombre.toLowerCase());
  return k ? String(h[k]) : "";
};
const pareceNavegador = (ua) => /Chrome\/|Firefox\/|Safari\//.test(ua);
/* Símbolos que Yahoo "no sirve" en los tests, para probar los respaldos, y
   un interruptor para simular a Yahoo caído del todo. */
export const YAHOO_CAIDO = new Set(["ETH-USD", "^VIX"]);
export const YAHOO_ABAJO = { activo: false };

/* Respaldos: Nasdaq (acciones, ETFs, índices COMP y NDX, cripto BTC y ETH),
   tipos del BCE (Frankfurter) y Kraken. */
const fechaUs = (t) => { const d = new Date(t * 1000); return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`; };
const NASDAQ_CLASES = { COMP: "index", NDX: "index", BTC: "crypto", ETH: "crypto" };
function nasdaqHistoria(sym, clase) {
  const valida = NASDAQ_CLASES[sym] ? NASDAQ_CLASES[sym] === clase : (clase === "stocks" || clase === "etf");
  if (sym.startsWith("NOEXISTE") || !valida) return json({ data: null, status: { rCode: 400, bCodeMessage: [{ code: 1001, errorMessage: "Symbol not exists." }] } });
  const filas = velas(`nasdaq:${sym}`, 500).reverse().map((x) => ({ date: fechaUs(x.t), close: `$${x.c.toFixed(2)}`, volume: String(x.v), open: `$${x.o.toFixed(2)}`, high: `$${x.h.toFixed(2)}`, low: `$${x.l.toFixed(2)}` }));
  return json({ data: { symbol: sym, tradesTable: { rows: filas } }, status: { rCode: 200 } });
}
export const BCE_BASE = { EUR: 0.9, JPY: 150, BRL: 5.5, CNY: 7.1, GBP: 0.78, CAD: 1.37, SEK: 10.5, CHF: 0.88 };
function frankfurter(desde) {
  const rates = {};
  habiles(560).map(iso).filter((d) => d >= desde).forEach((d, i) => { rates[d] = Object.fromEntries(Object.entries(BCE_BASE).map(([k, v]) => [k, v * (1 + 0.001 * Math.sin(i / 7))])); });
  return json({ amount: 1, base: "USD", rates });
}
export const KRAKEN_BASE = { PAXGUSD: 4000, XBTUSD: 70000, ETHUSD: 2000 };
function kraken(par) {
  if (!KRAKEN_BASE[par]) return json({ error: ["EQuery:Unknown asset pair"] });
  const hoy = Math.floor(Date.now() / 864e5) * 86400;
  const velasK = Array.from({ length: 720 }, (_, i) => { const t = hoy - (719 - i) * 86400, c = KRAKEN_BASE[par] * (1 + 0.05 * Math.sin(i / 30)); return [t, String(c), String(c * 1.01), String(c * 0.99), String(c), String(c), "10", 100]; });
  return json({ error: [], result: { [par]: velasK, last: hoy } });
}

async function falso(entrada, init = {}) {
  const url = new URL(typeof entrada === "string" ? entrada : entrada.url);
  const h = url.hostname, p = url.pathname;
  llamadas.push(url.href);
  const ua = cabecera(init, "user-agent");
  if (/yahoo\.com$/.test(h) && (pareceNavegador(ua) || YAHOO_ABAJO.activo)) return texto("Too Many Requests", 429);
  if (h === "api.nasdaq.com" && /^\/api\/quote\/[^/]+\/historical$/.test(p)) return nasdaqHistoria(decodeURIComponent(p.split("/")[3]), url.searchParams.get("assetclass"));
  if (h === "api.frankfurter.dev" && p.startsWith("/v1/")) return frankfurter(p.slice(4).replace(/\.\.$/, ""));
  if (h === "api.kraken.com" && p === "/0/public/OHLC") return kraken(url.searchParams.get("pair"));
  if (h === "fred.stlouisfed.org" && pareceNavegador(ua)) throw new TypeError("fetch failed (FRED no responde a agentes de navegador)");
  if (h === "production.dataviz.cnn.io" && !pareceNavegador(ua)) return texto("I'm a teapot. You're a bot.", 418);
  if (/sec\.gov$/.test(h) && !/@/.test(ua)) return texto("Undeclared Automated Tool", 403);
  if (/query\d\.finance\.yahoo\.com/.test(h) && p.startsWith("/v8/finance/chart/") && YAHOO_CAIDO.has(decodeURIComponent(p.split("/").pop()))) return texto("Too Many Requests", 429);

  if (h === "fc.yahoo.com" || h === "finance.yahoo.com") return new Response("", { status: 404, headers: { "set-cookie": "A3=d=sintetico; Path=/; Domain=.yahoo.com" } });
  if (/query\d\.finance\.yahoo\.com/.test(h)) {
    if (p.startsWith("/v8/finance/chart/")) return yahooChart(decodeURIComponent(p.split("/").pop()), url.searchParams.get("range"), url.searchParams.get("interval"));
    if (p === "/v1/test/getcrumb") return texto("crumbSintetico");
    if (p.startsWith("/v10/finance/quoteSummary/")) return quoteSummary(decodeURIComponent(p.split("/").pop()));
    if (p.startsWith("/v6/finance/recommendationsbysymbol/")) return json({ finance: { result: [{ recommendedSymbols: [{ symbol: "PAR1" }, { symbol: "PAR2" }] }] } });
    if (p === "/v1/finance/search") { const q = url.searchParams.get("q").toUpperCase(); return json({ quotes: [{ symbol: q, shortname: `Resultado sintético ${q}`, exchDisp: "SIM", quoteType: "EQUITY", typeDisp: "Acción" }, { symbol: `${q}.BA`, shortname: `Resultado sintético ${q} BYMA`, exchDisp: "Buenos Aires", quoteType: "EQUITY", typeDisp: "Acción" }] }); }
  }
  if (h === "www.sec.gov" && p === "/files/company_tickers.json") return json(Object.fromEntries(Object.entries(EMPRESAS).map(([t, [cik, nombre]], i) => [i, { cik_str: cik, ticker: t, title: nombre }])));
  if (h === "data.sec.gov") {
    const cik = Number((p.match(/CIK(\d+)/) || [])[1]);
    if (!porCik[cik]) return json({ error: "not found" }, 404);
    if (p.includes("/companyfacts/")) return companyFacts(cik);
    if (p.includes("/submissions/")) return submissions(cik);
  }
  if (h === "www.sec.gov" && p.startsWith("/Archives/")) {
    if (p.includes("form4")) return form4(p);
    if (p.includes("10k")) return documento10k(p);
    return texto("<html><body>Documento sintético</body></html>", 200, "text/html");
  }
  if (h === "api.nasdaq.com" && p === "/api/calendar/earnings") {
    const f = url.searchParams.get("date");
    const filas = hash(f) % 2 ? [
      { symbol: "PRUEBA", name: "Empresa de Prueba S.A.", marketCap: "$50,000,000,000", time: "time-after-hours", epsForecast: "$1.20", noOfEsts: "12", lastYearEPS: "$1.00", fiscalQuarterEnding: "Sep/2026" },
      { symbol: "GRANDE", name: "Grande Sintética Corp", marketCap: "$900,000,000,000", time: "time-pre-market", epsForecast: "$3.10", noOfEsts: "30", lastYearEPS: "$2.80", fiscalQuarterEnding: "Sep/2026" },
      { symbol: "CHICA", name: "Chica Sintética Inc", marketCap: "$900,000,000", time: "time-not-supplied", epsForecast: "$0.10", noOfEsts: "2", lastYearEPS: "$0.08", fiscalQuarterEnding: "Sep/2026" }
    ] : [];
    return json({ data: { rows: filas } });
  }
  if (h === "fred.stlouisfed.org") return fredCsv(url.searchParams.get("id"));
  if (h === "production.dataviz.cnn.io") return json({ fear_and_greed: { score: 62.4, rating: "greed", timestamp: new Date().toISOString(), previous_close: 60.1, previous_1_week: 55.2, previous_1_month: 47.9, previous_1_year: 70.3 } });
  if (h === "news.google.com") return rss();

  if (h === "dolarapi.com" && p === "/v1/dolares") return json(AR.dolarapi_dolares);
  if (h === "api.argentinadatos.com") {
    const m = p.match(/^\/v1\/cotizaciones\/dolares\/([a-z]+)$/);
    if (m) return AR[`ad_dolar_${m[1]}`] ? json(AR[`ad_dolar_${m[1]}`]) : json({ error: "no" }, 404);
    const rutas = {
      "/v1/finanzas/indices/riesgo-pais": "ad_riesgo", "/v1/finanzas/indices/inflacion": "ad_inflacion", "/v1/finanzas/indices/inflacionInteranual": "ad_inflacion_ia",
      "/v1/finanzas/rem/ultimo": "ad_rem", "/v1/finanzas/tasas/plazoFijo": "ad_plazofijo", "/v1/finanzas/tasas/depositos30Dias": "ad_dep30",
      "/v1/finanzas/fci/mercadoDinero/ultimo": "ad_fci_u", "/v1/finanzas/fci/mercadoDinero/penultimo": "ad_fci_p", "/v1/finanzas/letras": "ad_letras", "/v1/finanzas/bonos-cer": "ad_cer"
    };
    if (rutas[p]) return json(AR[rutas[p]]);
    if (p === "/v1/finanzas/cauciones/ars") return json([{ plazo: 1, montoContado: 4.2e11, tasaActual: 24.5, tasaMinDia: 23, tasaMaxDia: 26, fechaOperacion: iso(Date.now()) }, { plazo: 7, montoContado: 3e10, tasaActual: 25.1, tasaMinDia: 24, tasaMaxDia: 26.2, fechaOperacion: iso(Date.now()) }]);
  }
  if (h === "open.bymadata.com.ar" && p.endsWith("/chart/index-historical-series/history") && url.searchParams.get("symbol") === "M") return bymaIndice();
  if (h === "data912.com") {
    /* Desde noviembre de 2026 data912 devuelve estas listas vacías: la app calcula los implícitos con el panel. */
    if (p.startsWith("/live/mep") || p.startsWith("/live/ccl")) return json([]);
    if (p.startsWith("/live/")) return panelBYMA(p.split("/").pop());
    if (p.startsWith("/eod/volatilities/")) return json([{ iv_s_term: 0.42, iv_m_term: 0.39, iv_l_term: 0.37, iv_s_term_percentile: 0.71, iv_m_term_percentile: 0.64, iv_l_term_percentile: 0.55, hv_s_term: 0.35, hv_m_term: 0.36, hv_l_term: 0.38, hv_s_term_percentile: 0.5, hv_m_term_percentile: 0.52, hv_l_term_percentile: 0.6, iv_hv_s_ratio: 1.2, iv_hv_m_ratio: 1.08, iv_hv_l_ratio: 0.97, fair_iv: 0.38, iv_fair_iv_ratio: 1.03 }]);
    if (p.includes("NOEXISTE")) return json([]);
    const especieD = p.match(/\/historical\/bonds\/([A-Z]{2}\d{2})D$/);
    if (especieD && BONOS_USD[especieD[1]]) {
      const r = rng(hash(especieD[1]));
      return json(habiles(300).map((d, i) => ({ date: iso(d), c: BONOS_USD[especieD[1]] * (0.85 + 0.15 * (i / 300)) * (1 + (r() - 0.5) * 0.01) })));
    }
    if (p.startsWith("/historical/")) return json(velas(p.split("/").pop(), 300).map((x) => ({ date: iso(x.t * 1000), o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, dr: 0, sa: 0 })));
  }
  if (h === "api.bcra.gob.ar") {
    /* Series diarias (v4): límites de la banda cambiaria. */
    const serie = p.match(/\/Monetarias\/(\d+)$/);
    if (serie) {
      const valores = { 1187: 690, 1188: 1980, 30: CER_SINTETICO };
      const v = valores[serie[1]];
      if (!v) return json({ status: 404, errorMessages: ["sin serie"] }, 404);
      const paso = { 1188: 0.0006, 1187: -0.0006, 30: 0 }[serie[1]];
      return json({ status: 200, results: [{ idVariable: Number(serie[1]), detalle: habiles(40).map((d, i) => ({ fecha: iso(d), valor: v * (1 + paso * i) })) }] });
    }
    return json({ status: 200, results: [
      { idVariable: 1, descripcion: "Reservas internacionales (sintético)", categoria: "Principales Variables", ultFechaInformada: iso(Date.now()), ultValorInformado: 41000, unidadExpresion: "Millones de USD" },
      { idVariable: 7, descripcion: "Tasa BADLAR (sintético)", categoria: "Principales Variables", ultFechaInformada: iso(Date.now()), ultValorInformado: 21.5, unidadExpresion: "% TNA" }
    ] });
  }

  throw new TypeError(`fetch failed (sin fixture para ${url.href})`);
}

export function instalar() { globalThis.fetch = falso; }
instalar();
