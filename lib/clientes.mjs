import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./config.mjs";
import { HttpError, enParalelo } from "./http.mjs";
import { price, resolver } from "./precios.mjs";
import { historiaDolar, dolares, convertirACcl } from "./argentina.mjs";
import { perfilRiesgo } from "./indicadores.mjs";

/* Clientes y sus carteras. Se guardan en datos/clientes.json, en esta
   máquina: la carpeta datos/ está en el .gitignore y nunca se sube al
   repositorio. Para respaldar, alcanza con copiar ese archivo. */

const dir = () => process.env.MD_DATOS || path.join(ROOT, "datos");
const archivo = () => path.join(dir(), "clientes.json");

/* Criterios por defecto de cada perfil. La persona puede cambiarlos cliente
   por cliente; estos son solo un punto de partida razonable. */
export const PERFILES = {
  conservador: { volMax: 15, ddMax: 15, pesoMax: 15, stopLoss: 10, volMaxPosicion: 30, liquidezMin: 10 },
  moderado: { volMax: 25, ddMax: 25, pesoMax: 20, stopLoss: 15, volMaxPosicion: 45, liquidezMin: 5 },
  agresivo: { volMax: 40, ddMax: 40, pesoMax: 30, stopLoss: 25, volMaxPosicion: 70, liquidezMin: 0 }
};
const HORIZONTES = ["corto", "medio", "largo"];

/* ---------------------------------------------------------- persistencia */

async function leer() {
  try { return JSON.parse(await fs.readFile(archivo(), "utf8")); }
  catch (e) {
    if (e.code === "ENOENT") return { version: 1, clientes: [] };
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
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const hoy = () => new Date().toISOString().slice(0, 10);

function validarPosicion(p) {
  const ticker = texto(p.ticker, 20).toUpperCase();
  try { resolver(ticker); } catch { throw new HttpError(`Ticker inválido: "${ticker}"`, 400); }
  const cantidad = numero(p.cantidad, { min: 0 });
  if (!(cantidad > 0)) throw new HttpError(`La cantidad de ${ticker} tiene que ser mayor que cero`, 400);
  const precioCompra = numero(p.precioCompra, { min: 0 });
  if (precioCompra === null) throw new HttpError(`Falta el precio de compra de ${ticker}`, 400);
  const fechaCompra = /^\d{4}-\d{2}-\d{2}$/.test(p.fechaCompra || "") && p.fechaCompra <= hoy() ? p.fechaCompra : hoy();
  return {
    id: /^[a-z0-9]{6,20}$/.test(p.id || "") ? p.id : crypto.randomBytes(5).toString("hex"),
    ticker, cantidad, precioCompra, fechaCompra,
    nota: texto(p.nota, 200)
  };
}

function validarCliente(c, previo = {}) {
  const nombre = texto(c.nombre ?? previo.nombre, 120);
  if (!nombre) throw new HttpError("El cliente necesita un nombre", 400);
  const perfil = PERFILES[c.perfil] ? c.perfil : (previo.perfil || "moderado");
  const base = PERFILES[perfil];
  const crit = { ...base, ...(previo.criterios || {}), ...(c.criterios || {}) };
  const criterios = Object.fromEntries(Object.keys(base).map((k) => [k, numero(crit[k], { min: 0, max: 1000, def: base[k] })]));
  const posiciones = Array.isArray(c.posiciones) ? c.posiciones : (previo.posiciones || []);
  if (posiciones.length > 300) throw new HttpError("Máximo 300 posiciones por cliente", 400);
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
    posiciones: posiciones.map(validarPosicion),
    creado: previo.creado || new Date().toISOString(),
    actualizado: new Date().toISOString()
  };
}

/* ------------------------------------------------------------------ CRUD */

export async function listar() {
  const d = await leer();
  return { clientes: d.clientes.map((c) => ({ ...c, cantidadPosiciones: c.posiciones.length })), archivo: archivo(), perfiles: PERFILES };
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

/* ------------------------------------------------------------- valuación */

const tipoDe = (t) => {
  const r = resolver(t);
  if (r.tipo === "ar") return "BYMA";
  if (r.tipo === "indice" || /^\^/.test(t)) return "Índice";
  if (/-USDT?$/.test(t)) return "Cripto";
  if (/=X$/.test(t)) return "Moneda";
  if (/=F$/.test(t)) return "Futuro";
  return r.tipo === "global" ? "Exterior" : "EE.UU.";
};

function valorAl(hist, fecha) {
  let v = null;
  for (const x of hist) { if (x.fecha > fecha) break; v = x.venta; }
  return v ?? hist[0]?.venta ?? null;
}

/* Valúa la cartera de un cliente: precio actual de cada posición, valor y
   resultado en pesos y en dólares CCL (el costo en dólares usa el CCL del día
   de compra), pesos, riesgo histórico de la cartera tal como está hoy y
   alertas contra los criterios del cliente. */
export async function cartera(id) {
  const c = await obtener(id);
  let hist = [];
  try { hist = await historiaDolar("contadoconliqui"); } catch { /* sin historia, se usa solo el CCL de hoy */ }
  let cclHoy = null;
  try { cclHoy = (await dolares()).filas.find((x) => x.casa === "contadoconliqui")?.venta ?? null; } catch { /* seguimos */ }
  if (!cclHoy) cclHoy = hist.at(-1)?.venta ?? null;

  const res = await enParalelo(c.posiciones, 4, (p) => price(p.ticker, { rango: "1y" }));
  const posiciones = c.posiciones.map((p, i) => {
    const base = { ...p, tipo: tipoDe(p.ticker) };
    if (!res[i].ok) return { ...base, error: res[i].error };
    const px = res[i].valor;
    const moneda = px.moneda === "ARS" ? "ARS" : "USD";
    const precioActual = px.stats.last;
    const valorLocal = p.cantidad * precioActual;
    const costoLocal = p.cantidad * p.precioCompra;
    const cclCompra = hist.length ? valorAl(hist, p.fechaCompra) : cclHoy;
    const enUsd = (v, ccl) => (moneda === "ARS" ? (ccl ? v / ccl : null) : v);
    const enArs = (v, ccl) => (moneda === "USD" ? (ccl ? v * ccl : null) : v);
    const valorUsd = enUsd(valorLocal, cclHoy), costoUsd = enUsd(costoLocal, cclCompra);
    const valorArs = enArs(valorLocal, cclHoy), costoArs = enArs(costoLocal, cclCompra);
    const g = (a, b) => (a !== null && b ? (a / b - 1) * 100 : null);
    return {
      ...base, moneda, nombre: px.nombre, precioActual, fecha: px.stats.date,
      valorLocal, costoLocal, valorUsd, costoUsd, valorArs, costoArs,
      gananciaUsd: g(valorUsd, costoUsd), gananciaArs: g(valorArs, costoArs),
      resultadoUsd: valorUsd !== null && costoUsd !== null ? valorUsd - costoUsd : null,
      vol: px.stats.vol252, dia: px.stats.ret1, mes: px.stats.ret21,
      _velas: px
    };
  });

  const validas = posiciones.filter((p) => !p.error && p.valorUsd !== null);
  const efectivoUsd = (c.efectivo?.USD || 0) + (cclHoy ? (c.efectivo?.ARS || 0) / cclHoy : 0);
  const totalUsd = validas.reduce((s, p) => s + p.valorUsd, 0) + efectivoUsd;
  const costoTotalUsd = validas.reduce((s, p) => s + (p.costoUsd || 0), 0);
  for (const p of posiciones) p.peso = !p.error && p.valorUsd !== null && totalUsd ? (p.valorUsd / totalUsd) * 100 : null;

  /* Cómo se habría comportado la cartera de hoy en el último año: suma de
     cantidad × precio en dólares CCL de cada día. Mide riesgo, no resultado
     real (las compras fueron en distintas fechas). */
  let serie = [], riesgo = null;
  try {
    const usd = await Promise.all(validas.map(async (p) => (p.moneda === "ARS" ? (await convertirACcl(p._velas)).candles : p._velas.candles)));
    const mapas = usd.map((v) => new Map(v.map((x) => [x.d, x.c])));
    const fechas = [...new Set(usd.flat().map((x) => x.d))].sort();
    const ultimo = validas.map(() => null);
    for (const f of fechas) {
      let total = efectivoUsd, completo = true;
      mapas.forEach((m, i) => {
        if (m.has(f)) ultimo[i] = m.get(f);
        if (ultimo[i] === null) completo = false;
        else total += validas[i].cantidad * ultimo[i];
      });
      if (completo) serie.push({ d: f, c: total });
    }
    if (serie.length > 60) {
      const p = perfilRiesgo(serie);
      riesgo = { vol: p.volAnual, caidaMax: p.maxDrawdown, var95: p.var95, cvar95: p.cvar95, sharpe: p.sharpe, retorno: p.retornoTotal, desde: serie[0].d, hasta: serie.at(-1).d };
    }
  } catch { /* sin serie, el resto sirve */ }

  /* ----------------------------------------------------------- alertas */
  const k = c.criterios, alertas = [];
  const pct = (v) => `${v.toFixed(1).replace(".", ",")}%`;
  for (const p of posiciones) {
    if (p.error) { alertas.push({ nivel: "alta", ticker: p.ticker, texto: `${p.ticker}: no se pudo valuar (${String(p.error).slice(0, 80)}).` }); continue; }
    if (p.peso > k.pesoMax) alertas.push({ nivel: "media", ticker: p.ticker, texto: `${p.ticker} pesa ${pct(p.peso)} de la cartera; el máximo del cliente es ${pct(k.pesoMax)}.` });
    if (p.gananciaUsd !== null && p.gananciaUsd < -k.stopLoss) alertas.push({ nivel: "alta", ticker: p.ticker, texto: `${p.ticker} pierde ${pct(Math.abs(p.gananciaUsd))} en dólares CCL desde la compra; el límite del cliente es ${pct(k.stopLoss)}.` });
    if (p.vol > k.volMaxPosicion) alertas.push({ nivel: "media", ticker: p.ticker, texto: `${p.ticker} tiene una volatilidad anual de ${pct(p.vol)}, por encima de ${pct(k.volMaxPosicion)} por posición.` });
  }
  if (riesgo?.vol > k.volMax) alertas.push({ nivel: "alta", texto: `La volatilidad de la cartera (${pct(riesgo.vol)}) supera el máximo del perfil (${pct(k.volMax)}).` });
  if (riesgo && Math.abs(riesgo.caidaMax) > k.ddMax) alertas.push({ nivel: "alta", texto: `La cartera actual habría caído ${pct(Math.abs(riesgo.caidaMax))} en el último año; el cliente tolera ${pct(k.ddMax)}.` });
  const liquidez = totalUsd ? (efectivoUsd / totalUsd) * 100 : 0;
  if (totalUsd && liquidez < k.liquidezMin) alertas.push({ nivel: "media", texto: `La liquidez es ${pct(liquidez)}; el mínimo del cliente es ${pct(k.liquidezMin)}.` });

  const agrupar = (campo) => {
    const m = new Map();
    for (const p of validas) m.set(p[campo], (m.get(p[campo]) || 0) + p.valorUsd);
    if (efectivoUsd) m.set("Efectivo", (m.get("Efectivo") || 0) + efectivoUsd);
    return [...m.entries()].map(([nombre, v]) => ({ nombre, valorUsd: v, peso: totalUsd ? (v / totalUsd) * 100 : 0 })).sort((a, b) => b.valorUsd - a.valorUsd);
  };

  for (const p of posiciones) delete p._velas;
  const paso = Math.max(1, Math.floor(serie.length / 200));
  return {
    cliente: c,
    cclHoy,
    posiciones,
    totales: {
      valorUsd: totalUsd, valorArs: cclHoy ? totalUsd * cclHoy : null,
      costoUsd: costoTotalUsd, efectivoUsd, liquidez,
      resultadoUsd: validas.reduce((s, p) => s + (p.resultadoUsd || 0), 0),
      gananciaUsd: costoTotalUsd ? ((totalUsd - efectivoUsd) / costoTotalUsd - 1) * 100 : null
    },
    composicion: { porTipo: agrupar("tipo"), porMoneda: agrupar("moneda") },
    serie: serie.filter((_, i) => i % paso === 0 || i === serie.length - 1).map((x) => ({ d: x.d, v: x.c })),
    riesgo,
    alertas: alertas.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "alta" ? -1 : 1)),
    fuente: "Precios de la cadena habitual; dólar CCL de DolarApi y ArgentinaDatos"
  };
}
