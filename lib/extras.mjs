import { cached, getJSON, HttpError } from "./http.mjs";
import { FINNHUB_KEY } from "./config.mjs";
import { resolver } from "./precios.mjs";

/* ------------------------------------------- volatilidad implícita */

/* data912 calcula, al cierre, la volatilidad implícita de las opciones de
   acciones de EE.UU. y su percentil histórico: el "IV rank" que muestran las
   plataformas pagas de opciones. Dice cuánto movimiento está pagando el
   mercado de opciones hoy comparado con su propia historia. */
export async function volatilidadImplicita(ticker) {
  const r = resolver(ticker);
  if (r.tipo !== "us") throw new HttpError("La volatilidad implícita solo está disponible para acciones de EE.UU. con opciones", 422);
  return cached(`iv:${r.us}`, 3 * 3600e3, async () => {
    const j = await getJSON(`https://data912.com/eod/volatilities/${encodeURIComponent(r.us)}`, { timeout: 12000 });
    const d = Array.isArray(j) ? j[0] : j;
    if (!d || d.iv_m_term === undefined) throw new HttpError(`data912 no tiene volatilidades para ${r.us}`, 404);
    const pctje = (x) => (x === null || x === undefined ? null : Math.abs(x) <= 3 ? x * 100 : x);
    const pc = (x) => (x === null || x === undefined ? null : x <= 1 ? x * 100 : x);
    return {
      ticker: r.us,
      plazos: ["s", "m", "l"].map((p) => ({
        plazo: { s: "Corto", m: "Medio", l: "Largo" }[p],
        iv: pctje(d[`iv_${p}_term`]), ivPercentil: pc(d[`iv_${p}_term_percentile`]),
        hv: pctje(d[`hv_${p}_term`]), hvPercentil: pc(d[`hv_${p}_term_percentile`]),
        ivHv: d[`iv_hv_${p}_ratio`] ?? null
      })),
      ivJusta: pctje(d.fair_iv), ivSobreJusta: d.iv_fair_iv_ratio ?? null,
      fuente: "data912 (cierre del día anterior)"
    };
  });
}

/* ---------------------------------------------------------- Finnhub */

/* Opcional. Con una clave gratuita (finnhub.io, 60 consultas por minuto)
   suma recomendaciones, sorpresas de ganancias, pares de la industria y
   métricas básicas cuando Yahoo no las entrega. */
export const finnhubActivo = () => Boolean(FINNHUB_KEY);

async function fh(ruta) {
  if (!FINNHUB_KEY) throw new HttpError("Sin FINNHUB_API_KEY en el .env", 400);
  const sep = ruta.includes("?") ? "&" : "?";
  return getJSON(`https://finnhub.io/api/v1${ruta}${sep}token=${FINNHUB_KEY}`, { fuente: "Finnhub", timeout: 12000 });
}

export async function finnhubResumen(ticker) {
  const r = resolver(ticker);
  if (r.tipo !== "us") throw new HttpError("Finnhub gratuito cubre acciones de EE.UU.", 422);
  return cached(`fh:${r.us}`, 60 * 60e3, async () => {
    const [rec, ganancias, pares, metricas] = await Promise.allSettled([
      fh(`/stock/recommendation?symbol=${r.us}`),
      fh(`/stock/earnings?symbol=${r.us}`),
      fh(`/stock/peers?symbol=${r.us}`),
      fh(`/stock/metric?symbol=${r.us}&metric=all`)
    ]);
    const v = (x) => (x.status === "fulfilled" ? x.value : null);
    const m = v(metricas)?.metric || {};
    return {
      ticker: r.us,
      tendencia: (v(rec) || []).slice(0, 4).map((t) => ({ periodo: t.period, compraFuerte: t.strongBuy, compra: t.buy, mantener: t.hold, venta: t.sell, ventaFuerte: t.strongSell })),
      historia: (v(ganancias) || []).map((g) => ({ trimestre: g.period, real: g.actual, estimado: g.estimate, sorpresaPct: g.surprisePercent })),
      pares: (v(pares) || []).filter((x) => x !== r.us).slice(0, 8),
      metricas: {
        per: m.peTTM ?? null, precioVentas: m.psTTM ?? null, beta: m.beta ?? null,
        margenBruto: m.grossMarginTTM ?? null, margenOperativo: m.operatingMarginTTM ?? null, roe: m.roeTTM ?? null,
        crecimientoIngresos3a: m.revenueGrowth3Y ?? null, rentaDividendo: m.dividendYieldIndicatedAnnual ?? null
      },
      fuente: "Finnhub (plan gratuito)"
    };
  });
}
