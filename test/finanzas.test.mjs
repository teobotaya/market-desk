import test from "node:test";
import assert from "node:assert/strict";
import { capm, wacc, apt, van, tir, xvan, xtir, recupero, dcf, sensibilidadDcf, regresion, invertir, covarianza, correlacion, estadisticasCartera, simularCarteras, medidasBono, precioDesdeTir, dias30360, liquidacion } from "../public/js/finanzas.js";
import { cronograma, valorTecnico, analizar, BONOS } from "../lib/bonos.mjs";

const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} no está cerca de ${b}`);

test("CAPM, WACC y APT", () => {
  cerca(capm({ rf: 4, beta: 1.2, primaMercado: 5 }), 10);
  cerca(capm({ rf: 4, beta: 1.2, primaMercado: 5, riesgoPais: 7.5 }), 17.5);
  assert.equal(capm({ rf: 4, beta: null, primaMercado: 5 }), null);
  const w = wacc({ E: 600, D: 400, ke: 12, kd: 8, t: 25 });
  cerca(w.wacc, 0.6 * 12 + 0.4 * 8 * 0.75);
  cerca(w.pesoE, 60);
  assert.equal(wacc({ E: 0, D: 0, ke: 10, kd: 5 }), null);
  cerca(apt({ rf: 3, betas: [1, 0.5], primas: [5, 2] }), 9);
});

test("VAN, TIR y recupero", () => {
  const f = [-1000, 300, 400, 500];
  cerca(van(10, f), -1000 + 300 / 1.1 + 400 / 1.21 + 500 / 1.331, 1e-9);
  const r = tir(f);
  cerca(van(r, f), 0, 1e-6);
  cerca(r, 8.896, 1e-3);
  assert.equal(tir([100, 200]), null, "sin cambio de signo no hay TIR");
  cerca(recupero(f), 2 + 300 / 500);
});

test("XTIR con fechas coincide con el VAN en cero", () => {
  const f = [{ fecha: "2026-01-01", monto: -100 }, { fecha: "2026-07-01", monto: 5 }, { fecha: "2027-01-01", monto: 105 }];
  const r = xtir(f);
  cerca(xvan(r, f), 0, 1e-6);
  assert.ok(r > 9 && r < 11);
});

test("DCF: suma de flujos descontados más valor terminal", () => {
  const d = dcf({ fcf0: 100, crecimientos: [10, 10], gTerminal: 2, wacc: 9, deudaNeta: 200, acciones: 10 });
  const f1 = 110, f2 = 121;
  const tv = (121 * 1.02) / (0.09 - 0.02);
  const ev = f1 / 1.09 + f2 / 1.09 ** 2 + tv / 1.09 ** 2;
  cerca(d.ev, ev, 1e-6);
  cerca(d.porAccion, (ev - 200) / 10, 1e-6);
  assert.ok(dcf({ fcf0: 100, crecimientos: [5], gTerminal: 9, wacc: 8 }).error);
  const m = sensibilidadDcf({ fcf0: 100, crecimientos: [5, 5], deudaNeta: 0, acciones: 1 }, [8, 9], [1, 2]);
  assert.ok(m[0][1] > m[0][0], "más crecimiento perpetuo, más valor");
  assert.ok(m[0][0] > m[1][0], "más WACC, menos valor");
});

test("Regresión recupera los coeficientes exactos", () => {
  const X = [], y = [];
  for (let i = 0; i < 60; i++) {
    const a = Math.sin(i), b = Math.cos(i * 1.3);
    X.push([a, b]);
    y.push(0.5 + 2 * a - 1.5 * b);
  }
  const r = regresion(y, X);
  cerca(r.alfa, 0.5, 1e-9);
  cerca(r.betas[0], 2, 1e-9);
  cerca(r.betas[1], -1.5, 1e-9);
  cerca(r.r2, 1, 1e-9);
  const inv = invertir([[4, 7], [2, 6]]);
  cerca(inv[0][0], 0.6); cerca(inv[0][1], -0.7); cerca(inv[1][0], -0.2); cerca(inv[1][1], 0.4);
});

test("Carteras: dos activos no correlacionados y Montecarlo", () => {
  const a = [0.01, -0.01, 0.02, -0.02, 0.01, -0.01], b = [0.01, 0.01, -0.01, -0.01, 0.02, -0.02];
  const cov = covarianza([a, b]);
  const corr = correlacion(cov);
  cerca(corr[0][0], 1);
  const medias = [10, 6], covA = [[400, 0], [0, 100]];
  const e = estadisticasCartera([0.5, 0.5], medias, covA, 2);
  cerca(e.retorno, 8);
  cerca(e.vol, Math.sqrt(0.25 * 400 + 0.25 * 100));
  /* Mínima varianza analítica sin correlación: w1 = σ2² / (σ1² + σ2²) = 0,2 */
  const s = simularCarteras(medias, covA, 2, 6000);
  cerca(s.minVar.pesos[0], 0.2, 0.03);
  assert.ok(s.maxSharpe.sharpe >= e.sharpe);
});

test("Bonos: medidas, precio desde TIR y 30/360", () => {
  const flujos = [{ fecha: "2027-01-01", total: 5 }, { fecha: "2028-01-01", total: 105 }];
  const m = medidasBono(flujos, 100, "2026-01-01");
  cerca(m.tir, 5, 1e-3);
  cerca(precioDesdeTir(flujos, m.tir, "2026-01-01"), 100, 1e-6);
  assert.ok(m.md < m.duration && m.duration < 2);
  assert.equal(dias30360("2026-01-09", "2026-07-09"), 180);
  assert.equal(liquidacion("2026-11-06"), "2026-11-09", "viernes liquida el lunes");
});

test("Cronogramas de los soberanos: amortizan 100 y el residual es coherente", () => {
  for (const t of Object.keys(BONOS)) {
    const c = cronograma(t);
    cerca(c.reduce((s, f) => s + f.amortizacion, 0), 100, 1e-9);
    assert.equal(c.at(-1).residual, 0);
    assert.ok(c.every((f) => f.fecha.endsWith("-01-09") || f.fecha.endsWith("-07-09")));
  }
  /* GD30: 4% en julio 2024 y 8% por semestre desde enero 2025. */
  assert.equal(valorTecnico("GD30", "2026-11-04").vr, 64);
  assert.equal(valorTecnico("GD35", "2026-11-04").tasa, 4.125);
  assert.equal(valorTecnico("GD38", "2026-11-04").vr, 100);
  /* Mismo cronograma por ley local y Nueva York. */
  assert.deepEqual(cronograma("AL30").map((f) => f.total), cronograma("GD30").map((f) => f.total));
  const a = analizar("GD30", 62, "2026-11-04");
  assert.ok(a.tir > 0 && a.tir < 20 && a.paridad > 90 && a.paridad < 100);
  cerca(a.vt, a.vr + a.ic);
});
