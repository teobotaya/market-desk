import { cached, getJSON, HttpError } from "./http.mjs";

/* Fuentes de respaldo gratuitas y sin clave para cuando Yahoo no responde.
   Cada una devuelve { rows, meta } como el resto de la cadena de precios. */

const DIAS = { "1y": 400, "2y": 760, "5y": 1860, "10y": 3700 };
const isoDia = (ms) => new Date(ms).toISOString().slice(0, 10);

/* ---------------------------------------- monedas: tipos del BCE (Frankfurter) */

/* Tipos de referencia diarios del Banco Central Europeo, publicados por
   Frankfurter. Con base en dólares: cuántas unidades de cada moneda vale
   un dólar. El índice dólar (DXY) se reconstruye con la fórmula del ICE. */
const MONEDAS_BCE = ["EUR", "JPY", "BRL", "CNY", "GBP", "CAD", "SEK", "CHF"];
export const SERIES_BCE = {
  EURUSD: { moneda: "USD", valor: (r) => 1 / r.EUR },
  USDJPY: { moneda: "JPY", valor: (r) => r.JPY },
  USDBRL: { moneda: "BRL", valor: (r) => r.BRL },
  USDCNY: { moneda: "CNY", valor: (r) => r.CNY },
  /* DXY = 50,14348112 × EURUSD^−0,576 × USDJPY^0,136 × GBPUSD^−0,119 ×
     USDCAD^0,091 × USDSEK^0,042 × USDCHF^0,036 (con base dólar, EURUSD = 1/EUR). */
  DXY: { moneda: "USD", valor: (r) => 50.14348112 * r.EUR ** 0.576 * r.JPY ** 0.136 * r.GBP ** 0.119 * r.CAD ** 0.091 * r.SEK ** 0.042 * r.CHF ** 0.036 }
};

async function tablaBce(rango) {
  const desde = isoDia(Date.now() - (DIAS[rango] || 760) * 864e5);
  return cached(`bce:${desde}`, 6 * 3600e3, async () => {
    const j = await getJSON(`https://api.frankfurter.dev/v1/${desde}..?base=USD&symbols=${MONEDAS_BCE.join(",")}`, { fuente: "BCE (Frankfurter)" });
    const filas = Object.entries(j?.rates || {}).map(([d, r]) => ({ d, r })).sort((a, b) => a.d.localeCompare(b.d));
    if (filas.length < 30) throw new HttpError("BCE (Frankfurter): sin serie", 502);
    return filas;
  });
}

export async function fromBce(serie, rango = "2y") {
  const def = SERIES_BCE[serie];
  if (!def) throw new HttpError(`BCE: serie ${serie} desconocida`, 400);
  const rows = (await tablaBce(rango)).map(({ d, r }) => {
    const v = def.valor(r);
    return Number.isFinite(v) && v > 0 ? { d, o: v, h: v, l: v, c: v, v: null } : null;
  }).filter(Boolean);
  if (rows.length < 30) throw new HttpError(`BCE: serie ${serie} incompleta`, 502);
  return { rows, meta: { moneda: def.moneda, nombre: null } };
}

/* ----------------------------------------------------- Kraken: cripto y oro */

/* Velas diarias de Kraken (hasta 720, unos dos años). PAXG es un token
   respaldado por una onza troy de oro: sigue al oro contado. */
export async function fromKraken(par) {
  const j = await getJSON(`https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(par)}&interval=1440`, { fuente: "Kraken" });
  if (j?.error?.length) throw new HttpError(`Kraken: ${j.error.join(", ")}`, 502);
  const clave = Object.keys(j?.result || {}).find((k) => k !== "last");
  const velas = (j?.result?.[clave] || []).map(([t, o, h, l, c, , v]) => ({ d: isoDia(t * 1000), o: +o, h: +h, l: +l, c: +c, v: +v })).filter((x) => x.c > 0);
  if (velas.length < 30) throw new HttpError(`Kraken: serie de ${velas.length} días`, 502);
  return { rows: velas, meta: { moneda: "USD", nombre: null } };
}
