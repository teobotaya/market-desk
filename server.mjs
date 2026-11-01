import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, PORT, HOST, archivosLeidos } from "./lib/config.mjs";
import { estadoFuentes, enParalelo, HttpError } from "./lib/http.mjs";
import { perfilRiesgo, lecturaTecnica } from "./lib/indicadores.mjs";
import { price, cotizacionLigera, buscarYahoo, consensoYahoo, paresSugeridos } from "./lib/precios.mjs";
import { riskFactors, fundamentales, perCompleto, filings, insiders, buscarSec } from "./lib/sec.mjs";
import { news } from "./lib/noticias.mjs";
import * as ar from "./lib/argentina.mjs";
import * as mkt from "./lib/mercado.mjs";
import { analizar, estadoIA } from "./lib/ia.mjs";
import { volatilidadImplicita, finnhubActivo, finnhubResumen } from "./lib/extras.mjs";

const VERSION = "2.0.0";
const p = (u, k, def = "") => (u.searchParams.get(k) || def).trim();

async function precioConMoneda(u) {
  const px = await price(p(u, "t"), { rango: p(u, "rango", "2y") });
  if (p(u, "usd") === "ccl" && px.moneda === "ARS") return ar.convertirACcl(px);
  return px;
}

const routes = {
  /* ----------------------------------------------------------- estado */
  "/api/estado": async () => ({
    version: VERSION, ia: estadoIA(), fuentes: estadoFuentes(), finnhub: finnhubActivo(),
    archivosClaves: archivosLeidos, host: HOST
  }),

  /* ---------------------------------------------------------- precios */
  "/api/price": async (u) => {
    const px = await precioConMoneda(u);
    return { ...px, lectura: lecturaTecnica(px.stats) };
  },
  "/api/cotizaciones": async (u) => {
    const lista = p(u, "t").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 40);
    const res = await enParalelo(lista, 6, (t) => cotizacionLigera(t));
    return { filas: lista.map((t, i) => (res[i].ok ? res[i].valor : { pedido: t, ticker: t.toUpperCase(), error: res[i].error })) };
  },
  "/api/buscar": async (u) => {
    const q = p(u, "q");
    if (q.length < 1) return { resultados: [] };
    const [y, s] = await Promise.allSettled([buscarYahoo(q), buscarSec(q)]);
    const vistos = new Set(), resultados = [];
    for (const r of [...(y.status === "fulfilled" ? y.value : []), ...(s.status === "fulfilled" ? s.value : [])]) {
      if (vistos.has(r.ticker)) continue;
      vistos.add(r.ticker);
      resultados.push(r);
    }
    return { resultados: resultados.slice(0, 10) };
  },
  "/api/compare": async (u) => ({ a: await price(p(u, "a")), b: await price(p(u, "b")) }),

  /* ------------------------------------------------- análisis del activo */
  "/api/riesgo": async (u) => {
    const activo = await precioConMoneda(u);
    let bench = null;
    try {
      bench = await price(p(u, "b", "SPY"), { rango: p(u, "rango", "2y") });
      /* Si el activo se mide en dólares CCL, una referencia en pesos también. */
      if (activo.moneda === "USD CCL" && bench.moneda === "ARS") bench = await ar.convertirACcl(bench);
    } catch { /* seguimos sin referencia */ }
    return {
      ticker: activo.ticker, moneda: activo.moneda,
      benchmark: bench ? bench.ticker : null,
      desde: activo.candles[0].d, hasta: activo.candles.at(-1).d,
      perfil: perfilRiesgo(activo.candles, bench?.candles)
    };
  },
  "/api/iv": (u) => volatilidadImplicita(p(u, "t")),
  "/api/consenso": async (u) => {
    const t = p(u, "t");
    try { return await consensoYahoo(t); }
    catch (e) {
      if (finnhubActivo()) {
        const f = await finnhubResumen(t);
        return { ticker: f.ticker, fuente: f.fuente, tendencia: f.tendencia, historia: f.historia, estimaciones: [], cambios: [], objetivo: {}, clave: f.metricas, perfil: {}, aviso: `Yahoo falló (${e.message}); se usa Finnhub.` };
      }
      throw e;
    }
  },
  "/api/pares": async (u) => {
    const t = p(u, "t");
    const [y, f] = await Promise.allSettled([paresSugeridos(t), finnhubActivo() ? finnhubResumen(t) : Promise.reject(new Error("sin clave"))]);
    const lista = [...(f.status === "fulfilled" ? f.value.pares : []), ...(y.status === "fulfilled" ? y.value : [])];
    return { pares: [...new Set(lista)].filter((x) => !/[\^=]/.test(x)).slice(0, 8), fuente: f.status === "fulfilled" ? "Finnhub + Yahoo" : "Yahoo" };
  },
  "/api/fundamentales": (u) => fundamentales(p(u, "t")),
  "/api/per": (u) => perCompleto(p(u, "t"), p(u, "pares")),
  "/api/risk": (u) => riskFactors(p(u, "t")),
  "/api/filings": (u) => filings(p(u, "t")),
  "/api/insiders": (u) => insiders(p(u, "t")),
  "/api/news": (u) => news(p(u, "q"), Math.min(60, Math.max(1, Number(p(u, "days", "14")) || 14)), p(u, "lang", "es")),

  /* ---------------------------------------------------------- mercado */
  "/api/mercado/tablero": () => mkt.tablero(),
  "/api/mercado/sectores": () => mkt.sectores(),
  "/api/mercado/macro": () => mkt.macroEEUU(),
  "/api/mercado/miedo": () => mkt.miedoCodicia(),
  "/api/mercado/calendario": (u) => mkt.calendarioBalances(Math.min(10, Number(p(u, "dias", "7")) || 7), p(u, "t").split(",").filter(Boolean)),

  /* -------------------------------------------------------- Argentina */
  "/api/ar/dolares": () => ar.dolares(),
  "/api/ar/dolar-historia": async (u) => {
    const h = await ar.historiaDolar(p(u, "casa", "blue"));
    const desde = new Date(Date.now() - (Number(p(u, "dias", "730")) || 730) * 864e5).toISOString().slice(0, 10);
    return { casa: p(u, "casa", "blue"), serie: h.filter((x) => x.fecha >= desde).map((x) => ({ d: x.fecha, v: x.venta, c: x.compra })) };
  },
  "/api/ar/riesgo": () => ar.riesgoPais(),
  "/api/ar/inflacion": () => ar.inflacion(),
  "/api/ar/rem": () => ar.rem(),
  "/api/ar/tasas": () => ar.tasas(),
  "/api/ar/rentafija": () => ar.rentaFija(),
  "/api/ar/panel": (u) => ar.panel(p(u, "tipo", "acciones")),
  "/api/ar/implicito": () => ar.dolarImplicito(),
  "/api/ar/bcra": () => ar.variablesBcra()
};

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"
};

/* Los widgets de TradingView son la única carga externa del navegador. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://s3.tradingview.com",
  "frame-src https://*.tradingview.com https://*.tradingview-widget.com",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

const PUBLIC = path.join(ROOT, "public");

/* Defensa contra "DNS rebinding": una página externa no puede usar este
   servidor local aunque consiga que el navegador le hable. */
function hostPermitido(req) {
  if (HOST !== "127.0.0.1" && HOST !== "localhost") return true;
  const h = String(req.headers.host || "").replace(/:\d+$/, "");
  return ["localhost", "127.0.0.1", "[::1]"].includes(h);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body, type = "application/json; charset=utf-8", extra = {}) => {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra });
    res.end(body);
  };
  const error = (e) => {
    const status = e instanceof HttpError && e.status >= 400 && e.status < 500 ? e.status : 502;
    send(status, JSON.stringify({ error: String(e.message || e) }));
  };

  if (!hostPermitido(req)) return send(403, JSON.stringify({ error: "host no permitido" }));

  if (req.method === "POST" && url.pathname === "/api/analizar") {
    /* Exigir JSON obliga al navegador a hacer una consulta previa (CORS), que
       este servidor no responde: otra página no puede gastar tu cuota. */
    if (!/application\/json/i.test(req.headers["content-type"] || "")) return send(415, JSON.stringify({ error: "se espera JSON" }));
    let cuerpo = "";
    req.on("data", (c) => { cuerpo += c; if (cuerpo.length > 600_000) req.destroy(); });
    req.on("end", async () => {
      try {
        const { prompt, proveedor } = JSON.parse(cuerpo || "{}");
        if (!prompt || prompt.length < 20) return send(400, JSON.stringify({ error: "prompt vacío" }));
        send(200, JSON.stringify(await analizar(prompt, proveedor)));
      } catch (e) { error(e); }
    });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(405, JSON.stringify({ error: "método no permitido" }));

  if (routes[url.pathname]) {
    try { send(200, JSON.stringify(await routes[url.pathname](url))); }
    catch (e) { error(e); }
    return;
  }
  if (url.pathname.startsWith("/api/")) return send(404, JSON.stringify({ error: "ruta inexistente" }));

  let rel;
  try { rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname); }
  catch { return send(400, "ruta inválida", "text/plain; charset=utf-8"); }
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(403, "prohibido", "text/plain; charset=utf-8");
  try {
    const body = await fs.readFile(file);
    const ext = path.extname(file);
    send(200, body, MIME[ext] || "application/octet-stream", ext === ".html" ? { "Content-Security-Policy": CSP } : { "Cache-Control": "no-cache" });
  } catch {
    send(404, "no encontrado", "text/plain; charset=utf-8");
  }
});

/* Solo escucha si se ejecuta directamente (los tests importan el servidor). */
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, "server.mjs")) server.listen(PORT, HOST, () => {
  const ia = estadoIA();
  console.log(`Market Desk ${VERSION} en http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${server.address().port}`);
  console.log(ia.ia
    ? `Análisis con IA: ${ia.proveedores.filter((x) => x.configurado).map((x) => x.nombre).join(", ")} (por defecto: ${ia.proveedor})`
    : "Análisis con IA: sin clave. Poné GEMINI_API_KEY, GROQ_API_KEY u OPENROUTER_API_KEY (gratuitas) en .env, o copiá los prompts a mano");
  console.log("Fuentes sin clave: Yahoo, Nasdaq, Stooq, SEC EDGAR, FRED, Google News, DolarApi, ArgentinaDatos, data912, BCRA");
  if (finnhubActivo()) console.log("Finnhub: activo");
});
