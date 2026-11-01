/* Bloques de texto que comparten varios prompts. Mismo formato numérico que
   la pantalla, para que lo que lee el modelo coincida con lo que ve la persona. */

import { num, pct, pctS, precio, grande, veces, fecha } from "../util.js";

export function bloquePrecio(p) {
  const s = p.stats;
  return [
    `${p.ticker}${p.nombre ? ` (${p.nombre})` : ""} · ${p.moneda} · último ${precio(s.last)} del ${fecha(s.date)} · fuente ${p.source}`,
    `Rendimiento: 1d ${pctS(s.ret1)} · 5d ${pctS(s.ret5)} · 1m ${pctS(s.ret21)} · 3m ${pctS(s.ret63)} · 6m ${pctS(s.ret126)} · en el año ${pctS(s.retYtd)} · 1a ${pctS(s.ret252)}`,
    `Volatilidad anualizada: 21d ${pct(s.vol21)} · 63d ${pct(s.vol63)} · 1a ${pct(s.vol252)}`,
    `ATR(14): ${precio(s.atr14)} (${pct(s.atrPct)} del precio)`,
    `Medias: SMA20 ${precio(s.sma20)} (${pctS(s.vsSma20, 1)}) · SMA50 ${precio(s.sma50)} (${pctS(s.vsSma50, 1)}) · SMA200 ${precio(s.sma200)} (${pctS(s.vsSma200, 1)})`,
    s.cruce ? `Último cruce 50/200: ${s.cruce.tipo === "dorado" ? "dorado" : "de la muerte"} el ${fecha(s.cruce.fecha)}` : "",
    `RSI(14) ${num(s.rsi14, 0)} · MACD ${num(s.macd, 3)} vs señal ${num(s.macdSenal, 3)} · Bollinger %B ${num(s.bbPctB, 2)}`,
    `Rango 52 semanas: ${precio(s.low52)} – ${precio(s.high52)} · desde el máximo ${pctS(s.fromHigh)} · desde el mínimo ${pctS(s.fromLow)}`,
    `Drawdown máximo del último año: ${pct(s.maxDrawdown)} · volumen relativo de la última rueda ${veces(s.relVol, 2)}`,
    p.rentaDividendo ? `Renta por dividendo de los últimos 12 meses: ${pct(p.rentaDividendo, 2)}` : ""
  ].filter(Boolean).join("\n");
}

export function bloqueFundamentales(f) {
  const t = f.ttm, v = f.valuacion;
  return [
    `${f.empresa} (${f.ticker}) · estados en ${f.moneda} · últimos 12 meses: ${t.base}`,
    `Ingresos ${grande(t.ingresos)} (crecimiento ${pctS(t.crecimiento, 1)}) · margen bruto ${pct(t.margenBruto)} · operativo ${pct(t.margenOperativo)} · neto ${pct(t.margenNeto)}`,
    `Flujo de caja libre ${grande(t.fcf)} (margen ${pct(t.margenFcf)}, conversión ${pct(t.conversion, 0)} del beneficio) · ROIC ${pct(t.roic)} · ROE ${pct(t.roe)}`,
    `Deuda neta ${grande(t.deudaNeta)} · deuda neta/EBITDA ${veces(t.deudaNetaEbitda, 2)} · cobertura de intereses ${veces(t.cobertura)}`,
    v ? `Valuación: capitalización ${grande(v.capitalizacion)} · PER ${veces(v.per)} · P/V ${veces(v.precioVentas)} · EV/EBITDA ${veces(v.evEbitda)} · rentabilidad FCF ${pct(v.rentabilidadFcf)} · P/libro ${veces(v.precioLibro)}` : `Valuación: ${f.avisoValuacion || "no disponible"}`
  ].join("\n");
}

export function bloqueConsenso(c) {
  if (!c) return "";
  const o = c.objetivo || {};
  const t = c.tendencia?.[0];
  return [
    `Consenso (${c.fuente}): ${c.analistas ?? "—"} analistas · recomendación media ${num(c.recomendacionMedia, 2)} (1 = compra fuerte, 5 = venta)`,
    o.medio ? `Precio objetivo: medio ${precio(o.medio)} · bajo ${precio(o.bajo)} · alto ${precio(o.alto)}` : "",
    t ? `Distribución actual: ${t.compraFuerte} compra fuerte, ${t.compra} compra, ${t.mantener} mantener, ${t.venta} venta, ${t.ventaFuerte} venta fuerte` : "",
    c.proximoBalance ? `Próximo balance: ${fecha(c.proximoBalance)}` : "",
    c.historia?.length ? `Sorpresas de BPA recientes: ${c.historia.map((h) => `${fecha(h.trimestre)} ${pctS(h.sorpresaPct, 1)}`).join(" · ")}` : ""
  ].filter(Boolean).join("\n");
}

export const REGLAS = "Reglas: no recomiendes comprar, vender ni mantener. No des precio objetivo propio. Cada afirmación apoyada en una cifra de arriba o declarada como supuesto.";
