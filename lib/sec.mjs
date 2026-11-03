import { cached, getJSON, getText, enParalelo, HttpError } from "./http.mjs";
import { normalizar, price, splitsDe } from "./precios.mjs";

/* -------------------------------------------------------- índice de la SEC */

export async function tickerMap() {
  return cached("sec:tickers", 24 * 3600e3, async () => {
    const json = await getJSON("https://www.sec.gov/files/company_tickers.json");
    const map = new Map();
    for (const e of Object.values(json)) {
      const t = String(e.ticker).toUpperCase();
      map.set(t, { cik: String(e.cik_str).padStart(10, "0"), name: e.title, ticker: t });
    }
    return map;
  });
}

/* Los tickers locales de BYMA no coinciden siempre con el ADR que presenta
   balances en la SEC. Para un CEDEAR (AAPL.BA) alcanza con quitar el sufijo. */
const ADR_DE_BYMA = {
  YPFD: "YPF", PAMP: "PAM", TGSU2: "TGS", TECO2: "TEO", CRES: "CRESY", IRSA: "IRS",
  GGAL: "GGAL", BMA: "BMA", SUPV: "SUPV", BBAR: "BBAR", CEPU: "CEPU", LOMA: "LOMA", EDN: "EDN", VIST: "VIST"
};

export async function empresa(ticker) {
  const map = await tickerMap();
  const { crudo } = normalizar(ticker);
  const local = crudo.replace(/\.BA$/, "");
  const base = ADR_DE_BYMA[local] || local;
  for (const c of [base, base.replace(/\./g, "-"), base.replace(/-/g, ".")]) {
    const co = map.get(c);
    /* Si se pidió el ticker de BYMA (ADR local o CEDEAR), precio y splits se
       toman del que cotiza en EE.UU., en la misma moneda que los estados. */
    if (co) return { ...co, viaAdr: base !== local || crudo.endsWith(".BA") ? co.ticker : null };
  }
  throw new HttpError(`${crudo} no figura en el índice de la SEC. Solo están las empresas que presentan balances en EE.UU. (incluye ADRs argentinos como YPF, GGAL, PAM o BMA).`, 404);
}

export async function buscarSec(q) {
  const map = await tickerMap();
  const Q = q.trim().toUpperCase();
  if (Q.length < 2) return [];
  const out = [];
  for (const co of map.values()) {
    if (co.ticker === Q || co.ticker.startsWith(Q) || co.name.toUpperCase().includes(Q)) {
      out.push({ ticker: co.ticker, nombre: co.name, bolsa: "EE.UU. (SEC)", tipo: "Acción", peso: co.ticker === Q ? 0 : co.ticker.startsWith(Q) ? 1 : 2 });
    }
    if (out.length > 60) break;
  }
  return out.sort((a, b) => a.peso - b.peso).slice(0, 8);
}

async function submissions(cik) {
  return cached(`sec:sub:${cik}`, 3 * 3600e3, () => getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`));
}

const urlDoc = (cik, accn, doc) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${doc}`;

/* ------------------------------------------------------- texto del 10-K */

const strip = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
  .replace(/<br[^>]*>/gi, "\n")
  .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
  .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&#8217;|&rsquo;/gi, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, "\"")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/[ \t ]+/g, " ")
  .replace(/\n[ \t]+/g, "\n")
  .replace(/\n{3,}/g, "\n\n");

/* El índice del 10-K también dice "Item 1A ... Item 1B", así que el primer
   match casi siempre es esa línea. Nos quedamos con el fragmento más largo.
   Los 20-F (empresas extranjeras, como los ADRs argentinos) ponen los riesgos
   en el Item 3.D. */
const PATRONES_RIESGO = [
  /item\s*1A[.\s—–:-]*risk\s*factors([\s\S]*?)item\s*1B[.\s—–:-]*unresolved/gi,
  /item\s*1A[.\s—–:-]*risk\s*factors([\s\S]*?)item\s*1C[.\s—–:-]*cybersecurity/gi,
  /item\s*1A[.\s—–:-]*risk\s*factors([\s\S]*?)item\s*1B[.\s—–:-]/gi,
  /item\s*1A[.\s—–:-]*risk\s*factors([\s\S]*?)item\s*2[.\s—–:-]*propert/gi,
  /risk\s*factors([\s\S]*?)unresolved\s*staff\s*comments/gi,
  /D\.\s*risk\s*factors([\s\S]*?)item\s*4[.\s—–:-]*information\s*on\s*the\s*company/gi,
  /risk\s*factors([\s\S]*?)item\s*4[.\s—–:-]*information\s*on\s*the\s*company/gi
];

async function seccionRiesgos(url) {
  return cached(`sec:1a:${url}`, 24 * 3600e3, async () => {
    const text = strip((await getText(url, { timeout: 60000 })).slice(0, 25_000_000));
    let section = "";
    for (const re of PATRONES_RIESGO) {
      for (const m of text.matchAll(re)) if (m[1].length > section.length) section = m[1];
    }
    return section;
  });
}

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

/* Temas para ordenar la lectura. Un párrafo puede tener varios. */
const TEMAS = {
  "Clientes": /\bcustomer(s)?\b.*\b(concentrat|significant portion|percent|%)|\bone customer\b/i,
  "Proveedores": /\bsupplier|\bsole source|\bsingle source|\bmanufactur|\bfoundry|\bsupply chain/i,
  "Geopolítica": /\bChina\b|\bTaiwan\b|\bexport control|\bsanction|\btariff|\bgeopolitic|\bwar\b|\bconflict/i,
  "Regulación": /\bregulat|\bantitrust|\bcompliance|\bgovernment(al)? (approval|investigation)|\blegislation/i,
  "Competencia": /\bcompetit|\bmarket share|\bnew entrants|\bpricing pressure/i,
  "Tecnología": /\btechnolog|\bcybersecurity|\bdata breach|\bartificial intelligence|\bAI\b|\bplatform/i,
  "Financiero": /\bindebtedness|\bdebt\b|\bliquidity|\bcredit facility|\binterest rate|\bcurrency|\bexchange rate|\binflation/i,
  "Legal": /\blitigation|\blawsuit|\bclass action|\bintellectual property|\bpatent/i,
  "Macro Argentina": /\bArgentin|\bpeso\b|\bBCRA\b|\bcapital controls|\bdevaluation/i
};

function parrafos(text) {
  const crudos = text.split(/\n{2,}|(?<=\.)\s{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  /* Los títulos de cada riesgo suelen venir en un párrafo corto propio, seguido
     del desarrollo. Los unimos para no perderlos. */
  const out = [];
  for (let i = 0; i < crudos.length; i++) {
    const p = crudos[i], sig = crudos[i + 1];
    if (p.length >= 30 && p.length <= 400 && sig && sig.length > 200 && !/^\(?[a-z]/.test(p)) {
      out.push({ titulo: p.replace(/\s*\.$/, "."), texto: sig });
      i++;
    } else if (p.length > 200) {
      out.push({ titulo: null, texto: p });
    }
  }
  return out.filter((x) => x.texto.length < 8000);
}

const palabras = (s) => new Set(String(s).toLowerCase().match(/[a-z]{4,}/g) || []);
function parecido(a, b) {
  let comun = 0;
  for (const w of a) if (b.has(w)) comun++;
  return comun / (a.size + b.size - comun || 1);
}

export function classifyRisks(text) {
  return parrafos(text).slice(0, 160).map(({ titulo, texto }) => {
    const p = `${titulo || ""} ${texto}`;
    const low = p.toLowerCase();
    const generic = GENERIC.filter((g) => low.includes(g));
    const signals = SPECIFIC.filter((re) => re.test(p)).length;
    const heading = titulo || (texto.match(/^([^.]{15,160}\.)/) || [null, texto.slice(0, 140)])[1];
    return {
      heading: heading.trim(),
      text: texto,
      kind: signals >= 1 ? "especifico" : generic.length >= 2 ? "generico" : "mixto",
      signals,
      temas: Object.entries(TEMAS).filter(([, re]) => re.test(p)).map(([t]) => t),
      genericHits: generic.slice(0, 4)
    };
  });
}

export async function riskFactors(ticker) {
  const co = await empresa(ticker);
  const sub = await submissions(co.cik);
  const r = sub.filings.recent;
  const anuales = [];
  for (let i = 0; i < r.form.length && anuales.length < 2; i++) {
    if (["10-K", "20-F", "40-F"].includes(r.form[i])) anuales.push(i);
  }
  if (!anuales.length) throw new HttpError(`No encontré un 10-K ni un 20-F reciente para ${co.ticker}`, 404);

  const idx = anuales[0];
  const url = urlDoc(co.cik, r.accessionNumber[idx], r.primaryDocument[idx]);
  const section = await seccionRiesgos(url);
  if (section.length < 3000) {
    throw new HttpError(`Encontré el ${r.form[idx]} pero no pude aislar la sección de riesgos (quedó en ${section.length} caracteres). Abrilo a mano: ${url}`, 422);
  }
  const risks = classifyRisks(section);

  /* Comparación con el informe anterior: un riesgo nuevo o uno que desaparece
     suele decir más que cualquiera de los que se repiten todos los años. */
  let comparado = null;
  if (anuales[1] !== undefined) {
    try {
      const urlPrev = urlDoc(co.cik, r.accessionNumber[anuales[1]], r.primaryDocument[anuales[1]]);
      const prev = classifyRisks(await seccionRiesgos(urlPrev));
      if (prev.length > 5) {
        const P = prev.map((x) => palabras(x.heading));
        const C = risks.map((x) => palabras(x.heading));
        risks.forEach((x, i) => { x.nuevo = Math.max(0, ...P.map((p) => parecido(C[i], p))) < 0.45; });
        const eliminados = prev.filter((_, j) => Math.max(0, ...C.map((c) => parecido(P[j], c))) < 0.45).map((x) => x.heading).slice(0, 15);
        comparado = { filed: r.filingDate[anuales[1]], url: urlPrev, nuevos: risks.filter((x) => x.nuevo).length, eliminados };
      }
    } catch { /* sin comparación, el resto sirve igual */ }
  }

  return {
    company: co.name, cik: co.cik, ticker: co.ticker, viaAdr: co.viaAdr,
    form: r.form[idx], filed: r.filingDate[idx], period: r.reportDate[idx],
    url, chars: section.length, risks, comparado
  };
}

/* ------------------------------------------------- filings e insiders */

const FORMULARIOS = {
  "10-K": "Informe anual", "10-K/A": "Informe anual (enmienda)", "10-Q": "Informe trimestral", "8-K": "Hecho relevante",
  "20-F": "Informe anual (emisor extranjero)", "6-K": "Hecho relevante (emisor extranjero)", "40-F": "Informe anual (Canadá)",
  "4": "Operación de un insider", "3": "Alta de un insider", "5": "Resumen anual de insider", "144": "Aviso de venta de un insider",
  "DEF 14A": "Proxy de la asamblea", "SC 13G": "Participación mayor al 5% (pasiva)", "SC 13G/A": "Participación mayor al 5% (pasiva, actualización)",
  "SC 13D": "Participación mayor al 5% (activa)", "SC 13D/A": "Participación mayor al 5% (activa, actualización)",
  "S-1": "Registro de oferta", "S-3": "Registro de oferta (simplificado)", "S-8": "Plan de acciones para empleados",
  "424B2": "Prospecto de emisión", "424B5": "Prospecto de emisión", "11-K": "Plan de ahorro de empleados", "SD": "Minerales de conflicto"
};
const ITEMS_8K = {
  "1.01": "Acuerdo relevante", "1.02": "Fin de un acuerdo relevante", "1.05": "Incidente de ciberseguridad",
  "2.01": "Compra o venta de activos", "2.02": "Resultados del período", "2.03": "Nueva deuda", "2.05": "Reestructuración",
  "2.06": "Deterioro de activos", "3.01": "Aviso de exclusión de cotización", "3.02": "Venta de acciones no registrada",
  "4.01": "Cambio de auditor", "4.02": "Estados financieros previos no confiables", "5.02": "Cambios en directorio o gerencia",
  "5.03": "Cambio de estatuto", "5.07": "Votación de accionistas", "7.01": "Comunicación al mercado", "8.01": "Otros hechos", "9.01": "Estados y anexos"
};
const ITEMS_CRITICOS = new Set(["1.05", "2.06", "3.01", "4.01", "4.02", "2.05"]);

export async function filings(ticker) {
  const co = await empresa(ticker);
  const sub = await submissions(co.cik);
  const r = sub.filings.recent;
  const lista = [];
  for (let i = 0; i < r.form.length && lista.length < 60; i++) {
    const items = String(r.items?.[i] || "").split(",").map((x) => x.trim()).filter(Boolean);
    lista.push({
      form: r.form[i],
      descripcion: FORMULARIOS[r.form[i]] || r.primaryDocDescription?.[i] || r.form[i],
      fecha: r.filingDate[i],
      periodo: r.reportDate?.[i] || null,
      items: items.map((x) => ({ codigo: x, texto: ITEMS_8K[x] || x, critico: ITEMS_CRITICOS.has(x) })),
      url: urlDoc(co.cik, r.accessionNumber[i], r.primaryDocument[i])
    });
  }
  return { empresa: co.name, ticker: co.ticker, cik: co.cik, viaAdr: co.viaAdr, sic: sub.sicDescription || null, filings: lista };
}

const CODIGOS_F4 = {
  P: "Compra en mercado", S: "Venta en mercado", A: "Otorgamiento", M: "Ejercicio de opciones", F: "Retención impositiva",
  G: "Donación", C: "Conversión", D: "Devolución al emisor", J: "Otra", X: "Ejercicio de opciones", W: "Herencia"
};

function parseForm4(xml) {
  const val = (bloque, tag) => {
    const m = bloque.match(new RegExp(`<${tag}>\\s*(?:<value>)?\\s*([^<]*?)\\s*(?:</value>)?\\s*(?:<footnoteId[^>]*/>\\s*)*</${tag}>`, "i"));
    return m ? m[1].trim() : null;
  };
  const dueno = xml.match(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/i)?.[1] || "";
  const rel = [];
  if (/<isDirector>\s*(1|true)/i.test(dueno)) rel.push("Director");
  if (/<isOfficer>\s*(1|true)/i.test(dueno)) rel.push(val(dueno, "officerTitle") || "Ejecutivo");
  if (/<isTenPercentOwner>\s*(1|true)/i.test(dueno)) rel.push("Accionista >10%");
  const planificada = /<aff10b5One>\s*(1|true)/i.test(xml);
  const tx = [...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)].map((m) => {
    const b = m[1];
    const acciones = Number(val(b, "transactionShares")) || 0;
    const precio = Number(val(b, "transactionPricePerShare")) || 0;
    const codigo = (b.match(/<transactionCode>\s*([A-Z])\s*</i) || [])[1] || "?";
    return {
      fecha: val(b, "transactionDate"),
      codigo,
      tipo: CODIGOS_F4[codigo] || codigo,
      acciones,
      precio,
      monto: acciones * precio,
      sentido: val(b, "transactionAcquiredDisposedCode"),
      tenenciaPosterior: Number(val(b, "sharesOwnedFollowingTransaction")) || null
    };
  });
  return { nombre: val(dueno, "rptOwnerName") || "—", relacion: rel.join(" · ") || "—", planificada, tx };
}

export async function insiders(ticker) {
  const co = await empresa(ticker);
  return cached(`sec:f4:${co.cik}`, 6 * 3600e3, async () => {
    const sub = await submissions(co.cik);
    const r = sub.filings.recent;
    const idx = [];
    for (let i = 0; i < r.form.length && idx.length < 30; i++) if (r.form[i] === "4") idx.push(i);
    if (!idx.length) return { empresa: co.name, ticker: co.ticker, operaciones: [], resumen: null, aviso: "No hay formularios 4 recientes (los emisores extranjeros no están obligados a presentarlos)." };

    const res = await enParalelo(idx, 4, async (i) => {
      const doc = String(r.primaryDocument[i]).replace(/^xsl[^/]+\//, "");
      const xml = await getText(urlDoc(co.cik, r.accessionNumber[i], doc), { timeout: 15000 });
      const f = parseForm4(xml);
      return { ...f, presentado: r.filingDate[i], url: urlDoc(co.cik, r.accessionNumber[i], r.primaryDocument[i]) };
    });
    const operaciones = [];
    for (const x of res) {
      if (!x.ok) continue;
      for (const t of x.valor.tx) operaciones.push({ ...t, nombre: x.valor.nombre, relacion: x.valor.relacion, planificada: x.valor.planificada, presentado: x.valor.presentado, url: x.valor.url });
    }
    operaciones.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const compras = operaciones.filter((o) => o.codigo === "P");
    const ventas = operaciones.filter((o) => o.codigo === "S");
    const suma = (a) => a.reduce((s, o) => s + o.monto, 0);
    return {
      empresa: co.name, ticker: co.ticker,
      operaciones,
      leidos: res.filter((x) => x.ok).length,
      resumen: {
        compras: compras.length, montoCompras: suma(compras),
        ventas: ventas.length, montoVentas: suma(ventas),
        ventasPlanificadas: ventas.filter((o) => o.planificada).length,
        compradores: new Set(compras.map((o) => o.nombre)).size,
        vendedores: new Set(ventas.map((o) => o.nombre)).size,
        desde: operaciones.at(-1)?.fecha || null, hasta: operaciones[0]?.fecha || null
      }
    };
  });
}

/* --------------------------------------------------- estados (XBRL) */

/* La SEC publica los estados financieros etiquetados. Un mismo concepto
   aparece con distintas etiquetas según la empresa, el año y la norma (US
   GAAP o IFRS para emisores extranjeros), así que cada métrica lleva su lista
   de alternativas en orden de preferencia. */
const TAGS = {
  ingresos: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenue", "RevenueFromContractsWithCustomers"],
  costoVentas: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfSales"],
  brutoDirecto: ["GrossProfit"],
  operativo: ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"],
  neto: ["NetIncomeLoss", "ProfitLossAttributableToOwnersOfParent", "ProfitLoss"],
  bpa: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "DilutedEarningsLossPerShare", "BasicAndDilutedEarningsLossPerShare", "EarningsPerShareBasic", "BasicEarningsLossPerShare"],
  id: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  sbc: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
  cfo: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations", "CashFlowsFromUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", "PurchaseOfPropertyPlantAndEquipment"],
  recompras: ["PaymentsForRepurchaseOfCommonStock", "PaymentsToAcquireOrRedeemEntitysShares"],
  dividendos: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends", "DividendsPaidClassifiedAsFinancingActivities"],
  amortizacion: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "DepreciationAndAmortisationExpense"],
  activos: ["Assets"],
  patrimonio: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "EquityAttributableToOwnersOfParent", "Equity"],
  caja: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashAndCashEquivalents"],
  inversionesCorto: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"],
  deudaLargo: ["LongTermDebtNoncurrent", "LongTermDebt", "LongtermBorrowings", "NoncurrentPortionOfNoncurrentBorrowings"],
  deudaCorto: ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings", "ShorttermBorrowings", "CurrentPortionOfLongtermBorrowings"],
  intereses: ["InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating", "InterestIncomeExpenseNet", "FinanceCosts"],
  acciones: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted", "AdjustedWeightedAverageShares", "WeightedAverageShares"],
  impuestos: ["IncomeTaxExpenseBenefit", "IncomeTaxExpenseContinuingOperations"],
  antesImpuestos: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "ProfitLossBeforeTax"]
};
/* Líneas de los tres estados financieros. signo -1: se muestra como salida
   (las etiquetas XBRL de pagos vienen en positivo). calc: se deriva de otras
   líneas cuando la empresa no informa el total. */
const ESTADOS = {
  resultados: [
    { k: "ingresos", t: "Ingresos", tags: TAGS.ingresos, total: true },
    { k: "costoVentas", t: "Costo de ventas", tags: TAGS.costoVentas, signo: -1 },
    { k: "bruto", t: "Resultado bruto", tags: TAGS.brutoDirecto, calc: (v) => (v.ingresos !== null && v.costoVentas !== null ? v.ingresos + v.costoVentas : null), total: true },
    { k: "id", t: "Investigación y desarrollo", tags: TAGS.id, signo: -1 },
    { k: "gav", t: "Gastos de comercialización y administración", tags: ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"], signo: -1 },
    { k: "gastosOperativos", t: "Gastos operativos totales", tags: ["OperatingExpenses"], signo: -1 },
    { k: "operativo", t: "Resultado operativo", tags: TAGS.operativo, total: true },
    { k: "intereses", t: "Intereses pagados", tags: ["InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating", "FinanceCosts"], signo: -1 },
    { k: "otros", t: "Otros resultados no operativos", tags: ["NonoperatingIncomeExpense", "OtherNonoperatingIncomeExpense"] },
    { k: "antesImpuestos", t: "Resultado antes de impuestos", tags: TAGS.antesImpuestos, total: true },
    { k: "impuestos", t: "Impuesto a las ganancias", tags: TAGS.impuestos, signo: -1 },
    { k: "neto", t: "Resultado neto", tags: TAGS.neto, total: true },
    { k: "bpaBasico", t: "BPA básico", tags: ["EarningsPerShareBasic", "BasicEarningsLossPerShare"], tipo: "bpa" },
    { k: "bpa", t: "BPA diluido", tags: TAGS.bpa, tipo: "bpa" },
    { k: "acciones", t: "Acciones diluidas promedio", tags: TAGS.acciones, tipo: "acciones", sinVertical: true },
    { k: "amortizacion", t: "Depreciación y amortización", tags: TAGS.amortizacion, oculta: true },
    { k: "ebitda", t: "EBITDA (calculado)", calc: (v) => (v.operativo !== null ? v.operativo + (v.amortizacion ? Math.abs(v.amortizacion) : 0) : null), total: true }
  ],
  balance: [
    { k: "caja", t: "Caja y equivalentes", tags: TAGS.caja, instante: true },
    { k: "inversionesCorto", t: "Inversiones de corto plazo", tags: TAGS.inversionesCorto, instante: true },
    { k: "creditos", t: "Créditos por ventas", tags: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent", "TradeAndOtherCurrentReceivables"], instante: true },
    { k: "inventarios", t: "Inventarios", tags: ["InventoryNet", "Inventories"], instante: true },
    { k: "otrosCorrientes", t: "Otros activos corrientes", tags: ["OtherAssetsCurrent", "PrepaidExpenseAndOtherAssetsCurrent"], instante: true },
    { k: "activoCorriente", t: "Activo corriente", tags: ["AssetsCurrent", "CurrentAssets"], instante: true, total: true },
    { k: "ppe", t: "Propiedad, planta y equipo", tags: ["PropertyPlantAndEquipmentNet", "PropertyPlantAndEquipment"], instante: true },
    { k: "llave", t: "Llave de negocio (goodwill)", tags: ["Goodwill"], instante: true },
    { k: "intangibles", t: "Intangibles", tags: ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet", "IntangibleAssetsOtherThanGoodwill"], instante: true },
    { k: "inversionesLargo", t: "Inversiones de largo plazo", tags: ["LongTermInvestments", "MarketableSecuritiesNoncurrent", "AvailableForSaleSecuritiesDebtSecuritiesNoncurrent"], instante: true },
    { k: "otrosNoCorrientes", t: "Otros activos no corrientes", tags: ["OtherAssetsNoncurrent"], instante: true },
    { k: "activoNoCorriente", t: "Activo no corriente", tags: ["AssetsNoncurrent", "NoncurrentAssets"], instante: true, calc: (v) => (v.activo !== null && v.activoCorriente !== null ? v.activo - v.activoCorriente : null), total: true },
    { k: "activo", t: "Activo total", tags: TAGS.activos, instante: true, total: true, separador: true },
    { k: "proveedores", t: "Deudas comerciales", tags: ["AccountsPayableCurrent", "TradeAndOtherCurrentPayables"], instante: true },
    { k: "devengados", t: "Pasivos devengados", tags: ["AccruedLiabilitiesCurrent", "EmployeeRelatedLiabilitiesCurrent"], instante: true },
    { k: "deudaCorto", t: "Deuda financiera de corto plazo", tags: TAGS.deudaCorto, instante: true },
    { k: "ingresosDiferidos", t: "Ingresos diferidos", tags: ["ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"], instante: true },
    { k: "pasivoCorriente", t: "Pasivo corriente", tags: ["LiabilitiesCurrent", "CurrentLiabilities"], instante: true, total: true },
    { k: "deudaLargo", t: "Deuda financiera de largo plazo", tags: TAGS.deudaLargo, instante: true },
    { k: "otrosPasivosNoCorrientes", t: "Otros pasivos no corrientes", tags: ["OtherLiabilitiesNoncurrent"], instante: true },
    { k: "pasivoYPatrimonio", t: "Pasivo + patrimonio", tags: ["LiabilitiesAndStockholdersEquity", "EquityAndLiabilities"], instante: true, oculta: true },
    { k: "patrimonioTotal", t: "Patrimonio con minoritarios", tags: ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "Equity"], instante: true, oculta: true },
    { k: "pasivo", t: "Pasivo total", tags: ["Liabilities"], instante: true, calc: (v) => (v.pasivoYPatrimonio !== null && (v.patrimonioTotal ?? v.patrimonio) !== null ? v.pasivoYPatrimonio - (v.patrimonioTotal ?? v.patrimonio) : null), total: true },
    { k: "resultadosAcumulados", t: "Resultados acumulados", tags: ["RetainedEarningsAccumulatedDeficit", "RetainedEarnings"], instante: true },
    { k: "patrimonio", t: "Patrimonio neto", tags: TAGS.patrimonio, instante: true, total: true, separador: true },
    { k: "liquidez", t: "Liquidez corriente (veces)", ratio: true, calc: (v) => (v.activoCorriente && v.pasivoCorriente ? v.activoCorriente / v.pasivoCorriente : null) },
    { k: "acida", t: "Prueba ácida (veces)", ratio: true, calc: (v) => (v.activoCorriente && v.pasivoCorriente ? (v.activoCorriente - (v.inventarios || 0)) / v.pasivoCorriente : null) },
    { k: "endeudamiento", t: "Deuda financiera / patrimonio (veces)", ratio: true, calc: (v) => (v.patrimonio > 0 ? ((v.deudaCorto || 0) + (v.deudaLargo || 0)) / v.patrimonio : null) }
  ],
  flujo: [
    { k: "neto", t: "Resultado neto", tags: TAGS.neto },
    { k: "amortizacion", t: "Depreciación y amortización", tags: TAGS.amortizacion },
    { k: "sbc", t: "Remuneración en acciones", tags: TAGS.sbc },
    { k: "otrosAjustes", t: "Capital de trabajo y otros ajustes", calc: (v) => (v.cfo !== null && v.neto !== null ? v.cfo - v.neto - (v.amortizacion || 0) - (v.sbc || 0) : null) },
    { k: "cfo", t: "Flujo de las operaciones", tags: TAGS.cfo, total: true },
    { k: "capex", t: "Inversiones en bienes de uso (capex)", tags: TAGS.capex, signo: -1 },
    { k: "adquisiciones", t: "Adquisiciones de empresas", tags: ["PaymentsToAcquireBusinessesNetOfCashAcquired"], signo: -1 },
    { k: "cfi", t: "Flujo de inversión", tags: ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations", "CashFlowsFromUsedInInvestingActivities"], total: true },
    { k: "dividendos", t: "Dividendos pagados", tags: TAGS.dividendos, signo: -1 },
    { k: "recompras", t: "Recompra de acciones", tags: TAGS.recompras, signo: -1 },
    { k: "emisionDeuda", t: "Nueva deuda", tags: ["ProceedsFromIssuanceOfLongTermDebt", "ProceedsFromIssuanceOfDebt"] },
    { k: "pagoDeuda", t: "Cancelación de deuda", tags: ["RepaymentsOfLongTermDebt", "RepaymentsOfDebt"], signo: -1 },
    { k: "cff", t: "Flujo de financiación", tags: ["NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations", "CashFlowsFromUsedInFinancingActivities"], total: true },
    { k: "variacionCaja", t: "Variación de caja", tags: ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect", "CashAndCashEquivalentsPeriodIncreaseDecrease", "IncreaseDecreaseInCashAndCashEquivalents"], total: true },
    { k: "fcf", t: "Flujo de caja libre (calculado)", calc: (v) => (v.cfo !== null && v.capex !== null ? v.cfo - Math.abs(v.capex) : null), total: true, separador: true }
  ]
};

const TIPO = { bpa: "bpa", acciones: "acciones" };
const INSTANTES = new Set(["activos", "patrimonio", "caja", "inversionesCorto", "deudaLargo", "deudaCorto"]);

/* El archivo de una empresa grande pesa decenas de MB con miles de
   etiquetas; en memoria quedan solo las que se usan. */
const ETIQUETAS_USADAS = new Set([...Object.values(TAGS).flat(), ...Object.values(ESTADOS).flat().flatMap((l) => l.tags || [])]);

async function hechosDe(cik) {
  return cached(`xbrl:${cik}`, 6 * 3600e3, async () => {
    const j = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { timeout: 60000 });
    const f = j.facts || {};
    const todos = {};
    for (const ns of ["ifrs-full", "us-gaap"]) {
      for (const [k, v] of Object.entries(f[ns] || {})) if (ETIQUETAS_USADAS.has(k)) todos[k] = v;
    }
    const acciones = f.dei?.EntityCommonStockSharesOutstanding;
    return { todos, dei: acciones ? { EntityCommonStockSharesOutstanding: acciones } : {} };
  });
}

/* Emisor extranjero: presenta 20-F o 40-F. Si cotiza en EE.UU. como ADR, un
   certificado puede representar varias acciones (GGAL: 10, PAM: 25), y los
   múltiplos calculados con acciones ordinarias quedan desplazados por esa
   relación. */
const esExtranjera = (P) => [...(P.ingresos || []), ...(P.neto || [])].some((p) => /^(20-F|40-F)/.test(p.form || ""));
const AVISO_ADR = "Emisor extranjero (20-F): si el precio corresponde a un ADR que representa varias acciones, la capitalización y el PER quedan multiplicados o divididos por esa relación. Verificá el ratio del ADR antes de usar estos múltiplos.";

function unidad(f, tipo) {
  const u = f?.units || {};
  const ks = Object.keys(u);
  if (tipo === "acciones") return u.shares ? ["shares", u.shares] : null;
  if (tipo === "bpa") {
    const k = ks.find((x) => x === "USD/shares") || ks.find((x) => /\/shares$/.test(x));
    return k ? [k.split("/")[0], u[k]] : null;
  }
  const k = ks.find((x) => x === "USD") || ks.find((x) => /^[A-Z]{3}$/.test(x));
  return k ? [k, u[k]] : null;
}

const dias = (a, b) => (new Date(b) - new Date(a)) / 864e5;

/* Todos los hechos de una métrica, uno por período (inicio|fin). Para cada
   período gana la etiqueta más preferida que lo reporte, y dentro de ella la
   presentación más reciente (que trae los valores reexpresados). Se guarda
   también la primera fecha en que el dato fue público: el PER histórico tiene
   que usar lo que se sabía cada día, no lo que se supo después. */
export function puntos(facts, nombres, tipo = "moneda") {
  const porClave = new Map();
  let moneda = null;
  for (const nombre of nombres) {
    const par = unidad(facts?.[nombre], tipo);
    if (!par) continue;
    const [u, lista] = par;
    const propios = new Map();
    for (const d of lista) {
      if (d.val === undefined || d.val === null || !d.end) continue;
      const clave = `${d.start || ""}|${d.end}`;
      const prev = propios.get(clave);
      if (!prev) propios.set(clave, { start: d.start || null, end: d.end, val: d.val, filed: d.filed, primerFiled: d.filed, form: d.form });
      else {
        if (d.filed < prev.primerFiled) prev.primerFiled = d.filed;
        if (d.filed >= prev.filed) Object.assign(prev, { val: d.val, filed: d.filed, form: d.form });
      }
    }
    for (const [k, v] of propios) {
      if (!porClave.has(k)) { porClave.set(k, v); if (!moneda && tipo !== "acciones") moneda = u; }
    }
  }
  const out = [...porClave.values()].map((p) => ({ ...p, dur: p.start ? dias(p.start, p.end) : null }));
  out.moneda = moneda;
  return out;
}

/* Ajusta por splits posteriores a la presentación: la SEC conserva el valor
   tal cual se presentó, y un BPA de antes de un split 10:1 es diez veces el
   comparable de hoy. */
function factorSplit(filed, splits) {
  let f = 1;
  for (const s of splits || []) if (s.d > filed && s.factor > 0) f *= s.factor;
  return f;
}
/* Se aplica al leer cada hecho, antes de reconstruir trimestres: restar un
   anual reexpresado menos trimestres sin reexpresar daría cualquier cosa. */
export function ajustarPuntos(pts, tipo, splits) {
  if ((tipo !== "bpa" && tipo !== "acciones") || !splits?.length) return pts;
  const out = pts.map((p) => {
    const f = factorSplit(p.filed, splits);
    return f === 1 ? p : { ...p, val: tipo === "bpa" ? p.val / f : p.val * f };
  });
  out.moneda = pts.moneda;
  return out;
}

export function anuales(pts) {
  const m = new Map();
  for (const p of pts) if (p.dur !== null && p.dur >= 300 && p.dur <= 400) m.set(p.end, p);
  return m;
}

/* Trimestres discretos. Los 10-Q informan el estado de resultados por
   trimestre, pero el flujo de fondos es acumulado en el año (3, 6, 9 meses).
   Se reconstruye cada trimestre restando acumulados consecutivos que
   comparten fecha de inicio; el cuarto sale del anual menos nueve meses. */
export function trimestres(pts, { derivar = true } = {}) {
  const q = new Map();
  for (const p of pts) if (p.dur !== null && p.dur >= 80 && p.dur <= 100) q.set(p.end, { ...p });
  if (!derivar) return new Map([...q.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  const porInicio = new Map();
  for (const p of pts) {
    if (p.dur === null || p.dur < 80 || p.dur > 400) continue;
    if (!porInicio.has(p.start)) porInicio.set(p.start, []);
    porInicio.get(p.start).push(p);
  }
  for (const grupo of porInicio.values()) {
    grupo.sort((a, b) => a.end.localeCompare(b.end));
    for (let i = 1; i < grupo.length; i++) {
      const a = grupo[i - 1], b = grupo[i];
      const salto = b.dur - a.dur;
      if (salto < 80 || salto > 100 || q.has(b.end)) continue;
      q.set(b.end, {
        start: a.end, end: b.end, val: b.val - a.val, dur: salto,
        filed: b.filed > a.filed ? b.filed : a.filed, primerFiled: b.primerFiled, derivado: true
      });
    }
  }
  /* Si no hay acumulado de nueve meses, el cuarto trimestre sale del anual
     menos los tres trimestres que caen dentro del mismo ejercicio. */
  for (const a of pts) {
    if (a.dur === null || a.dur < 340 || a.dur > 390 || q.has(a.end)) continue;
    const dentro = [...q.values()].filter((x) => x.end > a.start && x.end < a.end && x.start >= a.start && dias(a.start, x.start) >= -5);
    if (dentro.length !== 3) continue;
    const sumaTres = dentro.reduce((s, x) => s + x.val, 0);
    const ultimo = dentro.reduce((m, x) => (x.end > m.end ? x : m));
    q.set(a.end, { start: ultimo.end, end: a.end, val: a.val - sumaTres, dur: dias(ultimo.end, a.end), filed: a.filed, primerFiled: a.primerFiled, derivado: true });
  }
  return new Map([...q.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function instantes(pts) {
  const m = new Map();
  for (const p of pts) if (p.dur === null) m.set(p.end, p);
  return new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

const cercano = (mapa, fecha, tol = 12) => {
  if (!mapa) return null;
  if (mapa.has(fecha)) return mapa.get(fecha);
  for (const [k, v] of mapa) if (Math.abs(dias(k, fecha)) <= tol) return v;
  return null;
};

/* Últimos cuatro trimestres consecutivos que terminan en `fin`. */
function ultimosCuatro(qmap, fin) {
  const ends = [...qmap.keys()].filter((e) => e <= fin).slice(-4);
  if (ends.length < 4) return null;
  const span = dias(ends[0], ends[3]);
  if (span < 250 || span > 300) return null;
  return ends;
}

/* Acciones en circulación de la carátula del último informe, sumando todas
   las clases (GOOGL y GOOG, por ejemplo). Es mejor que el promedio ponderado
   para calcular la capitalización. */
function accionesCaratula(dei) {
  const lista = dei?.EntityCommonStockSharesOutstanding?.units?.shares || [];
  if (!lista.length) return null;
  const ultimoFiled = lista.reduce((m, d) => (d.filed > m ? d.filed : m), "");
  const delUltimo = lista.filter((d) => d.filed === ultimoFiled);
  const fin = delUltimo.reduce((m, d) => (d.end > m ? d.end : m), "");
  const total = delUltimo.filter((d) => d.end === fin).reduce((s, d) => s + d.val, 0);
  return total > 0 ? { valor: total, fecha: fin } : null;
}

const pctOrNull = (a, b) => (a !== null && a !== undefined && b ? (a / b) * 100 : null);

async function baseFundamental(ticker) {
  const co = await empresa(ticker);
  const { todos, dei } = await hechosDe(co.cik);
  const splits = await splitsDe(co.viaAdr || co.ticker);
  const P = {};
  for (const k of Object.keys(TAGS)) P[k] = ajustarPuntos(puntos(todos, TAGS[k], TIPO[k] || "moneda"), TIPO[k], splits);
  const moneda = P.ingresos.moneda || P.neto.moneda || "USD";
  return { co, dei, P, splits, moneda };
}

export async function fundamentales(ticker) {
  const { crudo } = normalizar(ticker);
  return cached(`fund:${crudo}`, 30 * 60e3, () => fundamentalesSinCache(crudo));
}

async function fundamentalesSinCache(ticker) {
  const { co, dei, P, splits, moneda } = await baseFundamental(ticker);

  const A = {}, Q = {}, I = {};
  for (const k of Object.keys(P)) {
    if (INSTANTES.has(k)) I[k] = instantes(P[k]);
    /* Las acciones son un promedio ponderado: restar acumulados no da el
       trimestre, así que solo se usan los trimestres informados como tales. */
    else { A[k] = anuales(P[k]); Q[k] = trimestres(P[k], { derivar: k !== "acciones" }); }
  }

  /* ------------------------------------------------------- anual */
  const finesAnuales = [...new Set([...A.ingresos.keys(), ...A.neto.keys()])].sort().slice(-6);
  if (finesAnuales.length < 2) throw new HttpError(`No pude leer suficientes ejercicios de ${co.ticker} en la SEC`, 422);

  const valorA = (k, fin) => {
    const p = INSTANTES.has(k) ? cercano(I[k], fin) : cercano(A[k], fin, 8);
    return p ? p.val : null;
  };

  const fila = (get, fy, fin, prevIng) => {
    const ing = get("ingresos");
    const bruto = get("brutoDirecto") ?? (ing !== null && get("costoVentas") !== null ? ing - get("costoVentas") : null);
    const op = get("operativo"), neto = get("neto"), cfo = get("cfo"), capex = get("capex");
    const fcf = cfo !== null && capex !== null ? cfo - Math.abs(capex) : null;
    const patrimonio = get("patrimonio");
    const deuda = (get("deudaLargo") || 0) + (get("deudaCorto") || 0);
    const cajaTotal = (get("caja") || 0) + (get("inversionesCorto") || 0);
    const tasaRaw = get("impuestos") !== null && get("antesImpuestos") ? get("impuestos") / get("antesImpuestos") : null;
    const tasa = tasaRaw !== null && tasaRaw > 0 && tasaRaw < 0.5 ? tasaRaw : 0.21;
    const capitalInvertido = patrimonio !== null ? patrimonio + deuda - cajaTotal : null;
    const ebitda = op !== null ? op + (get("amortizacion") || 0) : null;
    const interes = get("intereses");
    return {
      fy, fin,
      ingresos: ing,
      crecimiento: ing !== null && prevIng ? (ing / prevIng - 1) * 100 : null,
      margenBruto: pctOrNull(bruto, ing),
      margenOperativo: pctOrNull(op, ing),
      margenNeto: pctOrNull(neto, ing),
      idSobreVentas: pctOrNull(get("id"), ing),
      sbcSobreVentas: pctOrNull(get("sbc"), ing),
      bpa: get("bpa"),
      fcf,
      margenFcf: pctOrNull(fcf, ing),
      conversion: neto ? pctOrNull(fcf, neto) : null,
      roe: patrimonio > 0 ? pctOrNull(neto, patrimonio) : null,
      roic: op !== null && capitalInvertido > 0 ? ((op * (1 - tasa)) / capitalInvertido) * 100 : null,
      deudaNeta: patrimonio !== null ? deuda - cajaTotal : null,
      deudaNetaEbitda: ebitda && ebitda > 0 ? (deuda - cajaTotal) / ebitda : null,
      cobertura: interes && op !== null ? Math.abs(op / interes) : null,
      recompras: get("recompras"),
      dividendosPagados: get("dividendos"),
      acciones: get("acciones"),
      intereses: interes, tasaImpositiva: tasaRaw !== null && tasaRaw > 0 && tasaRaw < 0.5 ? tasaRaw * 100 : null,
      neto, patrimonio, ebitda, cajaTotal, deuda, operativo: op
    };
  };

  const filas = finesAnuales.map((fin, i) => fila((k) => valorA(k, fin), Number(fin.slice(0, 4)), fin, i > 0 ? valorA("ingresos", finesAnuales[i - 1]) : null));

  /* -------------------------------------------------- trimestral */
  const finesQ = [...Q.ingresos.keys(), ...Q.neto.keys()].filter((v, i, a) => a.indexOf(v) === i).sort();
  const valorQ = (k, fin) => {
    const p = INSTANTES.has(k) ? cercano(I[k], fin) : Q[k]?.get(fin) || cercano(Q[k], fin, 6);
    return p ? p.val : null;
  };
  const trimestral = finesQ.slice(-8).map((fin) => {
    const ing = valorQ("ingresos", fin);
    const hace1a = finesQ.find((e) => Math.abs(dias(e, fin) - 364) <= 20);
    const ingPrev = hace1a ? valorQ("ingresos", hace1a) : null;
    const bruto = valorQ("brutoDirecto", fin) ?? (ing !== null && valorQ("costoVentas", fin) !== null ? ing - valorQ("costoVentas", fin) : null);
    const cfo = valorQ("cfo", fin), capex = valorQ("capex", fin);
    const bpa = valorQ("bpa", fin);
    const bpaPrev = hace1a ? valorQ("bpa", hace1a) : null;
    return {
      fin,
      ingresos: ing,
      crecimientoIA: ing !== null && ingPrev ? (ing / ingPrev - 1) * 100 : null,
      margenBruto: pctOrNull(bruto, ing),
      margenOperativo: pctOrNull(valorQ("operativo", fin), ing),
      margenNeto: pctOrNull(valorQ("neto", fin), ing),
      bpa,
      crecimientoBpa: bpa !== null && bpaPrev && bpaPrev > 0 ? (bpa / bpaPrev - 1) * 100 : null,
      fcf: cfo !== null && capex !== null ? cfo - Math.abs(capex) : null
    };
  });

  /* --------------------------------------------- últimos 12 meses */
  const ultAnual = finesAnuales.at(-1);
  const ultQ = finesQ.at(-1);
  let ttm = null;
  const qBase = Q.ingresos.size ? Q.ingresos : Q.neto;
  const sumaEn = (k, ends) => {
    const vals = ends.map((e) => valorQ(k, e));
    return vals.every((v) => v !== null) ? vals.reduce((a, b) => a + b, 0) : null;
  };
  if (ultQ && ultQ > ultAnual) {
    const ends = ultimosCuatro(qBase, ultQ);
    if (ends) {
      const get = (k) => (INSTANTES.has(k) || k === "acciones" ? valorQ(k, ultQ) : sumaEn(k, ends));
      /* Crecimiento: estos 12 meses contra los 12 meses que terminaron un
         año antes, no contra un ejercicio que cierra en otra fecha. */
      const finPrevio = [...qBase.keys()].find((e) => Math.abs(dias(e, ultQ) - 364) <= 20);
      const endsPrev = finPrevio ? ultimosCuatro(qBase, finPrevio) : null;
      const ingPrev = endsPrev ? sumaEn("ingresos", endsPrev) : null;
      ttm = { ...fila(get, null, ultQ, ingPrev), base: `4 trimestres a ${ultQ}` };
    }
  }
  if (!ttm) ttm = { ...filas.at(-1), base: `ejercicio cerrado el ${ultAnual}` };

  /* ---------------------------------------------------- valuación */
  const caratula = accionesCaratula(dei);
  let valuacion = null, avisoValuacion = null;
  try {
    const px = await price(co.viaAdr || ticker);
    const accionesVal = caratula ? caratula.valor * factorSplit(caratula.fecha, splits) : ttm.acciones;
    if (px.moneda && moneda && px.moneda !== moneda) {
      avisoValuacion = `El precio está en ${px.moneda} y los estados en ${moneda}: no calculo múltiplos que mezclen monedas.`;
    } else if (accionesVal) {
      const capitalizacion = px.stats.last * accionesVal;
      const ev = capitalizacion + (ttm.deudaNeta || 0);
      valuacion = {
        precio: px.stats.last, fecha: px.stats.date, moneda: px.moneda, acciones: accionesVal,
        capitalizacion, ev,
        per: ttm.neto > 0 ? capitalizacion / ttm.neto : null,
        precioVentas: ttm.ingresos ? capitalizacion / ttm.ingresos : null,
        evVentas: ttm.ingresos ? ev / ttm.ingresos : null,
        evEbitda: ttm.ebitda > 0 ? ev / ttm.ebitda : null,
        evEbit: ttm.operativo > 0 ? ev / ttm.operativo : null,
        precioLibro: ttm.patrimonio > 0 ? capitalizacion / ttm.patrimonio : null,
        rentabilidadFcf: ttm.fcf !== null ? (ttm.fcf / capitalizacion) * 100 : null,
        rentabilidadAccionista: ttm.recompras === null && ttm.dividendosPagados === null
          ? null
          : ((Math.abs(ttm.recompras || 0) + Math.abs(ttm.dividendosPagados || 0)) / capitalizacion) * 100,
        base: ttm.base
      };
      if (esExtranjera(P)) avisoValuacion = AVISO_ADR;
    }
  } catch (e) { avisoValuacion = `Sin precio no hay valuación: ${String(e.message).slice(0, 120)}`; }

  const conAcc = filas.filter((x) => x.acciones);
  const dilucion = conAcc.length > 1
    ? ((conAcc.at(-1).acciones / conAcc[0].acciones) ** (1 / (conAcc.at(-1).fy - conAcc[0].fy || 1)) - 1) * 100
    : null;

  return {
    ticker: co.ticker, empresa: co.name, cik: co.cik, viaAdr: co.viaAdr, moneda,
    filas, trimestral, ttm, valuacion, avisoValuacion, dilucionAnual: dilucion,
    acciones: caratula,
    splits: splits.filter((s) => s.d >= (filas[0]?.fin || "")),
    fuente: `SEC EDGAR · XBRL (${moneda})`
  };
}

/* -------------------------------------------- estados financieros */

/* Estado de resultados, balance general y flujo de efectivo, anual (últimos
   seis ejercicios) y trimestral (últimos ocho trimestres). Los trimestres de
   flujos se reconstruyen desde acumulados igual que en fundamentales. */
export async function estadosFinancieros(ticker) {
  const { crudo } = normalizar(ticker);
  return cached(`estados:${crudo}`, 30 * 60e3, async () => {
    const co = await empresa(crudo);
    const { todos } = await hechosDe(co.cik);
    const splits = await splitsDe(co.viaAdr || co.ticker);
    const lineas = Object.values(ESTADOS).flat();
    const P = {}, instante = {}, tipo = {};
    for (const l of lineas) {
      if (!l.tags || P[l.k]) continue;
      P[l.k] = ajustarPuntos(puntos(todos, l.tags, l.tipo || "moneda"), l.tipo, splits);
      instante[l.k] = Boolean(l.instante);
      tipo[l.k] = l.tipo;
    }
    const A = {}, Q = {}, I = {};
    for (const [k, pts] of Object.entries(P)) {
      if (instante[k]) I[k] = instantes(pts);
      else { A[k] = anuales(pts); Q[k] = trimestres(pts, { derivar: tipo[k] !== "acciones" }); }
    }
    const fines = (m) => [...new Set([...(m.ingresos?.keys() || []), ...(m.neto?.keys() || [])])].sort();
    const columnas = { anual: fines(A).slice(-6), trimestral: fines(Q).slice(-8) };
    if (columnas.anual.length < 1) throw new HttpError(`No encontré estados financieros de ${co.ticker} en la SEC`, 422);

    const valor = (k, fin, modo) => {
      if (!P[k]) return null;
      if (instante[k]) return cercano(I[k], fin)?.val ?? null;
      const mapa = modo === "anual" ? A[k] : Q[k];
      return (mapa.get(fin) || cercano(mapa, fin, modo === "anual" ? 8 : 6))?.val ?? null;
    };

    const armar = (modo) => {
      const porColumna = columnas[modo].map((fin) => {
        const v = {};
        for (const l of lineas) {
          if (v[l.k] !== undefined && v[l.k] !== null) continue;
          const crudoV = l.tags ? valor(l.k, fin, modo) : null;
          v[l.k] = crudoV === null ? null : l.signo === -1 ? -Math.abs(crudoV) : crudoV;
        }
        for (const l of lineas) if ((v[l.k] === null || v[l.k] === undefined) && l.calc) v[l.k] = l.calc(v);
        return v;
      });
      return Object.fromEntries(Object.entries(ESTADOS).map(([nombre, ls]) => [nombre, ls
        .filter((l) => !l.oculta)
        .map((l) => ({ k: l.k, t: l.t, total: Boolean(l.total), ratio: Boolean(l.ratio), tipo: l.tipo || null, separador: Boolean(l.separador), calculada: !l.tags, sinVertical: Boolean(l.sinVertical || l.ratio || l.tipo), valores: porColumna.map((v) => v[l.k] ?? null) }))
        .filter((l) => l.valores.some((x) => x !== null))]));
    };

    return {
      ticker: co.ticker, empresa: co.name, viaAdr: co.viaAdr, moneda: P.ingresos?.moneda || P.neto?.moneda || "USD",
      anual: { columnas: columnas.anual, estados: armar("anual") },
      trimestral: { columnas: columnas.trimestral, estados: armar("trimestral") },
      fuente: "SEC EDGAR · XBRL"
    };
  });
}

/* ------------------------------------------------------------------ PER */

/* Beneficio por acción de los últimos 12 meses en cada fecha, con la fecha
   desde la cual ese dato ya era público. Antes de esa fecha nadie podía
   conocerlo. Si la empresa no presenta trimestres (20-F), se usa el anual. */
async function hitosBpa(ticker) {
  const { co, P, moneda } = await baseFundamental(ticker);
  const hitos = [];
  const q = trimestres(P.bpa);
  const ends = [...q.keys()];
  for (let i = 3; i < ends.length; i++) {
    const cuatro = ends.slice(i - 3, i + 1);
    const span = dias(cuatro[0], cuatro[3]);
    if (span < 250 || span > 300) continue;
    const eps = cuatro.reduce((s, e) => s + q.get(e).val, 0);
    hitos.push({ fin: ends[i], eps, desde: q.get(ends[i]).primerFiled, base: "12 meses" });
  }
  if (hitos.length < 2) {
    for (const p of anuales(P.bpa).values()) hitos.push({ fin: p.end, eps: p.val, desde: p.primerFiled, base: "ejercicio" });
  }
  if (!hitos.length) {
    /* Último recurso: beneficio neto sobre acciones diluidas promedio. */
    const net = anuales(P.neto), acc = anuales(P.acciones);
    for (const [fin, p] of net) {
      const a = cercano(acc, fin, 8);
      if (a) hitos.push({ fin, eps: p.val / a.val, desde: p.primerFiled, base: "ejercicio" });
    }
  }
  hitos.sort((a, b) => a.desde.localeCompare(b.desde));
  if (!hitos.length) throw new HttpError(`${co.ticker} no tiene beneficio por acción publicado en la SEC`, 422);
  return { co, hitos, moneda, extranjera: esExtranjera(P) };
}

const medianaDe = (v) => {
  const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* Resumen corto para la tabla de comparables. */
export async function comparable(ticker) {
  const f = await fundamentales(ticker);
  const v = f.valuacion || {};
  return {
    ticker: f.ticker, empresa: f.empresa, moneda: f.moneda,
    capitalizacion: v.capitalizacion ?? null, per: v.per ?? null, precioVentas: v.precioVentas ?? null,
    evEbitda: v.evEbitda ?? null, rentabilidadFcf: v.rentabilidadFcf ?? null,
    crecimiento: f.ttm.crecimiento, margenBruto: f.ttm.margenBruto, margenOperativo: f.ttm.margenOperativo,
    roic: f.ttm.roic, deudaNetaEbitda: f.ttm.deudaNetaEbitda, base: f.ttm.base
  };
}

export async function perCompleto(ticker, paresTxt) {
  const { co, hitos, moneda, extranjera } = await hitosBpa(ticker);
  const px = await price(co.viaAdr || ticker, { rango: "5y" });
  if (px.moneda && moneda && px.moneda !== moneda) {
    throw new HttpError(`El precio de ${px.ticker} está en ${px.moneda} y el beneficio en ${moneda}: el PER mezclaría monedas.`, 422);
  }

  /* PER de cada rueda, usando el beneficio que ya estaba publicado ese día. */
  const serie = [];
  for (const vela of px.candles) {
    let h = null;
    for (const x of hitos) if (x.desde <= vela.d) h = x;
    if (h && h.eps > 0) serie.push({ d: vela.d, per: vela.c / h.eps });
  }
  if (serie.length < 30) throw new HttpError(`No pude reconstruir suficiente historia de PER para ${px.ticker} (¿tuvo pérdidas en el período?)`, 422);

  const valores = serie.map((x) => x.per).sort((a, b) => a - b);
  const pc = (p) => valores[Math.floor(valores.length * p)];
  const actual = serie.at(-1).per;
  const percentil = (valores.filter((v) => v <= actual).length / valores.length) * 100;
  const ult = hitos.at(-1);

  /* Pares: el usuario elige quiénes son. Un "PER del sector" sin saber con
     quién se compara es un número sin dueño. */
  const nombres = (paresTxt || "").split(/[,\s;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
  const res = await enParalelo(nombres, 3, (n) => comparable(n));
  const pares = res.map((r, i) => (r.ok ? r.valor : { ticker: nombres[i].toUpperCase(), error: String(r.error).slice(0, 90) }));
  const medianaPares = medianaDe(pares.map((x) => (x.per > 0 ? x.per : null)));

  return {
    ticker: px.ticker, empresa: co.name, precio: px.stats.last, fecha: px.stats.date, moneda: px.moneda,
    ejercicio: ult.fin, eps: ult.eps, baseEps: ult.base,
    actual,
    historico: {
      desde: serie[0].d, hasta: serie.at(-1).d, ruedas: serie.length,
      min: valores[0], p25: pc(0.25), mediana: pc(0.5), p75: pc(0.75), max: valores.at(-1),
      percentilActual: percentil,
      serie: serie.filter((_, i) => i % Math.max(1, Math.floor(serie.length / 220)) === 0 || i === serie.length - 1)
    },
    pares,
    medianas: {
      per: medianaPares,
      precioVentas: medianaDe(pares.map((x) => x.precioVentas)),
      evEbitda: medianaDe(pares.map((x) => x.evEbitda)),
      margenOperativo: medianaDe(pares.map((x) => x.margenOperativo)),
      crecimiento: medianaDe(pares.map((x) => x.crecimiento))
    },
    medianaPares,
    vsPares: medianaPares ? (actual / medianaPares - 1) * 100 : null,
    vsPropioMediana: (actual / pc(0.5) - 1) * 100,
    aviso: extranjera ? AVISO_ADR : null
  };
}
