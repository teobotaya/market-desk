/* Recorre todas las rutas de la API con el fetch falso (sin red). Verifica
   que cada una responda 200 con la forma esperada, y algunos cálculos de
   punta a punta: ajuste por split, TTM y conversión a dólar CCL. */

import test from "node:test";
import assert from "node:assert/strict";
import "./fake-fetch.mjs";

process.env.HOST = "127.0.0.1";
/* Los clientes de los tests van a una carpeta temporal, nunca a datos/. */
import os from "node:os";
import fsSync from "node:fs";
import pathMod from "node:path";
process.env.MD_DATOS = fsSync.mkdtempSync(pathMod.join(os.tmpdir(), "md-test-"));
const { server } = await import("../server.mjs");
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/* El fetch global está reemplazado; para hablarle al servidor local usamos http. */
import http from "node:http";
function get(ruta, { metodo = "GET", cuerpo, tipo = "application/json", host } = {}) {
  return new Promise((resolve, reject) => {
    const largo = cuerpo ? { "content-length": Buffer.byteLength(cuerpo) } : {};
    const req = http.request(`${base}${ruta}`, { method: metodo, headers: { "content-type": tipo, ...largo, ...(host ? { host } : {}) } }, (res) => {
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
  const { MEP_SINTETICO, CCL_SINTETICO } = await import("./fake-fetch.mjs");
  assert.ok(Math.abs(imp.mepAl30.medio - MEP_SINTETICO) < 1e-6, "MEP implícito = pesos / especie D, calculado con el panel");
  assert.ok(Math.abs(imp.cclAl30.medio - CCL_SINTETICO) < 1e-6, "CCL implícito = pesos / especie C");
  assert.match(imp.fuente, /panel/);
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

/* ---------------------------------------------------------------- 2.1 */

const enviar = async (metodo, ruta, cuerpo) => {
  const r = await get(ruta, { metodo, cuerpo: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  assert.equal(r.status, 200, `${metodo} ${ruta} respondió ${r.status}: ${r.texto.slice(0, 300)}`);
  return r.json;
};

test("bonos soberanos en dólares: TIR, paridad, spreads y detalle", async () => {
  const b = await ok("/api/ar/bonos");
  assert.equal(b.filas.length, 11);
  const gd30 = b.filas.find((f) => f.ticker === "GD30");
  assert.equal(gd30.especie, "MEP");
  assert.ok(gd30.tir > 0 && gd30.md > 0 && gd30.paridad > 50 && gd30.vr === 64);
  assert.ok(b.spreads.length >= 4);
  const d = await ok("/api/ar/bono?t=GD35");
  assert.ok(d.cronograma.length > 20 && d.cronograma.some((f) => f.pagado) && d.cronograma.some((f) => !f.pagado));
  assert.ok(d.historia.length > 50, "TIR histórica recalculada");
  assert.equal((await get("/api/ar/bono?t=XX99")).status, 404);
});

test("estados financieros completos", async () => {
  const e = await ok("/api/estados?t=PRUEBA");
  assert.ok(e.anual.columnas.length >= 5 && e.trimestral.columnas.length === 8);
  const linea = (estado, k, modo = "anual") => e[modo].estados[estado].find((l) => l.k === k);
  const ult = (estado, k, modo) => linea(estado, k, modo).valores.at(-1);
  assert.ok(ult("resultados", "costoVentas") < 0, "el costo se muestra como salida");
  assert.ok(Math.abs(ult("resultados", "bruto") - ult("resultados", "ingresos") * 0.6) < 1, "bruto calculado");
  assert.ok(linea("resultados", "ebitda").calculada);
  assert.ok(Math.abs(ult("balance", "pasivo") - (ult("balance", "activo") - ult("balance", "patrimonio"))) < 1, "pasivo derivado de pasivo + patrimonio");
  assert.ok(ult("balance", "liquidez") > 2);
  assert.ok(ult("flujo", "fcf") > 0 && ult("flujo", "capex") < 0);
  assert.ok(linea("flujo", "cfo", "trimestral").valores.every((v) => v > 0), "flujo trimestral reconstruido");
});

test("calendario: todas las empresas con marca de destacadas", async () => {
  const c = await ok("/api/mercado/calendario?dias=5");
  const filas = c.dias.flatMap((d) => d.filas);
  assert.ok(filas.some((f) => f.ticker === "CHICA" && !f.destacada), "las chicas vienen para el buscador");
  assert.ok(filas.some((f) => f.ticker === "GRANDE" && f.destacada));
});

test("armado de carteras: supuestos, APT y optimización", async () => {
  const s = await ok("/api/carteras/supuestos?t=PRUEBA");
  assert.ok(s.rf.valor > 0 && s.beta !== null && s.E > 0 && s.fcf > 0 && s.acciones > 0);
  assert.ok(s.kd > 0 && s.tasaImpositiva > 0);
  const a = await ok("/api/carteras/apt?t=PRUEBA&f=SPY,GLD");
  assert.equal(a.factores.length, 2);
  assert.ok(a.semanas > 40 && a.r2 >= 0 && a.r2 <= 1);
  const o = await ok("/api/carteras/optimizar?t=PRUEBA,SPY,GGAL.BA&pesos=50,30,20&rf=4");
  assert.equal(o.activos.length, 3);
  assert.equal(o.activos[2].moneda, "USD CCL", "lo que cotiza en pesos se pasa a dólares");
  assert.ok(Math.abs(o.usuario.pesos.reduce((x, y) => x + y, 0) - 1) < 1e-9);
  assert.ok(o.minVar.vol <= o.usuario.vol + 1e-9);
  assert.ok(o.maxSharpe.sharpe >= o.usuario.sharpe - 1e-9);
  assert.equal(o.correlacion.length, 3);
  assert.equal((await get("/api/carteras/optimizar?t=PRUEBA")).status, 400);
});

test("clientes: movimientos, rendimiento, agenda, perfil, objetivo y baja", async () => {
  assert.equal((await ok("/api/clientes")).clientes.length, 0);
  /* Formato anterior (posiciones): se convierte en compras. */
  const c = await enviar("POST", "/api/clientes", {
    nombre: "Cliente de prueba", perfil: "conservador", horizonte: "largo", efectivo: { ARS: 157000, USD: 50 },
    posiciones: [
      { ticker: "prueba", cantidad: 10, precioCompra: 100, fechaCompra: "2026-01-15" },
      { ticker: "GGAL.BA", cantidad: 5, precioCompra: 4000, fechaCompra: "2026-03-02" }
    ]
  });
  assert.match(c.id, /^c[a-f0-9]{10}$/);
  assert.equal(c.movimientos.length, 2);
  assert.equal(c.movimientos[0].tipo, "compra");
  assert.equal(c.movimientos[0].ticker, "PRUEBA");
  assert.equal(c.criterios.volMax, 15, "criterios por defecto del perfil");
  const k = await ok(`/api/clientes/${c.id}/cartera`);
  assert.equal(k.posiciones.length, 2);
  const g = k.posiciones.find((p) => p.ticker === "GGAL.BA");
  assert.equal(g.moneda, "ARS");
  assert.ok(Math.abs(g.valorUsd - g.valorArs / k.cclHoy) < 1e-6, "pesos pasados a dólares por el CCL de hoy");
  assert.ok(Math.abs(k.posiciones.reduce((s, p) => s + p.peso, 0) + k.totales.liquidez - 100) < 1e-6, "pesos más liquidez suman 100");
  assert.ok(k.riesgo.vol > 0 && k.contribucion.length === 2);
  assert.ok(Math.abs(k.contribucion.reduce((s, x) => s + x.riesgo, 0) - 100) < 1e-6, "la contribución al riesgo suma 100");
  assert.ok(k.rendimiento && Number.isFinite(k.rendimiento.twrUsd) && k.rendimiento.serie.length > 50);
  assert.ok(k.rendimiento.benchmarks.find((b) => b.id === "spy").valor !== null);
  assert.ok(k.escenarios.length >= 2);
  assert.ok(k.alertas.some((a) => /pesa/.test(a.texto)), "concentración contra el máximo del perfil conservador");
  assert.ok(k.alertas.some((a) => /cuestionario/.test(a.texto)), "falta el cuestionario de perfil");

  /* Renta fija, venta parcial, renta cobrada, cuestionario y cartera objetivo. */
  const movimientos = [...c.movimientos,
    { tipo: "compra", ticker: "GD30D", cantidad: 1000, precio: 60, fecha: "2026-05-04" },
    { tipo: "compra", ticker: "YMCXD", cantidad: 2000, precio: 95, fecha: "2026-06-01" },
    { tipo: "venta", ticker: "PRUEBA", cantidad: 4, precio: 110, fecha: "2026-07-01" },
    { tipo: "renta", ticker: "GD30D", monto: 82.4, moneda: "USD", concepto: "cupón", fecha: "2026-07-09" }
  ];
  const respuestas = { experiencia: 1, conocimiento: 1, objetivo: 1, patrimonio: 1, ingresos: 1, horizonte: 1, perdida: 1, reaccion: 1 };
  const e = await enviar("PUT", `/api/clientes/${c.id}`, {
    nombre: "Cliente editado", perfil: "moderado", criterios: { pesoMax: 100 }, movimientos,
    cuestionario: { respuestas, fecha: "2026-02-01", montoAnual: 50000, origenFondos: "Ahorros" },
    asignacion: [{ ticker: "GD30D", peso: 40 }, { ticker: "PRUEBA", peso: 20 }]
  });
  assert.equal(e.nombre, "Cliente editado");
  assert.equal(e.movimientos.length, 6);
  assert.equal(e.cuestionario.sugerido, "conservador");
  const k2 = await ok(`/api/clientes/${c.id}/cartera`);
  const gd = k2.posiciones.find((p) => p.ticker === "GD30D");
  assert.ok(gd.rentaFija && Math.abs(gd.valorUsd - 1000 * 62 / 100) < 1e-6, "renta fija valuada cada 100 nominales");
  assert.equal(k2.posiciones.find((p) => p.ticker === "PRUEBA").cantidad, 6);
  assert.ok(k2.totales.realizadoUsd !== 0 && Math.abs(k2.totales.rentasUsd - 82.4) < 1e-9);
  assert.ok(k2.agenda.some((f) => f.ticker === "GD30D" && f.fecha.endsWith("-01-09")), "cupón de enero en la agenda");
  assert.ok(k2.agenda.some((f) => f.ticker === "YMCXD"), "flujos de la ON en la agenda");
  assert.ok(k2.sensibilidad.dv01Usd > 0);
  assert.ok(k2.alertas.some((a) => /más agresivo/.test(a.texto)), "perfil asignado más agresivo que el sugerido");
  assert.ok(k2.rebalanceo.filas.some((f) => f.ticker === "Efectivo"));
  assert.ok(!k2.alertas.some((a) => /pesa/.test(a.texto)));
  const dsc = k2.rendimiento.descomposicion;
  assert.ok(dsc && Number.isFinite(dsc.precioUsd) && Number.isFinite(dsc.efectoDolar));
  assert.ok(Math.abs(dsc.precioUsd + dsc.rentasUsd - k2.rendimiento.twrUsd) < 1e-9, "precio + rentas = total");

  /* Nueva versión del perfil: la anterior queda en el historial. Un perfil
     vencido con operaciones posteriores genera alerta. */
  const v2 = await enviar("PUT", `/api/clientes/${c.id}`, { cuestionario: { respuestas, fecha: "2025-03-01" } });
  assert.equal(v2.historialPerfil.length, 1);
  assert.equal(v2.historialPerfil[0].fecha, "2026-02-01");
  assert.equal(v2.cuestionario.version, 2);
  const k3 = await ok(`/api/clientes/${c.id}/cartera`);
  assert.ok(k3.alertas.some((a) => /perfil vencido/.test(a.texto)), "operó con el perfil vencido");
  const conTc = await enviar("PUT", `/api/clientes/${c.id}`, { movimientos: [...v2.movimientos, { tipo: "compra", ticker: "GGAL.BA", cantidad: 1, precio: 4000, fecha: "2026-08-03", tipoCambio: 1450 }] });
  assert.equal(conTc.movimientos.find((m) => m.tipoCambio).tipoCambio, 1450);

  /* Validaciones. */
  const malo = (cuerpo) => get(`/api/clientes/${c.id}`, { metodo: "PUT", cuerpo: JSON.stringify(cuerpo) });
  assert.equal((await malo({ movimientos: [...movimientos, { tipo: "venta", ticker: "PRUEBA", cantidad: 50, precio: 1, fecha: "2026-08-01" }] })).status, 400, "no se puede vender más de lo que hay");
  assert.equal((await malo({ asignacion: [{ ticker: "A", peso: 70 }, { ticker: "B", peso: 40 }] })).status, 400, "la cartera objetivo no puede pasar de 100%");
  assert.equal((await malo({ cuestionario: { respuestas: { experiencia: 1 } } })).status, 400, "cuestionario incompleto");
  assert.equal((await get("/api/clientes", { metodo: "POST", cuerpo: JSON.stringify({ nombre: "" }) })).status, 400);
  assert.equal((await get("/api/clientes", { metodo: "POST", cuerpo: JSON.stringify({ nombre: "x", posiciones: [{ ticker: "no válido!", cantidad: 1, precioCompra: 1 }] }) })).status, 400);
  assert.equal((await get(`/api/clientes/${c.id}`, { metodo: "DELETE", tipo: "text/plain" })).status, 415, "borrar exige JSON");
  await enviar("DELETE", `/api/clientes/${c.id}`, {});
  assert.equal((await get(`/api/clientes/${c.id}`)).status, 404);
  assert.equal((await get("/api/clientes/../../etc")).status, 404);
});

test("renta fija propia: LECAP, ONs, bonos nuevos, breakevens y CEDEARs", async () => {
  const { TIR_SINTETICA } = await import("./fake-fetch.mjs");
  const f = await ok("/api/ar/tasafija");
  const s30 = f.filas.find((x) => x.ticker === "S30N6");
  assert.equal(s30.fuente, "propia");
  assert.ok(Math.abs(s30.tem - TIR_SINTETICA.temLecap * 100) < 0.01, `TEM recalculada desde el pago final: ${s30.tem}`);
  assert.ok(f.filas.every((x) => x.dias > 0));
  const o = await ok("/api/ar/ons");
  const ym = o.filas.find((x) => x.ticker === "YMCXD");
  assert.ok(Math.abs(ym.tir - TIR_SINTETICA.ons * 100) < 0.05, `TIR de la ON: ${ym.tir}`);
  assert.ok(Number.isFinite(ym.spread) && ym.md > 0);
  assert.ok(o.filas.every((x) => typeof x.pocaLiquidez === "boolean" && (x.precio === null || Number.isFinite(x.operaciones))), "cada ON trae sus operaciones y la marca de liquidez");
  const n = await ok("/api/ar/dolar-nuevos");
  assert.ok(Math.abs(n.filas.find((x) => x.ticker === "AN29").tir - TIR_SINTETICA.nuevos * 100) < 0.05);
  const b = await ok("/api/ar/breakevens");
  assert.ok(b.banda.techo > b.banda.piso && b.banda.distanciaTecho !== null);
  assert.ok(b.carry.length && b.carry.every((x) => x.dolarEquilibrio > b.mayorista && (x.dias > 550 ? x.techo === null : x.techo >= b.banda.techo)), "techo proyectado hasta 18 meses");
  assert.ok(b.remPromedio > 1 && b.remPromedio < 3, `REM solo con medianas mensuales: ${b.remPromedio}`);
  assert.ok(b.implicita.every((x) => Math.abs(x.tirReal) <= 20), "sin TIR reales imposibles en la curva CER");
  const ce = await ok("/api/ar/cedears");
  const aapl = ce.filas.find((x) => x.ticker === "AAPL");
  assert.ok(Math.abs(aapl.mepImplicito - 1570) < 1e-6, "MEP implícito = pesos / especie D");
  assert.ok(Math.abs(aapl.cclImplicito - 1655) < 1e-6 && !aapl.cclEstimado, "CCL implícito = pesos / especie C, sin depender del ratio");
  const msft = ce.filas.find((x) => x.ticker === "MSFT");
  assert.ok(msft.cclImplicito > 0 && msft.cclEstimado, "sin especie C, estimado con el ratio y el precio en Nueva York");
  assert.ok((await ok("/api/ar/metodologia")).filas.length >= 5);
  const { CER_SINTETICO } = await import("./fake-fetch.mjs");
  const cer = await ok("/api/ar/cer");
  assert.equal(cer.cerReferencia.valor, CER_SINTETICO);
  const propios = cer.filas.filter((x) => x.fuente === "propia" && x.tir !== null);
  assert.ok(propios.length >= 6, "bonos CER calculados en la app");
  for (const x of propios) assert.ok(Math.abs(x.tir - TIR_SINTETICA.realCer * 100) < 0.05, `TIR real de ${x.ticker}: ${x.tir}`);
  assert.ok(cer.filas.some((x) => x.fuente === "ArgentinaDatos"), "el resto, de ArgentinaDatos");
  assert.ok(cer.filas.filter((x) => /^(TXM|DIC|PAR)/.test(x.ticker)).every((x) => x.dudosa), "duales y Discount/Par fuera de la curva");
  assert.ok(b.implicita.length && b.implicita.every((x) => Math.abs(x.tirReal - TIR_SINTETICA.realCer * 100) < 0.1), "la inflación implícita usa la curva CER propia");
});

test("cada fuente recibe el User-Agent que acepta", async () => {
  const { agenteDe, BROWSER_UA, UA_CORTO } = await import("../lib/http.mjs");
  assert.equal(agenteDe("https://query2.finance.yahoo.com/v8/finance/chart/%5EVIX"), UA_CORTO, "Yahoo responde 429 a agentes de navegador");
  assert.equal(agenteDe("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"), UA_CORTO, "FRED no responde a agentes de navegador");
  assert.equal(agenteDe("https://production.dataviz.cnn.io/index/fearandgreed/graphdata"), BROWSER_UA, "CNN exige uno de navegador");
  assert.match(agenteDe("https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json"), /@/, "la SEC exige un email de contacto");
  const m = await ok("/api/mercado/tablero");
  const filas = m.grupos.flatMap((g) => g.items);
  assert.ok(filas.length > 25 && filas.every((x) => x.last !== undefined && !x.error), `todo el resumen con datos: ${filas.filter((x) => x.error).map((x) => x.ticker).join(", ")}`);
  assert.ok(filas.every((x) => x.fuente === "Yahoo Finance" || x.ticker === "ETH-USD" || (x.ticker === "^MERV" && x.fuente === "BYMA")), "Yahoo para todo, salvo el Merval (BYMA) y el símbolo caído (FRED)");
});

test("si Yahoo no responde, el precio sale de FRED con el valor real", async () => {
  const p = await ok("/api/price?t=ETH-USD");
  assert.equal(p.source, "FRED");
  assert.equal(p.ticker, "ETH-USD");
  assert.ok(p.candles.length > 200 && p.stats.last > 0);
  assert.match(p.note, /FRED \(CBETHUSD\)/);
});

test("Merval de BYMA: continuo a través del cambio de base de MSCI (19/10/2026)", async () => {
  const { MERVAL_NUEVA, SALTO_MERVAL } = await import("./fake-fetch.mjs");
  const p = await ok("/api/price?t=%5EMERV&rango=1y");
  assert.equal(p.source, "BYMA");
  assert.equal(p.nombre, "MSCI Merval");
  assert.equal(p.moneda, "ARS");
  const saltos = p.candles.slice(1).map((x, i) => Math.abs(x.c / p.candles[i].c - 1));
  assert.ok(Math.max(...saltos) < 0.05, "sin el salto de 29 veces del cambio de base");
  const ultimo = MERVAL_NUEVA.at(-1);
  assert.ok(Math.abs(p.stats.last - ultimo.c) < 1e-6, "el último valor es el de la base nueva");
  const previo = p.candles.filter((x) => x.d < SALTO_MERVAL).at(-1);
  if (previo) assert.ok(Math.abs(previo.c - 100000) < 1e-6, "el cierre del 16/10 vale 100.000 en la base nueva");
});

test("una serie desactualizada se muestra con su fecha si no hay otra fuente", async () => {
  const p = await ok("/api/price?t=VIEJO%3DX");
  assert.match(p.note, /Último dato disponible/);
  assert.ok(Date.now() - Date.parse(p.stats.date) > 20 * 864e5);
});
