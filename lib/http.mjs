import { SEC_UA } from "./config.mjs";

/* Cada fuente acepta un User-Agent distinto, y equivocarse deja la fuente
   muda sin error claro:
   - Yahoo y FRED (desde 2026) rechazan a quien se presenta como un navegador
     completo sin serlo: Yahoo responde 429 y FRED no responde nunca. Con un
     User-Agent corto contestan bien.
   - CNN, al revés, exige uno de navegador (si no, responde 418).
   - La SEC exige uno con un email de contacto (si no, 403).
   Node no descomprime si uno fija Accept-Encoding a mano: no lo fijamos. */
export const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
export const UA_CORTO = "Mozilla/5.0";

export function agenteDe(url) {
  let h = "";
  try { h = new URL(url).hostname; } catch { return BROWSER_UA; }
  if (/(^|\.)sec\.gov$/.test(h)) return SEC_UA;
  if (/(^|\.)yahoo\.com$|(^|\.)stlouisfed\.org$|(^|\.)kraken\.com$|(^|\.)frankfurter\.(dev|app)$/.test(h)) return UA_CORTO;
  return BROWSER_UA;
}

export class HttpError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/* ------------------------------------------------------- salud por fuente */

/* Cada fuente registra su último acierto y su último error. La vista de
   "Fuentes y claves" lo muestra: cuando algo falla, se ve enseguida si es
   una fuente caída, una red que la bloquea o un ticker mal escrito. */
const salud = new Map();

export function registrar(fuente, ok, detalle = "") {
  const e = salud.get(fuente) || { fuente, ok: 0, errores: 0 };
  if (ok) { e.ok++; e.ultimoOk = new Date().toISOString(); }
  else { e.errores++; e.ultimoError = new Date().toISOString(); e.detalle = String(detalle).slice(0, 220); }
  salud.set(fuente, e);
}

export const estadoFuentes = () => [...salud.values()].sort((a, b) => a.fuente.localeCompare(b.fuente));

/* ------------------------------------------------------------------ fetch */

export function fuenteDe(url) {
  const h = new URL(url).hostname;
  if (/sec\.gov$/.test(h)) return "SEC EDGAR";
  if (/yahoo\.com$/.test(h)) return "Yahoo Finance";
  if (/nasdaq\.com$/.test(h)) return "Nasdaq";
  if (/stooq\./.test(h)) return "Stooq";
  if (/dolarapi\.com$/.test(h)) return "DolarApi";
  if (/argentinadatos\.com$/.test(h)) return "ArgentinaDatos";
  if (/bcra\.gob\.ar$/.test(h)) return "BCRA";
  if (/data912\.com$/.test(h)) return "data912";
  if (/stlouisfed\.org$/.test(h)) return "FRED";
  if (/news\.google\.com$/.test(h)) return "Google News";
  if (/bymadata\.com\.ar$/.test(h)) return "BYMA";
  if (/frankfurter\.(dev|app)$/.test(h)) return "BCE (Frankfurter)";
  if (/kraken\.com$/.test(h)) return "Kraken";
  if (/cnn\.io$/.test(h)) return "CNN Fear & Greed";
  if (/finnhub\.io$/.test(h)) return "Finnhub";
  return h;
}

export async function pedir(url, { headers = {}, timeout = 20000, method = "GET", body, fuente } = {}) {
  const nombre = fuente || fuenteDe(url);
  let res;
  try {
    res = await fetch(url, {
      method,
      body,
      headers: { "User-Agent": agenteDe(url), "Accept": "*/*", ...headers },
      signal: AbortSignal.timeout(timeout)
    });
  } catch (e) {
    const motivo = e.name === "TimeoutError" ? `no respondió en ${timeout / 1000} s` : (e.cause?.code || e.message);
    registrar(nombre, false, motivo);
    throw new HttpError(`${nombre}: ${motivo}`, 0);
  }
  if (!res.ok) {
    registrar(nombre, false, `HTTP ${res.status}`);
    throw new HttpError(`${nombre} respondió ${res.status}${res.status === 429 ? " (demasiadas consultas: esperá un minuto)" : ""}`, res.status);
  }
  registrar(nombre, true);
  return res;
}

export async function getJSON(url, opts) {
  const res = await pedir(url, { ...opts, headers: { Accept: "application/json,text/plain,*/*", ...(opts?.headers || {}) } });
  const txt = await res.text();
  try { return JSON.parse(txt); }
  catch { throw new HttpError(`${opts?.fuente || fuenteDe(url)} no devolvió JSON (empieza con: ${txt.slice(0, 80).replace(/\s+/g, " ")})`, 502); }
}

export async function getText(url, opts) {
  const res = await pedir(url, opts);
  return res.text();
}

/* ----------------------------------------------------------------- cache */

/* Cache en memoria con TTL. Guarda la promesa, no el valor: dos pedidos
   simultáneos del mismo dato comparten una sola descarga. Si falla, se
   borra para que el próximo intento vuelva a probar. */
const cache = new Map();

/* Vacía la cache (lo usan los tests para simular una fuente caída). */
export function limpiarCache() { cache.clear(); }

export function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.p;
  const p = Promise.resolve().then(fn);
  cache.set(key, { t: Date.now(), p });
  p.catch(() => { if (cache.get(key)?.p === p) cache.delete(key); });
  if (cache.size > 800) {
    const viejo = [...cache.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, 200);
    for (const [k] of viejo) cache.delete(k);
  }
  return p;
}

/* Ejecuta fn sobre items con un máximo de n en paralelo. Devuelve
   { ok, valor | error } por ítem para que un fallo no tire abajo el resto. */
export async function enParalelo(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = { ok: true, valor: await fn(items[k], k) }; }
      catch (e) { out[k] = { ok: false, error: String(e.message || e) }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export const hoyISO = () => new Date().toISOString().slice(0, 10);
export const isoDe = (d) => new Date(d).toISOString().slice(0, 10);
