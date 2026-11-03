import { cached, getJSON, HttpError } from "./http.mjs";
import { panel, dolares } from "./argentina.mjs";
import { medidasBono, dias30360, liquidacion } from "../public/js/finanzas.js";

/* Bonos soberanos en dólares del canje de 2020: Bonares (ley argentina, AL y
   AE) y Globales (ley de Nueva York, GD). Cada par comparte cupones, fechas y
   amortizaciones; difieren en la legislación. Los cronogramas salen de las
   condiciones de emisión (Decreto 676/2020 y prospecto del canje): pagos el 9
   de enero y el 9 de julio, cupones "step up" en base 30/360.

   Con eso y el precio de mercado se calcula lo que muestran las plataformas
   pagas de renta fija: TIR, duration, duration modificada, convexidad, PVBP,
   valor residual, interés corrido, valor técnico y paridad. */

const EMISION = "2020-09-04";

/* n cuotas semestrales iguales desde una fecha (9 de enero o 9 de julio). */
function cuotas(desde, n, pct = 100 / n) {
  const out = [];
  let [y, m] = desde.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    out.push([`${y}-${String(m).padStart(2, "0")}-09`, pct]);
    if (m === 1) m = 7; else { m = 1; y++; }
  }
  return out;
}

const FAMILIAS = {
  2029: { vence: "2029-07-09", cupones: [[EMISION, 1]], amort: cuotas("2025-01-09", 10) },
  2030: {
    vence: "2030-07-09",
    cupones: [[EMISION, 0.125], ["2021-07-09", 0.5], ["2023-07-09", 0.75], ["2027-07-09", 1.75]],
    amort: [["2024-07-09", 4], ...cuotas("2025-01-09", 12, 8)]
  },
  2035: {
    vence: "2035-07-09",
    cupones: [[EMISION, 0.125], ["2021-07-09", 1.125], ["2022-07-09", 1.5], ["2023-07-09", 3.625], ["2024-07-09", 4.125], ["2027-07-09", 4.75], ["2028-07-09", 5]],
    amort: cuotas("2031-01-09", 10)
  },
  2038: {
    vence: "2038-01-09",
    cupones: [[EMISION, 0.125], ["2021-07-09", 2], ["2022-07-09", 3.875], ["2023-07-09", 4.25], ["2024-07-09", 5]],
    amort: cuotas("2027-07-09", 22)
  },
  2041: {
    vence: "2041-07-09",
    cupones: [[EMISION, 0.125], ["2021-07-09", 2.5], ["2022-07-09", 3.5], ["2029-07-09", 4.875]],
    amort: cuotas("2028-01-09", 28)
  },
  2046: {
    vence: "2046-07-09",
    cupones: [[EMISION, 0.125], ["2021-07-09", 1.125], ["2022-07-09", 1.5], ["2023-07-09", 3.625], ["2024-07-09", 4.125], ["2027-07-09", 4.375], ["2028-07-09", 5]],
    amort: cuotas("2025-01-09", 44)
  }
};

export const BONOS = {
  AL29: { familia: 2029, ley: "Argentina", par: "GD29" }, GD29: { familia: 2029, ley: "Nueva York", par: "AL29" },
  AL30: { familia: 2030, ley: "Argentina", par: "GD30" }, GD30: { familia: 2030, ley: "Nueva York", par: "AL30" },
  AL35: { familia: 2035, ley: "Argentina", par: "GD35" }, GD35: { familia: 2035, ley: "Nueva York", par: "AL35" },
  AE38: { familia: 2038, ley: "Argentina", par: "GD38" }, GD38: { familia: 2038, ley: "Nueva York", par: "AE38" },
  AL41: { familia: 2041, ley: "Argentina", par: "GD41" }, GD41: { familia: 2041, ley: "Nueva York", par: "AL41" },
  GD46: { familia: 2046, ley: "Nueva York", par: null }
};

const tasaVigente = (cupones, inicioPeriodo) => cupones.filter(([d]) => d <= inicioPeriodo).at(-1)[1];

/* Cronograma completo por cada 100 de valor nominal original. */
export function cronograma(ticker) {
  const def = BONOS[ticker];
  if (!def) throw new HttpError(`${ticker} no está en la lista de bonos soberanos en dólares`, 404);
  const fam = FAMILIAS[def.familia];
  const amort = new Map(fam.amort);
  const pagos = [];
  for (let y = 2021; ; y++) {
    const f1 = `${y}-01-09`, f2 = `${y}-07-09`;
    if (f1 > fam.vence) break;
    pagos.push(f1);
    if (f2 > fam.vence) break;
    pagos.push(f2);
  }
  let residual = 100, inicio = EMISION;
  return pagos.map((f, i) => {
    const tasa = tasaVigente(fam.cupones, inicio);
    const fraccion = inicio === EMISION ? dias30360(inicio, f) / 360 : 0.5;
    const cupon = (residual * tasa * fraccion) / 100;
    /* La última cuota cancela lo que quede, para no arrastrar redondeos. */
    const am = i === pagos.length - 1 ? residual : Math.min(residual, amort.get(f) || 0);
    const flujo = { fecha: f, inicio, tasa, cupon, amortizacion: am, total: cupon + am, residualAntes: residual, residual: residual - am };
    residual -= am;
    inicio = f;
    return flujo;
  });
}

/* Valor residual, interés corrido y valor técnico a una fecha. */
export function valorTecnico(ticker, fecha) {
  const flujos = cronograma(ticker);
  const pasados = flujos.filter((f) => f.fecha <= fecha);
  const ultimo = pasados.at(-1);
  const inicio = ultimo ? ultimo.fecha : EMISION;
  const vr = ultimo ? ultimo.residual : 100;
  const proximo = flujos.find((f) => f.fecha > fecha) || null;
  const tasa = proximo ? proximo.tasa : 0;
  const ic = (vr * tasa * dias30360(inicio, fecha)) / 360 / 100;
  return { vr, ic, vt: vr + ic, tasa, proximo, flujos };
}

export function analizar(ticker, precio, fechaLiq = liquidacion()) {
  const v = valorTecnico(ticker, fechaLiq);
  const m = medidasBono(v.flujos, precio, fechaLiq);
  const def = BONOS[ticker];
  return {
    ticker, ley: def.ley, par: def.par, vence: FAMILIAS[def.familia].vence, precio, fechaLiq,
    tir: m?.tir ?? null, duration: m?.duration ?? null, md: m?.md ?? null, convexidad: m?.convexidad ?? null, pvbp: m?.pvbp ?? null,
    vr: v.vr, ic: v.ic, vt: v.vt, paridad: precio && v.vt ? (precio / v.vt) * 100 : null,
    cuponVigente: v.tasa,
    proximoPago: v.proximo ? { fecha: v.proximo.fecha, cupon: v.proximo.cupon, amortizacion: v.proximo.amortizacion, total: v.proximo.total } : null
  };
}

/* Precio en dólares: la especie D (dólar MEP); si no cotiza, la C (cable);
   si tampoco, el precio en pesos dividido por el MEP. */
function precioDolar(filas, ticker, mep) {
  const de = (s) => filas.find((f) => f.ticker === s);
  const medio = (f) => (f?.ultimo > 0 ? f.ultimo : f?.compra > 0 && f?.venta > 0 ? (f.compra + f.venta) / 2 : null);
  for (const [sufijo, especie] of [["D", "MEP"], ["C", "cable"]]) {
    const p = medio(de(ticker + sufijo));
    if (p) return { precio: p, especie, variacion: de(ticker + sufijo).variacion ?? null, volumen: de(ticker + sufijo).volumen ?? null };
  }
  const ars = medio(de(ticker));
  if (ars && mep) return { precio: ars / mep, especie: "pesos / MEP", variacion: de(ticker).variacion ?? null, volumen: null };
  return null;
}

export async function bonosDolar() {
  return cached("ar:bonos", 60e3, async () => {
    const [p, d] = await Promise.allSettled([panel("bonos"), dolares()]);
    if (p.status === "rejected") throw p.reason;
    const mep = d.status === "fulfilled" ? d.value.filas.find((x) => x.casa === "bolsa")?.venta : null;
    const fechaLiq = liquidacion();
    const filas = Object.keys(BONOS).map((t) => {
      const px = precioDolar(p.value.filas, t, mep);
      if (!px) return { ticker: t, ley: BONOS[t].ley, vence: FAMILIAS[BONOS[t].familia].vence, error: "sin cotización" };
      return { ...analizar(t, px.precio, fechaLiq), especie: px.especie, variacion: px.variacion, volumen: px.volumen };
    });
    /* Diferencia por legislación: cuánto más rinde el bono local que su par
       de Nueva York. Mide la prima que pide el mercado por la ley argentina. */
    const spreads = filas.filter((f) => f.ley === "Argentina" && f.tir !== null).map((a) => {
      const g = filas.find((f) => f.ticker === a.par);
      return g?.tir !== null && g?.tir !== undefined ? { local: a.ticker, ny: g.ticker, puntosBasicos: (a.tir - g.tir) * 100, ratioPrecio: a.precio / g.precio } : null;
    }).filter(Boolean);
    return { fechaLiq, filas, spreads, fuente: "Cronogramas de las condiciones de emisión 2020 · precios de data912 (BYMA, con demora)" };
  });
}

/* Detalle de un bono: cronograma completo y TIR y paridad históricas
   recalculadas con el precio de cada día. */
export async function bonoDetalle(ticker) {
  const t = String(ticker).toUpperCase();
  if (!BONOS[t]) throw new HttpError(`${t} no está en la lista de bonos soberanos en dólares`, 404);
  const tabla = await bonosDolar();
  const actual = tabla.filas.find((f) => f.ticker === t);
  let historia = [], aviso = null;
  try {
    const h = await cached(`ar:hbono:${t}`, 3 * 3600e3, () => getJSON(`https://data912.com/historical/bonds/${t}D`));
    const desde = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    const filas = (Array.isArray(h) ? h : []).map((x) => ({ d: String(x.date).slice(0, 10), c: x.c })).filter((x) => x.c > 0 && x.d >= desde).sort((a, b) => a.d.localeCompare(b.d));
    const paso = Math.max(1, Math.floor(filas.length / 160));
    historia = filas.filter((_, i) => i % paso === 0 || i === filas.length - 1).map((x) => {
      const a = analizar(t, x.c, liquidacion(x.d));
      return { d: x.d, precio: x.c, tir: a.tir, paridad: a.paridad };
    }).filter((x) => x.tir !== null);
  } catch (e) { aviso = `Sin historia de precios: ${String(e.message).slice(0, 100)}`; }
  const hoy = tabla.fechaLiq;
  return {
    ...(actual || { ticker: t }),
    cronograma: cronograma(t).map((f) => ({ ...f, pagado: f.fecha <= hoy })),
    historia, aviso
  };
}
