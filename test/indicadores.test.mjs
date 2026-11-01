import test from "node:test";
import assert from "node:assert/strict";
import { smaSerie, emaSerie, rsiSerie, macdSerie, bollingerSerie, stats, perfilRiesgo, lecturaTecnica, percentilDe } from "../lib/indicadores.mjs";

const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} no está cerca de ${b}`);

/* Serie de prueba: 300 ruedas hábiles con tendencia y ruido determinístico. */
function serie(n = 300, inicio = 100, tendencia = 0.001) {
  const rows = [];
  let p = inicio;
  const d = new Date("2024-01-01T00:00:00Z");
  for (let i = 0; i < n; i++) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    const o = p;
    p *= 1 + tendencia + 0.01 * Math.sin(i * 1.7);
    rows.push({ d: d.toISOString().slice(0, 10), o, h: Math.max(o, p) * 1.005, l: Math.min(o, p) * 0.995, c: p, v: 1000 + i });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return rows;
}

test("SMA y EMA", () => {
  const v = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(smaSerie(v, 3), [null, null, 2, 3, 4, 5]);
  const e = emaSerie(v, 3);
  assert.equal(e[1], null);
  cerca(e[2], 2);
  cerca(e[3], 3); // k = 0,5: 4·0,5 + 2·0,5
  cerca(e[5], 5);
});

test("RSI: 100 si solo sube, 0 si solo baja, ~50 alternando", () => {
  const sube = Array.from({ length: 30 }, (_, i) => 100 + i);
  const baja = Array.from({ length: 30 }, (_, i) => 100 - i);
  assert.equal(rsiSerie(sube).at(-1), 100);
  cerca(rsiSerie(baja).at(-1), 0);
  const alterna = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 1 : -1));
  cerca(rsiSerie(alterna).at(-1), 50, 6);
});

test("MACD y Bollinger tienen el largo de la serie", () => {
  const v = serie(120).map((r) => r.c);
  const m = macdSerie(v);
  assert.equal(m.linea.length, v.length);
  assert.equal(m.linea[24], null);
  assert.notEqual(m.linea[25], null);
  assert.notEqual(m.hist.at(-1), null);
  const b = bollingerSerie(v);
  assert.ok(b.up.at(-1) > b.mid.at(-1) && b.mid.at(-1) > b.lo.at(-1));
});

test("stats: retornos, medias, rango y cruce", () => {
  const rows = serie(300);
  const s = stats(rows);
  cerca(s.ret1, (rows.at(-1).c / rows.at(-2).c - 1) * 100);
  cerca(s.ret252, (rows.at(-1).c / rows.at(-253).c - 1) * 100);
  assert.ok(s.sma200 > 0 && s.vsSma200 !== null);
  assert.ok(s.high52 >= s.last && s.low52 <= s.last);
  assert.ok(s.posRango52 >= 0 && s.posRango52 <= 100);
  assert.ok(s.rsi14 > 0 && s.rsi14 < 100);
  assert.ok(s.retYtd !== null, "hay rendimiento en el año");
  assert.ok(Array.isArray(lecturaTecnica(s)));
});

test("stats tolera velas sin máximo ni mínimo", () => {
  const rows = serie(60).map((r) => ({ d: r.d, c: r.c, v: r.v }));
  const s = stats(rows);
  assert.ok(Number.isFinite(s.high52));
  assert.equal(s.atr14, null);
});

test("perfil de riesgo: beta 1 y correlación 1 contra sí mismo", () => {
  const rows = serie(300);
  const p = perfilRiesgo(rows, rows);
  cerca(p.beta, 1, 1e-9);
  cerca(p.correl, 1, 1e-9);
  cerca(p.volRelativa, 1, 1e-9);
  assert.ok(p.maxDrawdown <= 0);
  assert.ok(p.cvar95 <= p.var95, "el CVaR es peor o igual que el VaR");
  assert.equal(p.ventanas.length, 4);
  assert.ok(p.subagua.length > 10 && p.subagua.length <= 302);
});

test("perfil de riesgo: beta 2 con el doble de movimiento", () => {
  const bench = serie(300);
  const doble = [bench[0]];
  for (let i = 1; i < bench.length; i++) {
    const r = bench[i].c / bench[i - 1].c - 1;
    doble.push({ ...bench[i], c: doble[i - 1].c * (1 + 2 * r) });
  }
  const p = perfilRiesgo(doble, bench);
  cerca(p.beta, 2, 1e-6);
});

test("percentil", () => {
  assert.equal(percentilDe([1, 2, 3, 4], 3), 75);
  assert.equal(percentilDe([], 3), null);
});
