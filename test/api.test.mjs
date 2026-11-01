/* Recorre todas las rutas de la API con el fetch falso (sin red). Verifica
   que cada una responda 200 con la forma esperada, y algunos cálculos de
   punta a punta: ajuste por split, TTM y conversión a dólar CCL. */

import test from "node:test";
import assert from "node:assert/strict";
import "./fake-fetch.mjs";

process.env.HOST = "127.0.0.1";
const { server } = await import("../server.mjs");
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/* El fetch global está reemplazado; para hablarle al servidor local usamos http. */
import http from "node:http";
function get(ruta, { metodo = "GET", cuerpo, tipo = "application/json", host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${ruta}`, { method: metodo, headers: { "content-type": tipo, ...(host ? { host } : {}) } }, (res) => {
      let d = "";
      res.on("data", (c) => { d += c; });
      res.on("end", () => {
        let j = null;
        try { j = JSON.parse(d); } catch { /* html */ }
        resolve({ status: res.statusCode, json: j, texto: d, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}
const ok = async (ruta) => {
  const r = await get(ruta);
  assert.equal(r.status, 200, `${ruta} respondió ${r.status}: ${r.texto.slice(0, 300)}`);
  return r.json;
};

test("estado", async () => {
  const e = await ok("/api/estado");
  assert.equal(e.ia.ia, false);
  assert.ok(e.ia.proveedores.some((p) => p.id === "groq" && p.gratis));
});

test("precio con indicadores y lectura", async () => {
  const p = await ok("/api/price?t=PRUEBA");
  assert.equal(p.ticker, "PRUEBA");
  assert.equal(p.source, "Yahoo Finance");
  assert.ok(p.candles.length > 400);
  assert.ok(p.stats.rsi14 > 0);
  assert.ok(Array.isArray(p.lectura));
  assert.ok(p.rentaDividendo > 0);
  const largo = await ok("/api/price?t=PRUEBA&rango=5y");
  assert.ok(largo.candles.length > 1000);
});

test("índice por alias y BYMA en dólares CCL", async () => {
  const sp = await ok("/api/price?t=S%26P500");
  assert.equal(sp.ticker, "^GSPC");
  const ars = await ok("/api/price?t=GGAL.BA");
  assert.equal(ars.moneda, "ARS");
  const usd = await ok("/api/price?t=GGAL.BA&usd=ccl");
  assert.equal(usd.moneda, "USD CCL");
  assert.ok(usd.stats.last < ars.stats.last / 100, "el precio en dólares es mucho menor que en pesos");
});

test("ticker inexistente: error claro", async () => {
  const r = await get("/api/price?t=NOEXISTE");
  assert.equal(r.status, 502);
  assert.match(r.json.error, /Ninguna fuente/);
});

test("cotizaciones en lote y buscador", async () => {
  const c = await ok("/api/cotizaciones?t=PRUEBA,^MERV,NOEXISTE");
  assert.equal(c.filas.length, 3);
  assert.ok(c.filas[2].error);
  const b = await ok("/api/buscar?q=prueba");
  assert.ok(b.resultados.some((x) => x.ticker === "PRUEBA"));
});

test("fundamentales: TTM, trimestres y valuación", async () => {
  const f = await ok("/api/fundamentales?t=PRUEBA");
  assert.equal(f.moneda, "USD");
  assert.ok(f.filas.length >= 5);
  assert.equal(f.trimestral.length, 8);
  assert.match(f.ttm.base, /4 trimestres/);
  /* Ingresos 12m = suma de los últimos cuatro trimestres. */
  const suma = f.trimestral.slice(-4).reduce((a, q) => a + q.ingresos, 0);
  assert.ok(Math.abs(f.ttm.ingresos - suma) / suma < 1e-9);
  assert.ok(f.ttm.crecimiento > 0);
  assert.ok(f.valuacion.per > 0 && f.valuacion.evEbitda > 0);
  /* Márgenes del fixture: bruto 60%, operativo 30%. */
  assert.ok(Math.abs(f.ttm.margenBruto - 60) < 1e-6);
  assert.ok(Math.abs(f.ttm.margenOperativo - 30) < 1e-6);
  /* El flujo de caja trimestral se reconstruye desde acumulados. */
  assert.ok(f.trimestral.every((q) => q.fcf > 0));
});

test("CEDEAR: estados y precio del emisor en EE.UU., misma moneda", async () => {
  const f = await ok("/api/fundamentales?t=PRUEBA.BA");
  assert.equal(f.viaAdr, "PRUEBA");
  assert.equal(f.valuacion.moneda, "USD");
  assert.equal(f.avisoValuacion, null);
});

test("PER histórico sin saltos por el split 4:1", async () => {
  const d = await ok("/api/per?t=PRUEBA&pares=PAR1,PAR2,NOEXISTE");
  assert.ok(d.actual > 0);
  const vals = d.historico.serie.map((x) => x.per);
  /* Sin el ajuste, los BPA previos al split valdrían 4 veces más y el PER
     caería a la cuarta parte de golpe. */
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i] / vals[i - 1] < 1.8 && vals[i - 1] / vals[i] < 1.8, `salto en ${d.historico.serie[i].d}`);
  assert.equal(d.pares.length, 3);
  assert.ok(d.pares[2].error);
  assert.ok(d.medianaPares > 0);
});

test("consenso, pares sugeridos y volatilidad implícita", async () => {
  const c = await ok("/api/consenso?t=PRUEBA");
  assert.equal(c.analistas, 31);
  assert.ok(c.objetivo.medio > 0);
  assert.equal(c.estimaciones.length, 4);
  const p = await ok("/api/pares?t=PRUEBA");
  assert.deepEqual(p.pares, ["PAR1", "PAR2"]);
  const iv = await ok("/api/iv?t=PRUEBA");
  assert.equal(iv.plazos.length, 3);
  assert.ok(Math.abs(iv.plazos[1].iv - 39) < 1e-9);
});

test("riesgo con referencia", async () => {
  const r = await ok("/api/riesgo?t=PRUEBA&b=SPY");
  assert.equal(r.benchmark, "SPY");
  assert.ok(r.perfil.beta !== null && r.perfil.sharpe !== null);
});

test("SEC: 10-K comparado, filings e insiders", async () => {
  const r = await ok("/api/risk?t=PRUEBA");
  assert.equal(r.form, "10-K");
  assert.ok(r.risks.length >= 5);
  assert.ok(r.comparado, "compara con el informe anterior");
  assert.ok(r.risks.some((x) => x.nuevo && /single customer/i.test(x.heading)));
  assert.ok(r.comparado.eliminados.some((x) => /legacy/i.test(x)));
  const f = await ok("/api/filings?t=PRUEBA");
  assert.ok(f.filings.some((x) => x.form === "8-K" && x.items.some((i) => i.codigo === "2.02")));
  const i = await ok("/api/insiders?t=PRUEBA");
  assert.equal(i.resumen.compras, 1);
  assert.equal(i.resumen.ventas, 1);
  assert.equal(i.resumen.ventasPlanificadas, 1);
  assert.ok(Math.abs(i.resumen.montoVentas - 20000 * 120.5) < 1e-6);
});

test("noticias", async () => {
  const n = await ok("/api/news?q=prueba&days=7");
  assert.ok(n.items.length >= 5);
  assert.ok(n.summary.pos > 0 && n.summary.neg > 0);
  assert.ok(!n.items[0].title.endsWith("Sintético 0"), "saca el medio del título");
});

test("mercado global", async () => {
  const t = await ok("/api/mercado/tablero");
  assert.ok(t.grupos.length >= 5);
  assert.ok(t.grupos[0].items.every((x) => x.last > 0));
  const s = await ok("/api/mercado/sectores");
  assert.ok(s.filas.length >= 12);
  const m = await ok("/api/mercado/macro");
  assert.ok(m.indicadores.every((x) => !x.error));
  assert.ok(m.curva.every((x) => x.hoy !== null));
  const fg = await ok("/api/mercado/miedo");
  assert.equal(fg.etiqueta, "codicia");
  const cal = await ok("/api/mercado/calendario?dias=5&t=CHICA");
  assert.equal(cal.dias.length, 5);
  const filas = cal.dias.flatMap((d) => d.filas);
  assert.ok(filas.some((x) => x.ticker === "CHICA" && x.enWatchlist), "incluye la watchlist aunque sea chica");
  assert.ok(filas.every((x) => x.capitalizacion >= 10e9 || x.enWatchlist));
});

test("Argentina con datos reales de ArgentinaDatos y DolarApi", async () => {
  const d = await ok("/api/ar/dolares");
  const blue = d.filas.find((x) => x.casa === "blue");
  assert.ok(blue.venta > 0 && blue.brechaOficial !== null && blue.spark.length > 10);
  assert.ok(d.canje > 0);
  const r = await ok("/api/ar/riesgo");
  assert.ok(r.valor > 0 && r.serie.length > 100);
  const i = await ok("/api/ar/inflacion");
  assert.ok(i.ultimo.valor > 0 && i.acumuladoAnio > 0);
  const rem = await ok("/api/ar/rem");
  assert.ok(rem.inflacion.length > 0 && rem.tipoCambio.length > 0);
  const t = await ok("/api/ar/tasas");
  assert.ok(t.plazoFijo.length > 5 && t.plazoFijo[0].tnaClientes > 1, "TNA en porcentaje");
  assert.ok(t.fci.length > 0 && t.cauciones.length === 2);
  const rf = await ok("/api/ar/rentafija");
  assert.ok(rf.letras.length > 0 && rf.cer.length > 0);
  const h = await ok("/api/ar/dolar-historia?casa=blue&dias=365");
  assert.ok(h.serie.length > 100);
  const bad = await get("/api/ar/dolar-historia?casa=../../x");
  assert.equal(bad.status, 400);
});

test("paneles de BYMA, dólar implícito y BCRA", async () => {
  const p = await ok("/api/ar/panel?tipo=acciones");
  assert.ok(p.filas.some((x) => x.lider));
  for (const tipo of ["cedears", "bonos", "letras", "ons", "adrs"]) assert.ok((await ok(`/api/ar/panel?tipo=${tipo}`)).filas.length > 0, tipo);
  const imp = await ok("/api/ar/implicito");
  assert.ok(imp.mepAl30 && imp.cclAl30);
  const b = await ok("/api/ar/bcra");
  assert.equal(b.filas.length, 2);
});

test("seguridad: host ajeno, JSON obligatorio, rutas y archivos", async () => {
  assert.equal((await get("/api/estado", { host: "evil.example" })).status, 403);
  const ia = await get("/api/analizar", { metodo: "POST", cuerpo: JSON.stringify({ prompt: "x".repeat(50) }), tipo: "text/plain" });
  assert.equal(ia.status, 415);
  const sinClave = await get("/api/analizar", { metodo: "POST", cuerpo: JSON.stringify({ prompt: "x".repeat(50) }) });
  assert.equal(sinClave.status, 502);
  assert.match(sinClave.json.error, /clave/);
  assert.equal((await get("/api/no-existe")).status, 404);
  assert.equal((await get("/..%2f..%2fserver.mjs")).status, 403);
  const html = await get("/");
  assert.equal(html.status, 200);
  assert.match(html.headers["content-security-policy"], /default-src 'self'/);
  assert.equal((await get("/js/main.js")).status, 200);
});
