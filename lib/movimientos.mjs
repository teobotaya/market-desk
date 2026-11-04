import { xtir, diasEntre } from "../public/js/finanzas.js";

/* Motor de movimientos de una cartera: tenencias a costo promedio
   ponderado, resultados realizados, rendimiento ponderado por tiempo (TWR)
   y por dinero (TIR de la cartera). Son funciones puras: reciben el dólar y
   los precios ya cargados, así se prueban sin red.

   Tipos de movimiento:
     compra / venta: ticker, cantidad, precio (en la moneda en que cotiza) y
                     comisión opcional en esa misma moneda.
     renta:          cobro de dividendo, cupón o amortización: monto y moneda.
   Cualquiera puede llevar su propio tipo de cambio (por ejemplo, el MEP al
   que se compraron los dólares); si no, se usa el CCL de esa fecha.

   El efectivo del cliente se carga a mano (es el saldo que informa el
   broker); el rendimiento se mide sobre lo invertido: cada compra es dinero
   que entra a la cartera y cada venta o renta, dinero que sale. */

const EPS = 1e-9;
const ORDEN = { compra: 0, renta: 1, venta: 2 };

/* En el mismo día, primero las compras: así comprar y vender en el día es válido. */
export const ordenar = (movs) => [...movs].sort((a, b) => a.fecha.localeCompare(b.fecha) || ORDEN[a.tipo] - ORDEN[b.tipo]);

/* Monto de un movimiento en su moneda, en dólares y en pesos. info(ticker)
   da { moneda, factor }: el factor es 1/100 en renta fija, que cotiza cada
   100 nominales. ccl(fecha) es el dólar contado con liquidación de ese día. */
export function montos(m, info, ccl) {
  let local, moneda;
  if (m.tipo === "renta") { local = m.monto; moneda = m.moneda; }
  else {
    const i = info(m.ticker);
    moneda = i.moneda;
    const bruto = m.cantidad * m.precio * i.factor;
    local = m.tipo === "compra" ? bruto + (m.comision || 0) : bruto - (m.comision || 0);
  }
  const c = m.tipoCambio > 0 ? m.tipoCambio : ccl(m.fecha);
  return {
    local, moneda,
    usd: moneda === "USD" ? local : c ? local / c : null,
    ars: moneda === "ARS" ? local : c ? local * c : null
  };
}

/* Verifica que ninguna venta supere la tenencia a su fecha. Devuelve el
   primer problema o null. */
export function ventaInvalida(movs) {
  const q = new Map();
  for (const m of ordenar(movs)) {
    if (m.tipo === "compra") q.set(m.ticker, (q.get(m.ticker) || 0) + m.cantidad);
    else if (m.tipo === "venta") {
      const t = q.get(m.ticker) || 0;
      if (m.cantidad > t + EPS) return { ...m, tenencia: t };
      q.set(m.ticker, t - m.cantidad);
    }
  }
  return null;
}

/* Tenencias a costo promedio ponderado (el "PPC" de los brokers). Una venta
   saca costo en proporción a lo vendido; la diferencia con lo cobrado es el
   resultado realizado, medido en dólares al CCL de cada fecha. */
export function tenencias(movs, info, ccl) {
  const t = new Map();
  const de = (ticker) => {
    if (!t.has(ticker)) t.set(ticker, { ticker, cantidad: 0, costoLocal: 0, costoUsd: 0, costoArs: 0, realizadoUsd: 0, realizadoArs: 0, rentasUsd: 0, rentasArs: 0, primeraCompra: null, ultimoMovimiento: null });
    return t.get(ticker);
  };
  const otrasRentas = { usd: 0, ars: 0 };
  for (const m of ordenar(movs)) {
    const v = montos(m, info, ccl);
    if (m.tipo === "renta") {
      const p = m.ticker ? de(m.ticker) : null;
      if (p) { p.rentasUsd += v.usd ?? 0; p.rentasArs += v.ars ?? 0; p.ultimoMovimiento = m.fecha; }
      else { otrasRentas.usd += v.usd ?? 0; otrasRentas.ars += v.ars ?? 0; }
      continue;
    }
    const p = de(m.ticker);
    if (m.tipo === "compra") {
      if (p.cantidad < EPS) p.primeraCompra = m.fecha;
      p.cantidad += m.cantidad;
      p.costoLocal += v.local; p.costoUsd += v.usd ?? 0; p.costoArs += v.ars ?? 0;
    } else {
      if (m.cantidad > p.cantidad + EPS) throw new Error(`La venta de ${m.cantidad} ${m.ticker} del ${m.fecha} supera la tenencia (${p.cantidad})`);
      const prop = Math.min(1, m.cantidad / p.cantidad);
      const cL = p.costoLocal * prop, cU = p.costoUsd * prop, cA = p.costoArs * prop;
      p.realizadoUsd += (v.usd ?? 0) - cU; p.realizadoArs += (v.ars ?? 0) - cA;
      p.cantidad -= m.cantidad; p.costoLocal -= cL; p.costoUsd -= cU; p.costoArs -= cA;
      if (p.cantidad < EPS) Object.assign(p, { cantidad: 0, costoLocal: 0, costoUsd: 0, costoArs: 0 });
    }
    p.ultimoMovimiento = m.fecha;
  }
  return { tenencias: [...t.values()], otrasRentas };
}

/* Valuador con puntero: valor(ticker, fecha) devuelve el valor de una unidad
   (precio × factor) en dólares y en pesos con el último precio conocido a esa
   fecha. Las fechas tienen que pedirse en orden creciente. */
export function crearValuador(series, info, ccl) {
  const pos = new Map();
  return (ticker, fecha) => {
    const s = series.get(ticker);
    if (!s?.length) return null;
    let i = pos.get(ticker) ?? -1;
    while (i + 1 < s.length && s[i + 1].d <= fecha) i++;
    pos.set(ticker, i);
    if (i < 0) return null;
    const { moneda, factor } = info(ticker);
    const local = s[i].c * factor, c = ccl(fecha);
    if (!c) return null;
    return { usd: moneda === "USD" ? local : local / c, ars: moneda === "ARS" ? local : local * c };
  };
}

/* Rendimiento ponderado por tiempo (TWR). Cada día se parte en dos tramos:
     1. lo que ya estaba en la cartera, del cierre anterior al cierre de hoy
        (las ventas y rentas del día salen a su precio):
        r₁ = (valor al cierre de lo que quedó + ventas + rentas) / V₋₁ − 1
     2. lo comprado hoy, desde su precio de compra hasta el cierre:
        r₂ = (lo que quedó + lo comprado al cierre) / (lo que quedó + costo) − 1
   y se encadena (1+r₁)(1+r₂). Encadenar los días neutraliza cuándo y cuánto
   dinero se puso, que es lo que permite comparar contra un índice (es el
   criterio de GIPS). Devuelve la serie de valor y el índice base 100. */
export function twr(fechas, movs, info, ccl, valor) {
  const ord = ordenar(movs);
  const q = new Map();
  let k = 0, prevU = 0, prevA = 0, iU = 1, iA = 1, empezo = false, rentasU = 0;
  let pendientes = [];
  const serie = [];
  for (const f of fechas) {
    while (k < ord.length && ord[k].fecha <= f) pendientes.push(ord[k++]);
    /* Por activo: cuánto se compró y vendió hoy, con sus montos. */
    const hoyT = new Map();
    const de = (t) => { if (!hoyT.has(t)) hoyT.set(t, { b: 0, s: 0, inU: 0, inA: 0, pU: 0, pA: 0 }); return hoyT.get(t); };
    let rentaU = 0, rentaA = 0;
    for (const m of pendientes) {
      const v = montos(m, info, ccl);
      if (v.usd === null || v.ars === null) continue;
      if (m.tipo === "compra") { const x = de(m.ticker); x.b += m.cantidad; x.inU += v.usd; x.inA += v.ars; }
      else if (m.tipo === "venta") { const x = de(m.ticker); x.s += m.cantidad; x.pU += v.usd; x.pA += v.ars; }
      else { rentaU += v.usd; rentaA += v.ars; }
    }
    /* Valor al cierre de lo que quedó de antes (E) y de lo comprado hoy (N). */
    let EU = 0, EA = 0, NU = 0, NA = 0, out1U = rentaU, out1A = rentaA, out2U = 0, out2A = 0, inU = 0, inA = 0, falta = false;
    const nuevaQ = new Map(q);
    for (const t of new Set([...q.keys(), ...hoyT.keys()])) {
      const q0 = q.get(t) || 0, x = hoyT.get(t) || { b: 0, s: 0, inU: 0, inA: 0, pU: 0, pA: 0 };
      const deAntes = Math.min(x.s, q0), frac = x.s ? deAntes / x.s : 0;
      const quedaAntes = q0 - deAntes, quedaNuevo = x.b - (x.s - deAntes);
      out1U += x.pU * frac; out1A += x.pA * frac; out2U += x.pU * (1 - frac); out2A += x.pA * (1 - frac);
      inU += x.inU; inA += x.inA;
      nuevaQ.set(t, quedaAntes + quedaNuevo);
      if (quedaAntes <= EPS && quedaNuevo <= EPS) continue;
      const u = valor(t, f);
      if (!u) { falta = true; break; }
      EU += quedaAntes * u.usd; EA += quedaAntes * u.ars; NU += quedaNuevo * u.usd; NA += quedaNuevo * u.ars;
    }
    /* Un día sin precio de alguna tenencia se saltea: sus movimientos pasan al siguiente. */
    if (falta) continue;
    const tramo = (prev, E, out1, N, out2, entra) => {
      const r1 = prev > EPS ? (E + out1) / prev : 1;
      const r2 = E + entra > EPS ? (E + N + out2) / (E + entra) : 1;
      return r1 * r2;
    };
    if (prevU > EPS || inU > EPS) {
      iU *= tramo(prevU, EU, out1U, NU, out2U, inU);
      iA *= tramo(prevA, EA, out1A, NA, out2A, inA);
      empezo = true;
    }
    rentasU += rentaU;
    for (const [t, n] of nuevaQ) if (n > EPS) q.set(t, n); else q.delete(t);
    pendientes = [];
    prevU = EU + NU; prevA = EA + NA;
    if (empezo) serie.push({ d: f, usd: prevU, ars: prevA, iUsd: iU * 100, iArs: iA * 100 });
  }
  if (serie.length < 2) return null;
  const desde = serie[0].d, hasta = serie.at(-1).d;
  const anios = diasEntre(desde, hasta) / 365;
  const anual = (i) => (anios >= 1 ? ((i / 100) ** (1 / anios) - 1) * 100 : null);
  return {
    serie, desde, hasta, anios, rentasUsd: rentasU,
    usd: iU * 100 - 100, ars: iA * 100 - 100,
    usdAnual: anual(iU * 100), arsAnual: anual(iA * 100)
  };
}

/* Rendimientos mensuales encadenados a partir del índice TWR: { "2026-03": % }. */
export function mensuales(serie, campo = "iUsd") {
  const out = {};
  /* El índice arranca en 100 antes del primer día de la serie. */
  let base = null, mes = null, ultimo = 100;
  for (const x of serie) {
    const m = x.d.slice(0, 7);
    if (m !== mes) {
      if (mes && base) out[mes] = (ultimo / base - 1) * 100;
      base = ultimo; mes = m;
    }
    ultimo = x[campo];
  }
  if (mes && base) out[mes] = (ultimo / base - 1) * 100;
  return out;
}

/* TIR de la cartera (rendimiento ponderado por dinero, como XTIR): las
   compras son aportes, las ventas y rentas son retiros, y el valor de hoy
   es el retiro final. Mide lo que ganó el cliente con sus decisiones de
   cuándo y cuánto invertir. También el múltiplo simple sobre lo invertido. */
export function tirCartera(movs, info, ccl, final, hoy) {
  const flujos = (mon) => {
    const fl = [];
    for (const m of ordenar(movs)) {
      const v = montos(m, info, ccl)[mon];
      if (v === null) return null;
      fl.push({ fecha: m.fecha, monto: m.tipo === "compra" ? -v : v });
    }
    fl.push({ fecha: hoy, monto: final[mon] });
    return fl;
  };
  const r = {};
  for (const mon of ["usd", "ars"]) {
    const fl = flujos(mon);
    if (!fl || final[mon] === null) { r[mon] = null; r[`${mon}Simple`] = null; continue; }
    const puesto = -fl.filter((f) => f.monto < 0).reduce((s, f) => s + f.monto, 0);
    const sacado = fl.filter((f) => f.monto > 0).reduce((s, f) => s + f.monto, 0);
    const dias = fl.length > 1 ? diasEntre(fl[0].fecha, hoy) : 0;
    r[mon] = dias >= 30 ? xtir(fl) : null;
    r[`${mon}Simple`] = puesto ? (sacado / puesto - 1) * 100 : null;
  }
  return r;
}

/* Rebalanceo hacia una cartera objetivo. objetivo: [{ ticker, peso }] en %;
   lo que no suma 100 es efectivo. Marca lo que se sale de la banda (en
   puntos porcentuales) y calcula cuánto comprar o vender para volver. */
export function rebalanceo(posiciones, objetivo, totalUsd, efectivoUsd, banda = 5) {
  if (!objetivo?.length || !(totalUsd > 0)) return null;
  const obj = new Map(objetivo.map((o) => [o.ticker, o.peso]));
  const tickers = [...new Set([...objetivo.map((o) => o.ticker), ...posiciones.map((p) => p.ticker)])];
  const filas = tickers.map((t) => {
    const p = posiciones.find((x) => x.ticker === t);
    const actual = p ? (p.valorUsd / totalUsd) * 100 : 0;
    const meta = obj.get(t) ?? 0;
    const montoUsd = ((meta - actual) / 100) * totalUsd;
    const unidad = p?.unidadUsd || null;
    return { ticker: t, actual, objetivo: meta, desvio: actual - meta, fuera: Math.abs(actual - meta) > banda, montoUsd, cantidad: unidad ? montoUsd / unidad : null };
  });
  const metaEfectivo = Math.max(0, 100 - objetivo.reduce((s, o) => s + o.peso, 0));
  const actualEfectivo = (efectivoUsd / totalUsd) * 100;
  filas.push({ ticker: "Efectivo", actual: actualEfectivo, objetivo: metaEfectivo, desvio: actualEfectivo - metaEfectivo, fuera: Math.abs(actualEfectivo - metaEfectivo) > banda, montoUsd: ((metaEfectivo - actualEfectivo) / 100) * totalUsd, cantidad: null });
  return { banda, filas: filas.sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio)), fuera: filas.filter((f) => f.fuera).length };
}

/* Contribución de cada posición al riesgo de la cartera: wᵢ·(Σw)ᵢ / wᵀΣw.
   Suma 100%; una posición puede pesar 10% y aportar 30% del riesgo. */
export function contribucionRiesgo(pesos, cov) {
  const sw = cov.map((fila) => fila.reduce((s, c, j) => s + c * pesos[j], 0));
  const varianza = pesos.reduce((s, w, i) => s + w * sw[i], 0);
  if (!(varianza > 0)) return null;
  return pesos.map((w, i) => (w * sw[i] / varianza) * 100);
}
