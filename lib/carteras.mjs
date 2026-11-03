import { HttpError, enParalelo } from "./http.mjs";
import { price, resolver, consensoYahoo } from "./precios.mjs";
import { fundamentales } from "./sec.mjs";
import { fredSerie } from "./mercado.mjs";
import { riesgoPais, convertirACcl } from "./argentina.mjs";
import { perfilRiesgo } from "./indicadores.mjs";
import { regresion, covarianza, correlacion, estadisticasCartera, simularCarteras } from "../public/js/finanzas.js";

/* Supuestos para las calculadoras (CAPM, WACC, DCF), tomados de los datos
   reales del activo. Todos son editables en la pantalla: son un punto de
   partida, no una verdad. */

const haceUnAnio = () => new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);

async function tasaLibre(id = "DGS10") {
  const s = await fredSerie(id, haceUnAnio());
  const u = s.at(-1);
  return u ? { valor: u.v, fecha: u.d, fuente: `FRED ${id}` } : null;
}

export async function supuestos(ticker) {
  const r = resolver(ticker);
  const esAr = r.tipo === "ar";
  const [rf, rp, beta, fund, cons] = await Promise.allSettled([
    tasaLibre("DGS10"),
    riesgoPais(),
    (async () => {
      const a = await price(ticker, { rango: "2y" });
      const ref = await price(esAr ? "^MERV" : "SPY", { rango: "2y" });
      return { beta: perfilRiesgo(a.candles, ref.candles).beta, referencia: ref.ticker, precio: a.stats.last, moneda: a.moneda };
    })(),
    fundamentales(ticker),
    consensoYahoo(ticker)
  ]);
  const v = (x) => (x.status === "fulfilled" ? x.value : null);
  const f = v(fund), t = f?.ttm, val = f?.valuacion;
  const filas = f?.filas?.filter((x) => x.ingresos > 0) || [];
  const cagr = filas.length > 1 ? ((filas.at(-1).ingresos / filas[0].ingresos) ** (1 / (filas.at(-1).fy - filas[0].fy || 1)) - 1) * 100 : null;
  const est = v(cons)?.estimaciones?.find((e) => e.periodo === "Próximo ejercicio");
  const avisos = [rf, rp, beta, fund].filter((x) => x.status === "rejected").map((x) => String(x.reason?.message || x.reason).slice(0, 140));
  return {
    ticker: r.pedido,
    esArgentina: esAr,
    rf: v(rf),
    riesgoPais: v(rp) ? { valor: v(rp).valor / 100, fecha: v(rp).fecha } : null,
    beta: v(beta)?.beta ?? null, referenciaBeta: v(beta)?.referencia ?? null,
    precio: val?.precio ?? v(beta)?.precio ?? null, moneda: val?.moneda ?? v(beta)?.moneda ?? null,
    E: val?.capitalizacion ?? null,
    D: t?.deuda ?? null,
    deudaNeta: t?.deudaNeta ?? null,
    acciones: val?.acciones ?? null,
    fcf: t?.fcf ?? null,
    kd: t?.intereses && t?.deuda ? (Math.abs(t.intereses) / t.deuda) * 100 : null,
    tasaImpositiva: t?.tasaImpositiva ?? null,
    crecimientoHistorico: cagr,
    crecimientoEstimado: est?.crecimientoIngresos ?? null,
    empresa: f?.empresa ?? null,
    avisos
  };
}

/* ------------------------------------------------------------------ APT */

export const FACTORES = {
  SPY: "Mercado (S&P 500)", IEF: "Tasas (bonos del Tesoro 7-10 años)", UUP: "Dólar global", USO: "Petróleo",
  GLD: "Oro", EEM: "Emergentes", "^MERV": "Merval", QQQ: "Tecnología (Nasdaq 100)", IWM: "Empresas chicas (Russell 2000)"
};

/* Series en dólares: lo que cotiza en pesos se convierte por el CCL del día. */
async function seriesUsd(tickers, rango = "2y") {
  const res = await enParalelo(tickers, 4, async (t) => {
    const p = await price(t, { rango });
    return p.moneda === "ARS" ? convertirACcl(p) : p;
  });
  return res;
}

function alinear(series) {
  const mapas = series.map((p) => new Map(p.candles.map((c) => [c.d, c.c])));
  const fechas = series[0].candles.map((c) => c.d).filter((d) => mapas.every((m) => m.has(d)));
  return { fechas, valores: mapas.map((m) => fechas.map((d) => m.get(d))) };
}

const retornos = (v) => v.slice(1).map((x, i) => x / v[i] - 1);
const media = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/* Regresión de los retornos semanales del activo contra los de cada factor:
   las betas del modelo APT. Semanal en lugar de diario para que el ruido de
   un día no domine, y porque los mercados cierran a distintas horas. */
export async function apt(ticker, factores) {
  const lista = factores.length ? factores.slice(0, 6) : ["SPY", "IEF", "UUP", "USO", "GLD"];
  const res = await seriesUsd([ticker, ...lista]);
  if (!res[0].ok) throw new HttpError(`No pude bajar ${ticker}: ${res[0].error}`, 502);
  const ok = res.map((r, i) => ({ r, t: [ticker, ...lista][i] })).filter((x, i) => i === 0 || x.r.ok);
  const fallidos = res.slice(1).map((r, i) => (r.ok ? null : `${lista[i]}: ${String(r.error).slice(0, 80)}`)).filter(Boolean);
  if (ok.length < 2) throw new HttpError("No hay factores con datos para la regresión", 502);
  const { fechas, valores } = alinear(ok.map((x) => x.r.valor));
  const semanal = valores.map((v) => v.filter((_, i) => i % 5 === 0));
  const rets = semanal.map(retornos);
  const y = rets[0];
  const X = y.map((_, t) => rets.slice(1).map((r) => r[t]));
  const reg = regresion(y, X);
  if (!reg) throw new HttpError("No hay suficientes semanas en común para estimar el modelo", 422);
  let rf = null;
  try { rf = await tasaLibre("DGS3MO"); } catch { /* sin tasa, la prima queda en manos del usuario */ }
  return {
    ticker: ok[0].r.valor.ticker,
    desde: fechas[0], hasta: fechas.at(-1), semanas: y.length,
    alfaAnual: reg.alfa * 52 * 100, tAlfa: reg.tAlfa, r2: reg.r2,
    factores: ok.slice(1).map((x, i) => ({
      ticker: x.r.valor.ticker, nombre: FACTORES[x.t] || x.r.valor.nombre || x.t,
      beta: reg.betas[i], t: reg.tBetas[i],
      retornoAnual: media(rets[i + 1]) * 52 * 100
    })),
    rf, fallidos
  };
}

/* ------------------------------------------------------------ carteras */

/* Retorno y volatilidad históricos de cada activo, correlaciones, la cartera
   que eligió la persona y las de mínima volatilidad y máximo Sharpe de una
   simulación de miles de combinaciones (sin ventas en corto). */
export async function optimizar(tickers, pesosTxt = [], rfPedida = null) {
  const lista = [...new Set(tickers.map((x) => x.trim().toUpperCase()).filter(Boolean))].slice(0, 12);
  if (lista.length < 2) throw new HttpError("Necesito al menos dos activos para armar una cartera", 400);
  const res = await seriesUsd(lista);
  const errores = res.map((r, i) => (r.ok ? null : `${lista[i]}: ${String(r.error).slice(0, 80)}`)).filter(Boolean);
  const validos = lista.map((t, i) => ({ t, r: res[i], peso: Number(pesosTxt[i]) })).filter((x) => x.r.ok);
  if (validos.length < 2) throw new HttpError(`Solo hay datos para ${validos.length} activo(s). ${errores.join(" · ")}`, 502);
  const { fechas, valores } = alinear(validos.map((x) => x.r.valor));
  if (fechas.length < 60) throw new HttpError("Los activos tienen muy pocas ruedas en común", 422);
  const rets = valores.map(retornos);
  const medias = rets.map((r) => media(r) * 252 * 100);
  const cov = covarianza(rets).map((fila) => fila.map((v) => v * 252 * 10000));
  let rf = Number.isFinite(rfPedida) ? rfPedida : null;
  if (rf === null) { try { rf = (await tasaLibre("DGS3MO"))?.valor ?? 0; } catch { rf = 0; } }
  const sumaPesos = validos.reduce((s, x) => s + (x.peso > 0 ? x.peso : 0), 0);
  const pesos = validos.map((x) => (sumaPesos > 0 ? (x.peso > 0 ? x.peso : 0) / sumaPesos : 1 / validos.length));
  const sim = simularCarteras(medias, cov, rf, 5000);
  const paso = Math.max(1, Math.floor(sim.puntos.length / 700));
  return {
    activos: validos.map((x, i) => ({ ticker: x.r.valor.ticker, nombre: x.r.valor.nombre, retorno: medias[i], vol: Math.sqrt(cov[i][i]), moneda: x.r.valor.moneda })),
    correlacion: correlacion(cov),
    usuario: { pesos, ...estadisticasCartera(pesos, medias, cov, rf) },
    minVar: sim.minVar, maxSharpe: sim.maxSharpe,
    nube: sim.puntos.filter((_, i) => i % paso === 0).map((p) => ({ vol: p.vol, retorno: p.retorno })),
    desde: fechas[0], hasta: fechas.at(-1), ruedas: fechas.length, rf, errores,
    aviso: "Retornos y volatilidades del pasado, anualizados y en dólares (lo que cotiza en pesos se pasa a CCL). Una cartera óptima con datos pasados no lo es necesariamente hacia adelante."
  };
}
