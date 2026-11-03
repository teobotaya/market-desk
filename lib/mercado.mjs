import { cached, getJSON, getText, enParalelo, HttpError } from "./http.mjs";
import { cotizacionLigera } from "./precios.mjs";

/* ------------------------------------------------------------- tablero */

export const TABLERO = [
  { grupo: "Índices EE.UU.", items: [["^GSPC", "S&P 500"], ["^IXIC", "Nasdaq Composite"], ["^DJI", "Dow Jones"], ["^RUT", "Russell 2000"], ["^VIX", "VIX (volatilidad)"]] },
  { grupo: "Resto del mundo", items: [["^MERV", "S&P Merval"], ["^BVSP", "Bovespa"], ["^STOXX50E", "Euro Stoxx 50"], ["^N225", "Nikkei 225"], ["^HSI", "Hang Seng"], ["EEM", "Emergentes (EEM)"]] },
  { grupo: "Tasas del Tesoro EE.UU.", items: [["^IRX", "13 semanas"], ["^FVX", "5 años"], ["^TNX", "10 años"], ["^TYX", "30 años"]], tasa: true },
  { grupo: "Monedas", items: [["DX-Y.NYB", "Índice dólar (DXY)"], ["EURUSD=X", "Euro / dólar"], ["USDBRL=X", "Dólar / real"], ["USDJPY=X", "Dólar / yen"], ["USDCNY=X", "Dólar / yuan"]] },
  { grupo: "Materias primas", items: [["CL=F", "Petróleo WTI"], ["BZ=F", "Petróleo Brent"], ["NG=F", "Gas natural"], ["GC=F", "Oro"], ["SI=F", "Plata"], ["HG=F", "Cobre"], ["ZS=F", "Soja"], ["ZC=F", "Maíz"], ["ZW=F", "Trigo"]] },
  { grupo: "Cripto", items: [["BTC-USD", "Bitcoin"], ["ETH-USD", "Ethereum"]] }
];

export const SECTORES = [
  ["XLK", "Tecnología"], ["XLC", "Comunicaciones"], ["XLY", "Consumo discrecional"], ["XLP", "Consumo básico"],
  ["XLF", "Financiero"], ["XLV", "Salud"], ["XLI", "Industria"], ["XLE", "Energía"], ["XLB", "Materiales"],
  ["XLU", "Servicios públicos"], ["XLRE", "Inmobiliario"], ["SMH", "Semiconductores"]
];

export async function tablero() {
  return cached("mkt:tablero", 3 * 60e3, async () => {
    const todos = TABLERO.flatMap((g) => g.items.map(([t, n]) => ({ t, n, grupo: g.grupo, tasa: !!g.tasa })));
    const res = await enParalelo(todos, 6, (x) => cotizacionLigera(x.t));
    const grupos = TABLERO.map((g) => ({
      grupo: g.grupo, tasa: !!g.tasa,
      items: todos.map((x, i) => ({ ...x, r: res[i] })).filter((x) => x.grupo === g.grupo).map((x) => (
        x.r.ok ? { ...x.r.valor, nombre: x.n, ticker: x.t } : { ticker: x.t, nombre: x.n, error: x.r.error }
      ))
    }));
    return { grupos, fuente: "Yahoo Finance (con demora de 15 a 20 minutos)" };
  });
}

export async function sectores() {
  return cached("mkt:sectores", 10 * 60e3, async () => {
    const lista = [["SPY", "S&P 500 (referencia)"], ...SECTORES];
    const res = await enParalelo(lista, 6, ([t]) => cotizacionLigera(t));
    return {
      filas: lista.map(([t, n], i) => (res[i].ok ? { ...res[i].valor, ticker: t, nombre: n } : { ticker: t, nombre: n, error: res[i].error })),
      fuente: "ETFs sectoriales SPDR vía Yahoo Finance"
    };
  });
}

/* ------------------------------------------------------------------ FRED */

/* La Reserva Federal de St. Louis publica sus series en CSV sin clave
   (fredgraph.csv). La API JSON sí pide clave; el CSV no. */
export function parseFred(csv) {
  const lineas = csv.trim().split(/\r?\n/);
  if (!/^(observation_date|DATE),/i.test(lineas[0] || "")) throw new HttpError("FRED no devolvió un CSV válido", 502);
  return lineas.slice(1).map((l) => {
    const [d, v] = l.split(",");
    return { d, v: v === "." || v === "" ? null : Number(v) };
  }).filter((x) => x.v !== null && Number.isFinite(x.v));
}

export async function fredSerie(id, desde) {
  if (!/^[A-Z0-9]+$/.test(id)) throw new HttpError("serie inválida", 400);
  return cached(`fred:${id}:${desde}`, 6 * 3600e3, async () =>
    parseFred(await getText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${desde}`, { timeout: 20000 })));
}

const MACRO = [
  ["DFF", "Tasa de fondos federales", "%"],
  ["DGS2", "Bono del Tesoro a 2 años", "%"],
  ["DGS10", "Bono del Tesoro a 10 años", "%"],
  ["T10Y2Y", "Pendiente 10 años − 2 años", "pp"],
  ["T10Y3M", "Pendiente 10 años − 3 meses", "pp"],
  ["DFII10", "Tasa real a 10 años (TIPS)", "%"],
  ["T10YIE", "Inflación implícita a 10 años", "%"],
  ["BAMLH0A0HYM2", "Spread de bonos high yield", "pp"],
  ["BAMLC0A0CM", "Spread de bonos grado inversión", "pp"]
];
const CURVA = [["DGS1MO", "1M", 1 / 12], ["DGS3MO", "3M", 0.25], ["DGS6MO", "6M", 0.5], ["DGS1", "1A", 1], ["DGS2", "2A", 2], ["DGS3", "3A", 3], ["DGS5", "5A", 5], ["DGS7", "7A", 7], ["DGS10", "10A", 10], ["DGS20", "20A", 20], ["DGS30", "30A", 30]];

export async function macroEEUU() {
  return cached("mkt:macro", 3 * 3600e3, async () => {
    const desde = new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10);
    const ids = [...new Set([...MACRO.map((x) => x[0]), ...CURVA.map((x) => x[0])])];
    const res = await enParalelo(ids, 5, (id) => fredSerie(id, desde));
    const serie = Object.fromEntries(ids.map((id, i) => [id, res[i].ok ? res[i].valor : null]));
    const valorHace = (s, dias) => {
      if (!s?.length) return null;
      const f = new Date(new Date(s.at(-1).d) - dias * 864e5).toISOString().slice(0, 10);
      return [...s].reverse().find((x) => x.d <= f)?.v ?? null;
    };
    const indicadores = MACRO.map(([id, nombre, unidad]) => {
      const s = serie[id];
      if (!s?.length) return { id, nombre, unidad, error: res[ids.indexOf(id)].error || "sin datos" };
      return {
        id, nombre, unidad, valor: s.at(-1).v, fecha: s.at(-1).d,
        cambio1m: valorHace(s, 30) !== null ? s.at(-1).v - valorHace(s, 30) : null,
        cambio1a: valorHace(s, 365) !== null ? s.at(-1).v - valorHace(s, 365) : null,
        serie: s.filter((_, i) => i % 3 === 0 || i === s.length - 1).map((x) => ({ d: x.d, v: x.v }))
      };
    });
    const curva = CURVA.map(([id, plazo, anios]) => {
      const s = serie[id];
      return { plazo, anios, hoy: s?.at(-1)?.v ?? null, hace1m: valorHace(s, 30), hace1a: valorHace(s, 365), fecha: s?.at(-1)?.d ?? null };
    });
    return { indicadores, curva, fuente: "FRED (Reserva Federal de St. Louis), sin clave" };
  });
}

/* --------------------------------------------------- miedo y codicia */

/* El índice Fear & Greed de CNN combina siete señales (momento, amplitud,
   opciones put/call, demanda de refugio, spreads, etc.) en un número 0-100. */
export async function miedoCodicia() {
  return cached("mkt:fng", 30 * 60e3, async () => {
    const j = await getJSON("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
      headers: { Referer: "https://edition.cnn.com/", Origin: "https://edition.cnn.com" }, timeout: 10000
    });
    const f = j.fear_and_greed || {};
    const ETIQUETA = { "extreme fear": "miedo extremo", fear: "miedo", neutral: "neutral", greed: "codicia", "extreme greed": "codicia extrema" };
    return {
      valor: f.score, etiqueta: ETIQUETA[f.rating] || f.rating, fecha: f.timestamp,
      previo: f.previous_close, semana: f.previous_1_week, mes: f.previous_1_month, anio: f.previous_1_year,
      fuente: "CNN Fear & Greed"
    };
  });
}

/* ----------------------------------------------------------- calendario */

/* Calendario de balances de Nasdaq: es público y sin clave. Se piden los
   próximos días hábiles y se filtran las empresas grandes, o las de la
   watchlist si se pasan. */
export async function calendarioBalances(dias = 7, interes = []) {
  dias = Math.max(1, Math.min(15, dias));
  /* Fechas en el huso de la máquina: a la noche en Argentina la fecha UTC ya
     es la del día siguiente y se salteaba un día. */
  const local = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const fechas = [];
  const d = new Date();
  while (fechas.length < dias) {
    if (d.getDay() !== 0 && d.getDay() !== 6) fechas.push(local(d));
    d.setDate(d.getDate() + 1);
  }
  const res = await enParalelo(fechas, 3, (f) => cached(`cal:${f}`, 6 * 3600e3, () =>
    getJSON(`https://api.nasdaq.com/api/calendar/earnings?date=${f}`, { headers: { "Accept-Language": "en-US,en;q=0.9" } })));
  const watch = new Set(interes.map((x) => x.toUpperCase().replace(/\.BA$/, "")));
  const capital = (s) => Number(String(s || "").replace(/[$,]/g, "")) || 0;
  const MOMENTO = { "time-after-hours": "después del cierre", "time-pre-market": "antes de la apertura", "time-not-supplied": "sin horario" };
  const dias_ = fechas.map((f, i) => {
    if (!res[i].ok) return { fecha: f, error: res[i].error, filas: [] };
    const filas = (res[i].valor?.data?.rows || []).map((r) => ({
      ticker: r.symbol, empresa: r.name, momento: MOMENTO[r.time] || r.time || "", capitalizacion: capital(r.marketCap),
      bpaEstimado: r.epsForecast || null, estimaciones: r.noOfEsts || null, bpaAnioAnterior: r.lastYearEPS || null, trimestre: r.fiscalQuarterEnding || null,
      enWatchlist: watch.has(String(r.symbol).toUpperCase())
    })).map((r) => ({ ...r, destacada: r.enWatchlist || r.capitalizacion >= 10e9 }))
      .sort((a, b) => (b.enWatchlist - a.enWatchlist) || b.capitalizacion - a.capitalizacion);
    return { fecha: f, filas };
  });
  if (dias_.every((x) => x.error)) throw new HttpError(`Nasdaq no respondió el calendario: ${dias_[0].error}`, 502);
  /* Se devuelven todas las empresas: la vista muestra las destacadas (más de
     10 mil M o en la watchlist) y el buscador recorre el resto. */
  return { dias: dias_, total: dias_.reduce((s, d) => s + d.filas.length, 0), fuente: "Nasdaq" };
}
