import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./config.mjs";
import { HttpError, enParalelo, hoyISO } from "./http.mjs";
import { price, resolver } from "./precios.mjs";
import { historiaDolar, dolares, panel, inflacionMensual } from "./argentina.mjs";
import { perfilRiesgo } from "./indicadores.mjs";
import { BONOS, cronograma, analizar } from "./bonos.mjs";
import { TASA_FIJA, DOLAR_NUEVOS, ONS } from "./instrumentos.mjs";
import { ordenar, montos, ventaInvalida, tenencias, crearValuador, twr, mensuales, tirCartera, rebalanceo, contribucionRiesgo } from "./movimientos.mjs";
import { covarianza, medidasBono, liquidacion, diasEntre } from "../public/js/finanzas.js";
import { PREGUNTAS, puntuar, vencimiento, masAgresivo } from "../public/js/perfil.js";

/* Clientes y sus carteras. Se guardan en datos/clientes.json, en esta
   máquina: la carpeta datos/ está en el .gitignore y nunca se sube al
   repositorio. Para respaldar, alcanza con copiar ese archivo.

   La cartera se arma con movimientos (compras, ventas y rentas cobradas):
   de ahí salen las tenencias a costo promedio, el resultado realizado y no
   realizado, y el rendimiento comparable contra índices. */

const dir = () => process.env.MD_DATOS || path.join(ROOT, "datos");
const archivo = () => path.join(dir(), "clientes.json");

/* Criterios por defecto de cada perfil. La persona puede cambiarlos cliente
   por cliente; estos son solo un punto de partida razonable. */
export const PERFILES = {
  conservador: { volMax: 15, ddMax: 15, pesoMax: 15, stopLoss: 10, volMaxPosicion: 30, liquidezMin: 10, banda: 5 },
  moderado: { volMax: 25, ddMax: 25, pesoMax: 20, stopLoss: 15, volMaxPosicion: 45, liquidezMin: 5, banda: 5 },
  agresivo: { volMax: 40, ddMax: 40, pesoMax: 30, stopLoss: 25, volMaxPosicion: 70, liquidezMin: 0, banda: 7 }
};
const HORIZONTES = ["corto", "medio", "largo"];
const TIPOS = ["compra", "venta", "renta"];
const CONCEPTOS = ["dividendo", "cupón", "amortización", "otro"];
const MAX_MOVIMIENTOS = 3000;

/* ---------------------------------------------------------- persistencia */

/* Las carteras de la versión anterior tenían "posiciones" (una compra cada
   una). Al leerlas se convierten en movimientos de compra, sin perder nada. */
const aCompra = (p) => ({ id: p.id, tipo: "compra", ticker: p.ticker, cantidad: p.cantidad, precio: p.precioCompra ?? p.precio, fecha: p.fechaCompra ?? p.fecha, nota: p.nota || "" });
function migrar(c) {
  if (!Array.isArray(c.movimientos)) c.movimientos = (c.posiciones || []).map(aCompra);
  delete c.posiciones;
  return c;
}

async function leer() {
  try {
    const d = JSON.parse(await fs.readFile(archivo(), "utf8"));
    d.clientes = (d.clientes || []).map(migrar);
    return d;
  } catch (e) {
    if (e.code === "ENOENT") return { version: 2, clientes: [] };
    throw new HttpError(`No pude leer ${archivo()}: ${e.message}`, 500);
  }
}

/* Escritura atómica (archivo temporal + renombre) y en cola, para que dos
   guardados simultáneos no se pisen ni dejen el archivo a medio escribir. */
let cola = Promise.resolve();
function guardar(mutar) {
  const tarea = cola.then(async () => {
    const datos = await leer();
    const resultado = await mutar(datos);
    datos.version = 2;
    await fs.mkdir(dir(), { recursive: true });
    const tmp = `${archivo()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(datos, null, 2));
    await fs.rename(tmp, archivo());
    return resultado;
  });
  cola = tarea.catch(() => {});
  return tarea;
}

/* ------------------------------------------------------------ validación */

const texto = (v, max) => String(v ?? "").trim().slice(0, max);
const numero = (v, { min = -Infinity, max = Infinity, def = null } = {}) => {
  const n = typeof v === "string" ? Number(v.replace(/\./g, (m, i, s) => (s.includes(",") ? "" : m)).replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const fechaValida = (f) => (/^\d{4}-\d{2}-\d{2}$/.test(f || "") && !Number.isNaN(Date.parse(f)) && f <= hoyISO() ? f : null);
const tickerValido = (t) => {
  const ticker = texto(t, 20).toUpperCase();
  try { resolver(ticker); } catch { throw new HttpError(`Ticker inválido: "${ticker}"`, 400); }
  return ticker;
};

function validarMovimiento(m) {
  const tipo = TIPOS.includes(m.tipo) ? m.tipo : "compra";
  const fecha = fechaValida(m.fecha) || hoyISO();
  const base = { id: /^[a-z0-9]{6,20}$/.test(m.id || "") ? m.id : crypto.randomBytes(5).toString("hex"), tipo, fecha, nota: texto(m.nota, 200) };
  if (tipo === "renta") {
    const monto = numero(m.monto, { min: 0 });
    if (!(monto > 0)) throw new HttpError("El monto de la renta tiene que ser mayor que cero", 400);
    return { ...base, ticker: m.ticker ? tickerValido(m.ticker) : "", monto, moneda: m.moneda === "ARS" ? "ARS" : "USD", concepto: CONCEPTOS.includes(m.concepto) ? m.concepto : "otro" };
  }
  const ticker = tickerValido(m.ticker);
  const cantidad = numero(m.cantidad, { min: 0 });
  if (!(cantidad > 0)) throw new HttpError(`La cantidad de ${ticker} tiene que ser mayor que cero`, 400);
  const precio = numero(m.precio, { min: 0 });
  if (precio === null) throw new HttpError(`Falta el precio de ${ticker}`, 400);
  return { ...base, ticker, cantidad, precio, comision: numero(m.comision, { min: 0, def: 0 }) };
}

function validarCuestionario(q, previo) {
  if (q === undefined) return previo || null;
  if (q === null) return null;
  const respuestas = Object.fromEntries(PREGUNTAS.map((p) => [p.id, Number.isInteger(q.respuestas?.[p.id]) ? q.respuestas[p.id] : null]));
  const r = puntuar(respuestas);
  if (!r.completo) throw new HttpError(`Faltan respuestas del cuestionario: ${r.faltan.join(", ")}`, 400);
  return {
    respuestas, puntaje: r.puntaje, sugerido: r.sugerido,
    fecha: fechaValida(q.fecha) || hoyISO(),
    /* Perfil transaccional (UIF): lo que el cliente estima operar y de dónde salen los fondos. */
    montoAnual: numero(q.montoAnual, { min: 0, def: null }),
    origenFondos: texto(q.origenFondos, 200)
  };
}

function validarObjetivo(lista, previo) {
  if (lista === undefined) return previo || [];
  if (!Array.isArray(lista)) throw new HttpError("La cartera objetivo tiene que ser una lista", 400);
  const out = lista.filter((o) => o && o.ticker).map((o) => ({ ticker: tickerValido(o.ticker), peso: numero(o.peso, { min: 0, max: 100, def: 0 }) })).filter((o) => o.peso > 0);
  if (out.reduce((s, o) => s + o.peso, 0) > 100.0001) throw new HttpError("Los pesos de la cartera objetivo suman más de 100%", 400);
  if (new Set(out.map((o) => o.ticker)).size !== out.length) throw new HttpError("Hay un activo repetido en la cartera objetivo", 400);
  return out.slice(0, 60);
}

function validarCliente(c, previo = {}) {
  const nombre = texto(c.nombre ?? previo.nombre, 120);
  if (!nombre) throw new HttpError("El cliente necesita un nombre", 400);
  const perfil = PERFILES[c.perfil] ? c.perfil : (previo.perfil || "moderado");
  const base = PERFILES[perfil];
  const crit = { ...base, ...(previo.criterios || {}), ...(c.criterios || {}) };
  const criterios = Object.fromEntries(Object.keys(base).map((k) => [k, numero(crit[k], { min: 0, max: 1000, def: base[k] })]));
  /* Se aceptan "posiciones" (formato anterior) como compras. */
  const crudos = Array.isArray(c.movimientos) ? c.movimientos : Array.isArray(c.posiciones) ? c.posiciones.map(aCompra) : (previo.movimientos || []);
  if (crudos.length > MAX_MOVIMIENTOS) throw new HttpError(`Máximo ${MAX_MOVIMIENTOS} movimientos por cliente`, 400);
  const movimientos = ordenar(crudos.map(validarMovimiento));
  const mal = ventaInvalida(movimientos);
  if (mal) throw new HttpError(`La venta de ${mal.cantidad} ${mal.ticker} del ${mal.fecha} supera la tenencia a esa fecha (${mal.tenencia})`, 400);
  return {
    id: previo.id || `c${crypto.randomBytes(5).toString("hex")}`,
    nombre,
    email: texto(c.email ?? previo.email, 120),
    telefono: texto(c.telefono ?? previo.telefono, 40),
    perfil,
    horizonte: HORIZONTES.includes(c.horizonte) ? c.horizonte : (previo.horizonte || "medio"),
    objetivo: texto(c.objetivo ?? previo.objetivo, 300),
    notas: texto(c.notas ?? previo.notas, 3000),
    efectivo: {
      ARS: numero(c.efectivo?.ARS ?? previo.efectivo?.ARS, { min: 0, def: 0 }),
      USD: numero(c.efectivo?.USD ?? previo.efectivo?.USD, { min: 0, def: 0 })
    },
    criterios,
    cuestionario: validarCuestionario(c.cuestionario, previo.cuestionario),
    asignacion: validarObjetivo(c.asignacion, previo.asignacion),
    movimientos,
    creado: previo.creado || new Date().toISOString(),
    actualizado: new Date().toISOString()
  };
}

/* ------------------------------------------------------------------ CRUD */

export async function listar() {
  const d = await leer();
  return {
    clientes: d.clientes.map((c) => ({ ...c, cantidadMovimientos: c.movimientos.length, perfilVence: vencimiento(c.cuestionario?.fecha) })),
    archivo: archivo(), perfiles: PERFILES
  };
}

export async function obtener(id) {
  const c = (await leer()).clientes.find((x) => x.id === id);
  if (!c) throw new HttpError("Cliente inexistente", 404);
  return c;
}

export const crear = (datos) => guardar((d) => {
  const c = validarCliente(datos);
  d.clientes.push(c);
  return c;
});

export const actualizar = (id, datos) => guardar((d) => {
  const i = d.clientes.findIndex((x) => x.id === id);
  if (i < 0) throw new HttpError("Cliente inexistente", 404);
  d.clientes[i] = validarCliente(datos, d.clientes[i]);
  return d.clientes[i];
});

export const eliminar = (id) => guardar((d) => {
  const i = d.clientes.findIndex((x) => x.id === id);
  if (i < 0) throw new HttpError("Cliente inexistente", 404);
  d.clientes.splice(i, 1);
  return { ok: true };
});

/* ------------------------------------------------- tipo de cada activo */

const sinBA = (t) => t.replace(/\.BA$/, "");
/* Especie base: AL30D → AL30, YMCXO → YMCX (ON en pesos), GD30C → GD30. */
const especieBase = (t) => {
  const b = sinBA(t);
  if (BONOS[b] || DOLAR_NUEVOS[b]) return b;
  const sinSufijo = b.replace(/[DCO]$/, "");
  return BONOS[sinSufijo] || DOLAR_NUEVOS[sinSufijo] ? sinSufijo : b;
};
const onDe = (t) => {
  const b = sinBA(t);
  if (ONS[b]) return ONS[b];
  const k = `${b.replace(/[DCO]$/, "")}D`;
  return ONS[k] || null;
};
/* Patrones de renta fija de BYMA, por si el panel no responde. */
const PATRON_RF = /^((AL|GD|AE)\d{2}|AO\d{2}|AN\d{2}|BP[A-Z]?\d{1,2}|S\d{2}[A-Z]\d|T\d{2}[A-Z]\d|TZX\w+|TX\d{2}|TZV\w+|TT[A-Z]\d{2}|DICP|PARP|CUAP|TY\d{2}P)[DCO]?$/;

async function conjuntoRentaFija() {
  const r = await Promise.allSettled(["bonos", "letras", "ons"].map((t) => panel(t)));
  const s = new Set();
  for (const x of r) if (x.status === "fulfilled") for (const f of x.value.filas) s.add(f.ticker);
  return s;
}
const esRentaFija = (t, set) => {
  const b = sinBA(t);
  return set.has(b) || PATRON_RF.test(b) || Boolean(BONOS[especieBase(t)] || DOLAR_NUEVOS[especieBase(t)] || onDe(t) || TASA_FIJA[b]);
};

const tipoDe = (t, rf) => {
  if (rf) return "Renta fija";
  const r = resolver(t);
  if (r.tipo === "ar") return "BYMA";
  if (r.tipo === "indice" || /^\^/.test(t)) return "Índice";
  if (/-USDT?$/.test(t)) return "Cripto";
  if (/=X$/.test(t)) return "Moneda";
  if (/=F$/.test(t)) return "Futuro";
  return r.tipo === "global" ? "Exterior" : "EE.UU.";
};

const rangoDesde = (fecha) => {
  const anios = diasEntre(fecha, hoyISO()) / 365;
  return anios <= 0.95 ? "1y" : anios <= 1.95 ? "2y" : anios <= 4.9 ? "5y" : "10y";
};

function cclEn(hist, cclHoy) {
  if (!hist.length) return () => cclHoy;
  return (fecha) => {
    let lo = 0, hi = hist.length - 1, v = null;
    if (fecha < hist[0].fecha) return hist[0].venta;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (hist[mid].fecha <= fecha) { v = hist[mid].venta; lo = mid + 1; } else hi = mid - 1;
    }
    return v ?? cclHoy;
  };
}

/* ------------------------------------------------------ agenda de cobros */

/* Cupones y amortizaciones que va a cobrar la cartera en los próximos meses:
   bonos del canje 2020, Bonares nuevos, BOPREAL, ONs y LECAP/BONCAP. */
export function agendaCobros(posiciones, desde, hasta) {
  const filas = [];
  for (const p of posiciones) {
    if (!(p.cantidad > 0)) continue;
    const base = especieBase(p.ticker), b = sinBA(p.ticker);
    let flujos = null, moneda = "USD";
    if (BONOS[base]) flujos = cronograma(base).map((f) => ({ fecha: f.fecha, cupon: f.cupon, amortizacion: f.amortizacion }));
    else if (DOLAR_NUEVOS[base]) flujos = DOLAR_NUEVOS[base].flujos.map(([fecha, total]) => ({ fecha, cupon: null, amortizacion: null, total }));
    else if (onDe(p.ticker)) flujos = onDe(p.ticker).flujos.map(([fecha, total]) => ({ fecha, cupon: null, amortizacion: null, total }));
    else if (TASA_FIJA[b]) { flujos = [{ fecha: TASA_FIJA[b].vence, cupon: null, amortizacion: null, total: TASA_FIJA[b].pagoFinal }]; moneda = "ARS"; }
    if (!flujos) continue;
    for (const f of flujos) {
      if (f.fecha <= desde || f.fecha > hasta) continue;
      const total = f.total ?? f.cupon + f.amortizacion;
      filas.push({
        fecha: f.fecha, ticker: p.ticker, cantidad: p.cantidad, moneda,
        cupon: f.cupon !== null ? (f.cupon * p.cantidad) / 100 : null,
        amortizacion: f.amortizacion !== null ? (f.amortizacion * p.cantidad) / 100 : null,
        total: (total * p.cantidad) / 100
      });
    }
  }
  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ticker.localeCompare(b.ticker));
}

/* Duration modificada de un instrumento de renta fija en dólares, con su
   precio en dólares cada 100 nominales. */
function mdDe(ticker, precioUsd100, fechaLiq) {
  const base = especieBase(ticker);
  if (BONOS[base]) return analizar(base, precioUsd100, fechaLiq).md;
  const fl = DOLAR_NUEVOS[base]?.flujos || onDe(ticker)?.flujos;
  if (!fl) return null;
  return medidasBono(fl.map(([fecha, total]) => ({ fecha, total })), precioUsd100, fechaLiq)?.md ?? null;
}

/* ------------------------------------------------------------- valuación */

function variacionEntre(serie, desde, hasta, ccl) {
  const a = serie.filter((x) => x.d <= desde).at(-1) || serie.find((x) => x.d >= desde);
  const b = serie.filter((x) => x.d <= hasta).at(-1);
  if (!a || !b) return null;
  const va = ccl ? a.c / ccl(a.d) : a.c, vb = ccl ? b.c / ccl(b.d) : b.c;
  return (vb / va - 1) * 100;
}

/* Inflación acumulada entre dos fechas, con los meses parciales prorrateados. */
function inflacionEntre(mensual, desde, hasta) {
  if (!mensual.length) return null;
  let f = 1, ultimo = null;
  for (const m of mensual) {
    const ini = m.fecha.slice(0, 7) + "-01";
    const finD = new Date(`${ini}T00:00:00Z`); finD.setUTCMonth(finD.getUTCMonth() + 1);
    const fin = finD.toISOString().slice(0, 10);
    const a = ini > desde ? ini : desde, b = fin < hasta ? fin : hasta;
    if (b <= a) continue;
    f *= (1 + m.valor / 100) ** (diasEntre(a, b) / diasEntre(ini, fin));
    ultimo = m.fecha.slice(0, 7);
  }
  return ultimo ? { valor: (f - 1) * 100, hastaMes: ultimo } : null;
}

/* Valúa la cartera de un cliente a partir de sus movimientos. */
export async function cartera(id) {
  const c = await obtener(id);
  const hoy = hoyISO(), fechaLiq = liquidacion();
  const [histR, dolR, rfR] = await Promise.allSettled([historiaDolar("contadoconliqui"), dolares(), conjuntoRentaFija()]);
  const hist = histR.status === "fulfilled" ? histR.value : [];
  let cclHoy = dolR.status === "fulfilled" ? dolR.value.filas.find((x) => x.casa === "contadoconliqui")?.venta ?? null : null;
  if (!cclHoy) cclHoy = hist.at(-1)?.venta ?? null;
  const ccl = cclEn(hist, cclHoy);
  const setRf = rfR.status === "fulfilled" ? rfR.value : new Set();
  const avisos = [];
  if (!hist.length) avisos.push("Sin historia del CCL: los costos en dólares usan el CCL de hoy.");

  /* Precios de cada activo que pasó por la cartera, con historia desde su primer movimiento. */
  const movs = c.movimientos;
  const tickers = [...new Set(movs.filter((m) => m.ticker && m.tipo !== "renta").map((m) => m.ticker))];
  const primera = new Map();
  for (const m of movs) if (m.tipo !== "renta" && !primera.has(m.ticker)) primera.set(m.ticker, m.fecha);
  const pxs = await enParalelo(tickers, 4, (t) => price(t, { rango: rangoDesde(primera.get(t)) }));
  /* Si no hay historia (letras, ONs), se usa el último precio del panel de BYMA. */
  const paneles = await Promise.allSettled(["bonos", "letras", "ons", "cedears", "acciones"].map((t) => panel(t)));
  const enPanel = (t) => { for (const p of paneles) if (p.status === "fulfilled") { const f = p.value.filas.find((x) => x.ticker === sinBA(t)); if (f) return f; } return null; };

  const info = new Map();
  const series = new Map();
  const ultimoPanel = (f) => (f ? (f.ultimo > 0 ? f.ultimo : f.compra > 0 && f.venta > 0 ? (f.compra + f.venta) / 2 : null) : null);
  tickers.forEach((t, i) => {
    const rf = esRentaFija(t, setRf);
    if (pxs[i].ok) {
      const px = pxs[i].valor;
      const velas = px.candles.map((x) => ({ d: x.d, c: x.c }));
      /* En renta fija el precio de hoy sale del panel de BYMA, que es más
         fresco que la serie diaria; la historia sigue siendo la de la serie. */
      const pp = rf ? ultimoPanel(enPanel(t)) : null;
      const monedaSerie = px.moneda === "ARS" ? "ARS" : "USD";
      /* La especie define la moneda en BYMA: terminada en D o C cotiza en dólares. */
      const monedaPanel = /[DC]$/.test(sinBA(t)) ? "USD" : "ARS";
      if (pp && monedaPanel !== monedaSerie) {
        avisos.push(`La serie histórica de ${t} no está en la misma moneda que su cotización en BYMA: se usa solo el precio del panel (sin historia).`);
        info.set(t, { moneda: monedaPanel, factor: 0.01, rf, px: null, nombre: px.nombre, last: pp, fecha: hoy });
        series.set(t, [{ d: hoy, c: pp }]);
        return;
      }
      if (pp) { while (velas.length && velas.at(-1).d >= hoy) velas.pop(); velas.push({ d: hoy, c: pp }); }
      info.set(t, { moneda: monedaSerie, factor: rf ? 0.01 : 1, rf, px, nombre: px.nombre, last: pp ?? px.stats.last, fecha: pp ? hoy : px.stats.date });
      series.set(t, velas);
    } else {
      const ult = ultimoPanel(enPanel(t));
      const moneda = /[DC]$/.test(sinBA(t)) && rf ? "USD" : "ARS";
      info.set(t, { moneda, factor: rf ? 0.01 : 1, rf, px: null, nombre: null, last: ult, fecha: ult ? hoy : null, error: ult ? null : pxs[i].error });
      if (ult) series.set(t, [{ d: hoy, c: ult }]);
    }
  });
  const infoDe = (t) => info.get(t) || { moneda: "USD", factor: 1 };

  /* --------------------------------------------- tenencias y resultados */
  const { tenencias: ten, otrasRentas } = tenencias(movs, infoDe, ccl);
  const posiciones = ten.filter((p) => p.cantidad > 0).map((p) => {
    const i = infoDe(p.ticker);
    const base = { ticker: p.ticker, cantidad: p.cantidad, tipo: tipoDe(p.ticker, i.rf), moneda: i.moneda, rentaFija: Boolean(i.rf), primeraCompra: p.primeraCompra, nombre: i.nombre };
    if (i.last === null || i.last === undefined) return { ...base, error: i.error || "sin precio" };
    const unidadLocal = i.last * i.factor;
    const unidadUsd = i.moneda === "USD" ? unidadLocal : cclHoy ? unidadLocal / cclHoy : null;
    const unidadArs = i.moneda === "ARS" ? unidadLocal : cclHoy ? unidadLocal * cclHoy : null;
    const valorUsd = unidadUsd !== null ? p.cantidad * unidadUsd : null, valorArs = unidadArs !== null ? p.cantidad * unidadArs : null;
    const g = (a, b) => (a !== null && b ? (a / b - 1) * 100 : null);
    return {
      ...base, precioActual: i.last, fecha: i.fecha, ppc: p.costoLocal / p.cantidad / i.factor, unidadUsd,
      valorLocal: p.cantidad * unidadLocal, costoLocal: p.costoLocal, valorUsd, costoUsd: p.costoUsd, valorArs, costoArs: p.costoArs,
      gananciaUsd: g(valorUsd, p.costoUsd), gananciaArs: g(valorArs, p.costoArs),
      resultadoUsd: valorUsd !== null ? valorUsd - p.costoUsd : null, resultadoArs: valorArs !== null ? valorArs - p.costoArs : null,
      realizadoUsd: p.realizadoUsd, rentasUsd: p.rentasUsd,
      vol: i.px?.stats.vol252 ?? null, dia: i.px?.stats.ret1 ?? null, mes: i.px?.stats.ret21 ?? null
    };
  });
  const cerradas = ten.filter((p) => p.cantidad === 0).map((p) => ({ ticker: p.ticker, realizadoUsd: p.realizadoUsd, realizadoArs: p.realizadoArs, rentasUsd: p.rentasUsd, ultimoMovimiento: p.ultimoMovimiento }));

  const validas = posiciones.filter((p) => !p.error && p.valorUsd !== null);
  const efectivoUsd = (c.efectivo?.USD || 0) + (cclHoy ? (c.efectivo?.ARS || 0) / cclHoy : 0);
  const invertidoUsd = validas.reduce((s, p) => s + p.valorUsd, 0);
  const totalUsd = invertidoUsd + efectivoUsd;
  for (const p of posiciones) p.peso = !p.error && p.valorUsd !== null && totalUsd ? (p.valorUsd / totalUsd) * 100 : null;
  const sum = (lista, k) => lista.reduce((s, p) => s + (p[k] || 0), 0);
  const realizadoUsd = sum(ten, "realizadoUsd"), rentasUsd = sum(ten, "rentasUsd") + otrasRentas.usd;
  const realizadoArs = sum(ten, "realizadoArs"), rentasArs = sum(ten, "rentasArs") + otrasRentas.ars;

  /* ----------------------------------------------------- rendimiento */
  let rendimiento = null;
  const conHistoria = tickers.filter((t) => series.get(t)?.length > 1);
  const sinHistoria = tickers.filter((t) => !conHistoria.includes(t));
  if (sinHistoria.length) avisos.push(`El rendimiento histórico no incluye ${sinHistoria.join(", ")} (sin historia de precios); el valor actual sí.`);
  const movsHist = movs.filter((m) => m.tipo === "renta" ? (!m.ticker || conHistoria.includes(m.ticker)) : conHistoria.includes(m.ticker));
  if (movsHist.length) {
    const desde = movsHist[0].fecha;
    const fechas = [...new Set(conHistoria.flatMap((t) => series.get(t).map((x) => x.d)))].filter((d) => d >= desde).sort();
    const t = twr(fechas, movsHist, infoDe, ccl, crearValuador(series, infoDe, ccl));
    if (t) {
      const finalU = validas.filter((p) => conHistoria.includes(p.ticker)).reduce((s, p) => s + p.valorUsd, 0);
      const finalA = validas.filter((p) => conHistoria.includes(p.ticker)).reduce((s, p) => s + (p.valorArs || 0), 0);
      const mwr = tirCartera(movsHist, infoDe, ccl, { usd: finalU, ars: finalA }, hoy);
      /* Comparación contra índices en el mismo período. */
      const rango = rangoDesde(t.desde);
      const [spy, merv, infl] = await Promise.allSettled([price("SPY", { rango }), price("^MERV", { rango }), inflacionMensual()]);
      const velas = (r) => (r.status === "fulfilled" ? r.value.candles.map((x) => ({ d: x.d, c: x.c })) : []);
      const sSpy = velas(spy), sMerv = velas(merv);
      const inf = infl.status === "fulfilled" ? inflacionEntre(infl.value, t.desde, t.hasta) : null;
      const benchmarks = [
        { id: "spy", nombre: "S&P 500 (SPY, sin dividendos)", moneda: "USD", valor: sSpy.length ? variacionEntre(sSpy, t.desde, t.hasta) : null },
        { id: "merval", nombre: "Merval en dólares CCL", moneda: "USD", valor: sMerv.length && hist.length ? variacionEntre(sMerv, t.desde, t.hasta, ccl) : null },
        { id: "ccl", nombre: "Dólar CCL", moneda: "ARS", valor: hist.length ? (ccl(t.hasta) / ccl(t.desde) - 1) * 100 : null },
        { id: "inflacion", nombre: inf ? `Inflación (INDEC, hasta ${inf.hastaMes})` : "Inflación (INDEC)", moneda: "ARS", valor: inf?.valor ?? null }
      ];
      /* Serie base 100 de la cartera y de los índices, para el gráfico. */
      const indice = (s, conCcl) => {
        if (!s.length) return null;
        let j = 0, base = null, ult = null;
        return t.serie.map((x) => {
          while (j < s.length && s[j].d <= x.d) { ult = conCcl ? s[j].c / ccl(s[j].d) : s[j].c; j++; }
          if (ult === null) return null;
          if (base === null) base = ult;
          return { d: x.d, v: (ult / base) * 100 };
        }).filter(Boolean);
      };
      const paso = Math.max(1, Math.floor(t.serie.length / 250));
      const reducir = (s) => s && s.filter((_, i) => i % paso === 0 || i === s.length - 1);
      rendimiento = {
        desde: t.desde, hasta: t.hasta, anios: t.anios,
        twrUsd: t.usd, twrArs: t.ars, twrUsdAnual: t.usdAnual, twrArsAnual: t.arsAnual,
        tirUsd: mwr.usd, tirArs: mwr.ars, multiploUsd: mwr.usdSimple, multiploArs: mwr.arsSimple,
        benchmarks,
        mensual: mensuales(t.serie, "iUsd"),
        serie: reducir(t.serie.map((x) => ({ d: x.d, cartera: x.iUsd, valor: x.usd }))),
        indices: { spy: reducir(indice(sSpy, false)), merval: hist.length ? reducir(indice(sMerv, true)) : null }
      };
    }
  }

  /* ---------------------------------------- riesgo de la cartera actual */
  let riesgo = null, contribucion = null, escenarios = null;
  const actuales = validas.filter((p) => series.get(p.ticker)?.length > 60);
  if (actuales.length) {
    try {
      const desde = new Date(Date.now() - 372 * 864e5).toISOString().slice(0, 10);
      const fechas = [...new Set(actuales.flatMap((p) => series.get(p.ticker).map((x) => x.d)))].filter((d) => d >= desde).sort();
      const valor = crearValuador(series, infoDe, ccl);
      const unidades = [];
      const serie = [];
      for (const f of fechas) {
        const u = actuales.map((p) => valor(p.ticker, f)?.usd ?? null);
        if (u.some((x) => x === null)) continue;
        unidades.push(u);
        serie.push({ d: f, c: efectivoUsd + u.reduce((s, x, i) => s + x * actuales[i].cantidad, 0) });
      }
      if (serie.length > 60) {
        const p = perfilRiesgo(serie);
        riesgo = { vol: p.volAnual, caidaMax: p.maxDrawdown, var95: p.var95, cvar95: p.cvar95, sharpe: p.sharpe, retorno: p.retornoTotal, desde: serie[0].d, hasta: serie.at(-1).d };
        /* Retornos diarios de cada posición en dólares. */
        const rets = actuales.map((_, i) => unidades.slice(1).map((u, t) => u[i] / unidades[t][i] - 1));
        const cov = covarianza(rets);
        const pesos = actuales.map((x) => x.valorUsd / invertidoUsd);
        const contrib = contribucionRiesgo(pesos, cov);
        if (contrib) contribucion = actuales.map((x, i) => ({ ticker: x.ticker, peso: x.peso, riesgo: contrib[i] })).sort((a, b) => b.riesgo - a.riesgo);

        /* Escenarios simples: betas contra el S&P 500 y el Merval en dólares, duration en renta fija en dólares. */
        const fact = await Promise.allSettled([price("SPY", { rango: "1y" }), price("^MERV", { rango: "1y" })]);
        const retFactor = (r, conCcl) => {
          if (r.status !== "fulfilled") return null;
          const m = new Map(r.value.candles.map((x) => [x.d, conCcl ? x.c / ccl(x.d) : x.c]));
          const v = serie.map((x) => m.get(x.d) ?? null);
          for (let i = 1; i < v.length; i++) if (v[i] === null) v[i] = v[i - 1];
          return v.slice(1).map((x, i) => (x !== null && v[i] !== null ? x / v[i] - 1 : 0));
        };
        const beta = (y, x) => {
          if (!x) return null;
          const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
          let cv = 0, vx = 0;
          for (let i = 0; i < x.length; i++) { cv += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; }
          return vx ? cv / vx : null;
        };
        const fSpy = retFactor(fact[0], false), fMerv = hist.length ? retFactor(fact[1], true) : null;
        const choque = (nombre, detalle, fn, extraUsd = 0) => {
          const filas = actuales.map((x, i) => ({ ticker: x.ticker, cambio: fn(x, i) })).filter((f) => f.cambio !== null);
          const usd = extraUsd + filas.reduce((s, f) => s + (actuales.find((x) => x.ticker === f.ticker).valorUsd * f.cambio) / 100, 0);
          return { nombre, detalle, usd, pct: totalUsd ? (usd / totalUsd) * 100 : null, peores: filas.sort((a, b) => a.cambio - b.cambio).slice(0, 3) };
        };
        const mds = actuales.map((x) => (x.rentaFija && x.unidadUsd ? mdDe(x.ticker, x.unidadUsd * 100, fechaLiq) : null));
        escenarios = [
          fSpy && choque("S&P 500 −20%", "Cada posición se mueve según su beta diaria contra el S&P 500 en el último año.", (x, i) => { const b = beta(rets[i], fSpy); return b === null ? null : b * -20; }),
          fMerv && choque("Merval −30% en dólares", "Según la beta de cada posición contra el Merval medido en dólares CCL.", (x, i) => { const b = beta(rets[i], fMerv); return b === null ? null : b * -30; }),
          mds.some((m) => m) && choque("Tasas de la renta fija en dólares +200 pb", "Cambio de precio ≈ −duration modificada × 2%. Solo bonos y ONs en dólares.", (x, i) => (mds[i] ? -mds[i] * 2 : null)),
          choque("Devaluación de 30% (CCL)", "La renta fija en pesos y el efectivo en pesos pierden 23% medidos en dólares; acciones y activos en dólares no cambian en este escenario.", (x) => (x.moneda === "ARS" && x.rentaFija ? (1 / 1.3 - 1) * 100 : null), cclHoy ? ((c.efectivo?.ARS || 0) / cclHoy) * (1 / 1.3 - 1) : 0)
        ].filter(Boolean);
      }
    } catch (e) { avisos.push(`No se pudo medir el riesgo: ${String(e.message).slice(0, 120)}`); }
  }

  /* ---------------------------------------------- renta fija y cobros */
  const hasta = new Date(Date.now() + 366 * 864e5).toISOString().slice(0, 10);
  const agenda = agendaCobros(posiciones, hoy, hasta).map((f) => ({ ...f, totalUsd: f.moneda === "USD" ? f.total : cclHoy ? f.total / cclHoy : null }));
  const rfDolar = validas.filter((p) => p.rentaFija && p.unidadUsd).map((p) => ({ p, md: mdDe(p.ticker, p.unidadUsd * 100, fechaLiq) })).filter((x) => x.md);
  const sensibilidad = rfDolar.length ? {
    dv01Usd: rfDolar.reduce((s, x) => s + (x.p.valorUsd * x.md) / 10000, 0),
    mdPromedio: rfDolar.reduce((s, x) => s + x.md * x.p.valorUsd, 0) / rfDolar.reduce((s, x) => s + x.p.valorUsd, 0),
    instrumentos: rfDolar.map((x) => ({ ticker: x.p.ticker, md: x.md, valorUsd: x.p.valorUsd, dv01Usd: (x.p.valorUsd * x.md) / 10000 }))
  } : null;

  /* ----------------------------------------------------------- alertas */
  const k = c.criterios, alertas = [];
  const pct = (v) => `${v.toFixed(1).replace(".", ",")}%`;
  for (const p of posiciones) {
    if (p.error) { alertas.push({ nivel: "alta", ticker: p.ticker, texto: `${p.ticker}: no se pudo valuar (${String(p.error).slice(0, 80)}).` }); continue; }
    if (p.peso > k.pesoMax) alertas.push({ nivel: "media", ticker: p.ticker, texto: `${p.ticker} pesa ${pct(p.peso)} de la cartera; el máximo del cliente es ${pct(k.pesoMax)}.` });
    if (p.gananciaUsd !== null && p.gananciaUsd < -k.stopLoss) alertas.push({ nivel: "alta", ticker: p.ticker, texto: `${p.ticker} pierde ${pct(Math.abs(p.gananciaUsd))} en dólares CCL contra su costo promedio; el límite del cliente es ${pct(k.stopLoss)}.` });
    if (p.vol > k.volMaxPosicion) alertas.push({ nivel: "media", ticker: p.ticker, texto: `${p.ticker} tiene una volatilidad anual de ${pct(p.vol)}, por encima de ${pct(k.volMaxPosicion)} por posición.` });
  }
  if (riesgo?.vol > k.volMax) alertas.push({ nivel: "alta", texto: `La volatilidad de la cartera (${pct(riesgo.vol)}) supera el máximo del perfil (${pct(k.volMax)}).` });
  if (riesgo && Math.abs(riesgo.caidaMax) > k.ddMax) alertas.push({ nivel: "alta", texto: `La cartera actual habría caído ${pct(Math.abs(riesgo.caidaMax))} en el último año; el cliente tolera ${pct(k.ddMax)}.` });
  const liquidez = totalUsd ? (efectivoUsd / totalUsd) * 100 : 0;
  if (totalUsd && liquidez < k.liquidezMin) alertas.push({ nivel: "media", texto: `La liquidez es ${pct(liquidez)}; el mínimo del cliente es ${pct(k.liquidezMin)}.` });

  const q = c.cuestionario, vence = vencimiento(q?.fecha);
  if (!q) alertas.push({ nivel: "media", texto: "Falta el cuestionario de perfil del inversor. La CNV pide documentarlo antes de operar y actualizarlo al menos una vez por año." });
  else if (vence <= hoy) alertas.push({ nivel: "alta", texto: `El perfil del inversor venció el ${vence.split("-").reverse().join("/")}: la CNV pide actualizarlo al menos una vez por año.` });
  else if (diasEntre(hoy, vence) <= 30) alertas.push({ nivel: "info", texto: `El perfil del inversor vence el ${vence.split("-").reverse().join("/")}. Conviene agendar la actualización.` });
  if (q && masAgresivo(c.perfil, q.sugerido)) alertas.push({ nivel: "alta", texto: `El perfil asignado (${c.perfil}) es más agresivo que el que surge del cuestionario (${q.sugerido}).` });

  const reb = rebalanceo(validas, c.asignacion, totalUsd, efectivoUsd, k.banda ?? 5);
  if (reb?.fuera) alertas.push({ nivel: "media", texto: `${reb.fuera} ${reb.fuera === 1 ? "activo se sale" : "activos se salen"} de la banda de ±${String(reb.banda).replace(".", ",")} puntos de la cartera objetivo.` });
  const pronto = agenda.filter((f) => diasEntre(hoy, f.fecha) <= 7);
  for (const f of pronto) alertas.push({ nivel: "info", ticker: f.ticker, texto: `${f.ticker} paga ${f.moneda === "USD" ? "US$" : "$"} ${f.total.toFixed(2).replace(".", ",")} el ${f.fecha.split("-").reverse().join("/")}.` });

  const agrupar = (campo) => {
    const m = new Map();
    for (const p of validas) m.set(p[campo], (m.get(p[campo]) || 0) + p.valorUsd);
    if (efectivoUsd) m.set("Efectivo", (m.get("Efectivo") || 0) + efectivoUsd);
    return [...m.entries()].map(([nombre, v]) => ({ nombre, valorUsd: v, peso: totalUsd ? (v / totalUsd) * 100 : 0 })).sort((a, b) => b.valorUsd - a.valorUsd);
  };

  const nivel = { alta: 0, media: 1, info: 2 };
  const costoAbiertoUsd = sum(validas, "costoUsd");
  return {
    cliente: { ...c, perfilVence: vence },
    cclHoy, posiciones, cerradas,
    totales: {
      valorUsd: totalUsd, valorArs: cclHoy ? totalUsd * cclHoy : null, invertidoUsd,
      costoUsd: costoAbiertoUsd, efectivoUsd, liquidez,
      noRealizadoUsd: invertidoUsd - costoAbiertoUsd,
      gananciaUsd: costoAbiertoUsd ? (invertidoUsd / costoAbiertoUsd - 1) * 100 : null,
      realizadoUsd, rentasUsd, realizadoArs, rentasArs,
      resultadoTotalUsd: invertidoUsd - costoAbiertoUsd + realizadoUsd + rentasUsd
    },
    rendimiento, composicion: { porTipo: agrupar("tipo"), porMoneda: agrupar("moneda") },
    riesgo, contribucion, escenarios, agenda, sensibilidad,
    rebalanceo: reb,
    alertas: alertas.sort((a, b) => nivel[a.nivel] - nivel[b.nivel]),
    avisos,
    fuente: "Precios de la cadena habitual y de data912 (BYMA); dólar CCL de DolarApi y ArgentinaDatos; inflación del INDEC"
  };
}
