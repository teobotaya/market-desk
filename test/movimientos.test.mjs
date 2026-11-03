/* Motor de movimientos, renta fija propia y cuestionario de perfil: casos
   armados a mano donde el resultado correcto se conoce de antemano. */

import test from "node:test";
import assert from "node:assert/strict";
import { tenencias, twr, tirCartera, mensuales, rebalanceo, contribucionRiesgo, ventaInvalida, crearValuador } from "../lib/movimientos.mjs";
import { tasasLetra, inflacionImplicita, proyectarTecho, interpolar } from "../lib/rentafija.mjs";
import { agendaCobros } from "../lib/clientes.mjs";
import { puntuar, PREGUNTAS, vencimiento } from "../public/js/perfil.js";

const cerca = (a, b, tol = 1e-6, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} esperaba ${b}, dio ${a}`);
const USD = () => ({ moneda: "USD", factor: 1 });
const sinCcl = () => 1000;

test("costo promedio, venta parcial y resultado realizado", () => {
  const movs = [
    { tipo: "compra", ticker: "X", cantidad: 10, precio: 100, fecha: "2026-01-02" },
    { tipo: "compra", ticker: "X", cantidad: 10, precio: 120, fecha: "2026-02-02", comision: 20 },
    { tipo: "venta", ticker: "X", cantidad: 5, precio: 150, fecha: "2026-03-02" },
    { tipo: "renta", ticker: "X", monto: 30, moneda: "USD", fecha: "2026-03-10" }
  ];
  const { tenencias: t } = tenencias(movs, USD, sinCcl);
  const x = t[0];
  /* Costo total 1000 + 1220 = 2220 por 20 unidades = 111 de promedio. */
  cerca(x.cantidad, 15);
  cerca(x.costoUsd, 2220 * 0.75);
  cerca(x.realizadoUsd, 5 * 150 - 5 * 111);
  cerca(x.rentasUsd, 30);
  assert.equal(ventaInvalida([...movs, { tipo: "venta", ticker: "X", cantidad: 16, precio: 1, fecha: "2026-04-01" }]).tenencia, 15);
  assert.equal(ventaInvalida(movs), null);
});

test("renta fija cotiza cada 100 nominales y los pesos se pasan al CCL de cada fecha", () => {
  const info = (t) => (t === "AL30" ? { moneda: "ARS", factor: 0.01 } : { moneda: "USD", factor: 1 });
  const ccl = (f) => (f < "2026-06-01" ? 1000 : 1250);
  const { tenencias: t } = tenencias([{ tipo: "compra", ticker: "AL30", cantidad: 1000, precio: 80000, fecha: "2026-01-05" }], info, ccl);
  cerca(t[0].costoUsd, (1000 * 80000 * 0.01) / 1000, 1e-9, "1000 nominales a $80.000 cada 100 = $800.000 = US$ 800");
});

test("TWR: neutraliza los aportes; TIR de la cartera los pondera", () => {
  /* El activo sube 10% y después cae 10%. Se compra 1 unidad al inicio y 9 más en el pico. */
  const series = new Map([["X", [{ d: "2026-01-01", c: 100 }, { d: "2026-02-01", c: 110 }, { d: "2026-03-01", c: 99 }]]]);
  const movs = [
    { tipo: "compra", ticker: "X", cantidad: 1, precio: 100, fecha: "2026-01-01" },
    { tipo: "compra", ticker: "X", cantidad: 9, precio: 110, fecha: "2026-02-01" }
  ];
  const r = twr(["2026-01-01", "2026-02-01", "2026-03-01"], movs, USD, sinCcl, crearValuador(series, USD, sinCcl));
  cerca(r.usd, (1.1 * 0.9 - 1) * 100, 1e-9, "TWR = rendimiento del activo, sin importar cuándo se compró");
  const final = 10 * 99;
  const m = tirCartera(movs, USD, sinCcl, { usd: final, ars: final * 1000 }, "2026-03-01");
  assert.ok(m.usdSimple < r.usd, "comprar en el pico empeora el resultado en dinero");
  cerca(m.usdSimple, (990 / 1090 - 1) * 100, 1e-9);
  assert.ok(m.usd < 0);
  const mes = mensuales(r.serie);
  cerca(mes["2026-02"], 10, 1e-9);
  cerca(mes["2026-03"], -10, 1e-9);
});

test("TWR: una venta total y las rentas cuentan como salida, no como pérdida", () => {
  const series = new Map([["X", [{ d: "2026-01-01", c: 100 }, { d: "2026-01-02", c: 105 }, { d: "2026-01-03", c: 200 }]]]);
  const movs = [
    { tipo: "compra", ticker: "X", cantidad: 10, precio: 100, fecha: "2026-01-01" },
    { tipo: "renta", ticker: "X", monto: 10, moneda: "USD", fecha: "2026-01-02" },
    { tipo: "venta", ticker: "X", cantidad: 10, precio: 105, fecha: "2026-01-02" }
  ];
  const r = twr(["2026-01-01", "2026-01-02", "2026-01-03"], movs, USD, sinCcl, crearValuador(series, USD, sinCcl));
  cerca(r.usd, (1050 + 10) / 1000 * 100 - 100, 1e-9, "5% de precio más 1% de renta; la suba posterior a la venta no cuenta");
});

test("rebalanceo y contribución al riesgo", () => {
  const pos = [{ ticker: "A", valorUsd: 600, unidadUsd: 10 }, { ticker: "B", valorUsd: 300, unidadUsd: 30 }];
  const r = rebalanceo(pos, [{ ticker: "A", peso: 40 }, { ticker: "B", peso: 40 }], 1000, 100, 5);
  const a = r.filas.find((f) => f.ticker === "A"), e = r.filas.find((f) => f.ticker === "Efectivo");
  cerca(a.montoUsd, -200); cerca(a.cantidad, -20);
  assert.ok(a.fuera);
  cerca(e.objetivo, 20); cerca(e.montoUsd, 100);
  const c = contribucionRiesgo([0.5, 0.5], [[0.04, 0], [0, 0.01]]);
  cerca(c[0] + c[1], 100, 1e-9);
  cerca(c[0], 80, 1e-9, "el activo más volátil aporta cuatro veces más varianza");
});

test("LECAP: TEM, TEA y TNA desde el pago final", () => {
  const t = tasasLetra(100, 106, "2026-01-01", "2026-03-02");
  cerca(t.dias, 60);
  cerca(t.tem, (1.06 ** 0.5 - 1) * 100, 1e-9);
  cerca(t.tna, 6 * 365 / 60, 1e-9);
  cerca(t.tea, (1.06 ** (365 / 60) - 1) * 100, 1e-9);
});

test("inflación implícita, interpolación y techo de la banda", () => {
  cerca(interpolar([{ md: 1, tir: 10 }, { md: 3, tir: 14 }], 2), 12);
  cerca(interpolar([{ md: 1, tir: 10 }, { md: 3, tir: 14 }], 9), 14, 0, "plana fuera del rango");
  const cer = [{ dias: 100, tir: 2 }, { dias: 300, tir: 4 }];
  const [x] = inflacionImplicita([{ ticker: "S1", vence: "2026-12-01", dias: 200, tem: 2, tea: 30, dudosa: false }], cer);
  cerca(x.tirReal, 3);
  cerca(x.anual, (1.3 / 1.03 - 1) * 100, 1e-9);
  const t = proyectarTecho(1000, "2026-01-01", "2026-03-01", () => 2);
  assert.ok(t > 1039 && t < 1041, `dos meses al 2% dan ≈1040, dio ${t}`);
  assert.equal(proyectarTecho(null, "2026-01-01", "2026-03-01", () => 2), null);
});

test("agenda de cobros: cupones del canje y pago final de LECAP", () => {
  const filas = agendaCobros([{ ticker: "GD30D", cantidad: 1000 }, { ticker: "S30N6", cantidad: 500 }], "2026-11-01", "2027-07-31");
  const ene = filas.find((f) => f.ticker === "GD30D" && f.fecha === "2027-01-09");
  /* GD30 en enero 2027: amortiza 8 y paga 0,75%/2 sobre un residual de 64 (US$ 0,24 cada 100). */
  cerca(ene.amortizacion, 80, 1e-9);
  cerca(ene.cupon, (64 * 0.0075 / 2) * 10, 1e-9);
  const lecap = filas.find((f) => f.ticker === "S30N6");
  assert.equal(lecap.moneda, "ARS");
  assert.ok(lecap.total > 500, "pago final cada 100 nominales por 500 nominales");
});

test("cuestionario de perfil: puntaje, topes y vencimiento", () => {
  const todo = (v) => Object.fromEntries(PREGUNTAS.map((p) => [p.id, v]));
  assert.equal(puntuar(todo(3)).sugerido, "agresivo");
  assert.equal(puntuar(todo(0)).sugerido, "conservador");
  assert.equal(puntuar(todo(1)).sugerido, "conservador");
  const topeado = puntuar({ ...todo(3), horizonte: 0 });
  assert.equal(topeado.sugerido, "conservador", "con menos de un año de horizonte no puede ser agresivo");
  assert.ok(topeado.topeado);
  assert.equal(puntuar({ ...todo(2) }).sugerido, "moderado");
  assert.equal(puntuar({ experiencia: 1 }).completo, false);
  assert.equal(vencimiento("2026-01-15"), "2027-01-15");
});
