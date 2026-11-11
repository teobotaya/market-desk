/* Cálculos puros sobre series de precios. Sin red, sin estado: todo lo de
   acá tiene tests en test/indicadores.test.mjs. */

export const pct = (a, b) => (a !== null && a !== undefined && b ? (a / b - 1) * 100 : null);
const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const finito = (x) => typeof x === "number" && Number.isFinite(x);

/* ------------------------------------------------------- series técnicas */

export function smaSerie(v, n) {
  const out = new Array(v.length).fill(null);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function emaSerie(v, n) {
  const out = new Array(v.length).fill(null);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let e = media(v.slice(0, n));
  out[n - 1] = e;
  for (let i = n; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

/* RSI de Wilder: el suavizado es una media exponencial con alfa 1/n. */
export function rsiSerie(v, n = 14) {
  const out = new Array(v.length).fill(null);
  if (v.length <= n) return out;
  let g = 0, p = 0;
  for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; if (d > 0) g += d; else p -= d; }
  g /= n; p /= n;
  const valor = () => (p === 0 ? 100 : 100 - 100 / (1 + g / p));
  out[n] = valor();
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    p = (p * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = valor();
  }
  return out;
}

export function macdSerie(v, rapida = 12, lenta = 26, senalN = 9) {
  const ef = emaSerie(v, rapida), es = emaSerie(v, lenta);
  const linea = v.map((_, i) => (ef[i] !== null && es[i] !== null ? ef[i] - es[i] : null));
  const senal = new Array(v.length).fill(null);
  const primero = linea.findIndex((x) => x !== null);
  if (primero >= 0) emaSerie(linea.slice(primero), senalN).forEach((x, i) => { senal[primero + i] = x; });
  const hist = linea.map((x, i) => (x !== null && senal[i] !== null ? x - senal[i] : null));
  return { linea, senal, hist };
}

export function bollingerSerie(v, n = 20, k = 2) {
  const mid = smaSerie(v, n);
  const up = new Array(v.length).fill(null), lo = new Array(v.length).fill(null);
  for (let i = n - 1; i < v.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    up[i] = mid[i] + k * sd;
    lo[i] = mid[i] - k * sd;
  }
  return { mid, up, lo };
}

/* -------------------------------------------------- métricas del panel */

export function stats(rows) {
  const n = rows.length;
  const close = rows.map((r) => r.c);
  const last = close[n - 1];
  const at = (back) => (n > back ? close[n - 1 - back] : null);

  const logret = [];
  for (let i = 1; i < n; i++) logret.push(Math.log(close[i] / close[i - 1]));
  const vol = (win) => {
    const s = logret.slice(-win);
    if (s.length < 5) return null;
    const m = media(s);
    return Math.sqrt((s.reduce((a, b) => a + (b - m) ** 2, 0) / (s.length - 1)) * 252) * 100;
  };

  const sma = (win) => (n >= win ? media(close.slice(-win)) : null);

  const tr = [];
  for (let i = Math.max(1, n - 14); i < n; i++) {
    const r = rows[i], p = rows[i - 1];
    if (!finito(r.h) || !finito(r.l)) continue;
    tr.push(Math.max(r.h - r.l, Math.abs(r.h - p.c), Math.abs(r.l - p.c)));
  }
  const atr = tr.length ? media(tr) : null;

  /* El último año por fecha, no por cantidad de ruedas: cripto opera los 7
     días de la semana y 252 ruedas no llegan a un año. */
  const haceUnAnio = new Date(Date.parse(`${rows[n - 1].d}T00:00:00Z`) - 365 * 864e5).toISOString().slice(0, 10);
  const anio = rows.filter((r) => r.d >= haceUnAnio);
  const altos = anio.map((r) => (finito(r.h) ? r.h : r.c));
  const bajos = anio.map((r) => (finito(r.l) ? r.l : r.c));
  const hi = Math.max(...altos), lo = Math.min(...bajos);
  let peak = -Infinity, dd = 0;
  for (const r of anio) { peak = Math.max(peak, r.c); dd = Math.min(dd, r.c / peak - 1); }

  const vols = rows.slice(-21).map((r) => r.v).filter((x) => finito(x) && x > 0);
  const avgVol = vols.length ? media(vols) : null;

  /* Rendimiento a 12 meses: contra el cierre de hace un año (o el primero de
     la serie, si arranca hasta una semana después de esa fecha). */
  let base12m = null;
  for (const r of rows) { if (r.d <= haceUnAnio) base12m = r.c; else break; }
  if (base12m === null && rows[0].d <= new Date(Date.parse(`${haceUnAnio}T00:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10)) base12m = rows[0].c;

  /* Rendimiento en el año: contra el último cierre del año anterior. */
  const anioActual = rows[n - 1].d.slice(0, 4);
  const iAnio = rows.findIndex((r) => r.d.slice(0, 4) === anioActual);
  const baseYtd = iAnio > 0 ? close[iAnio - 1] : null;

  const rsi = rsiSerie(close).at(-1);
  const m = macdSerie(close);
  const bb = bollingerSerie(close);
  const bbUp = bb.up.at(-1), bbLo = bb.lo.at(-1);
  const s50 = smaSerie(close, 50), s200 = smaSerie(close, 200);

  /* Último cruce de la media de 50 sobre la de 200 ("cruce dorado") o
     por debajo ("cruce de la muerte"). */
  let cruce = null;
  for (let i = n - 1; i > 0; i--) {
    if (s200[i - 1] === null) break;
    const a = s50[i] - s200[i], b = s50[i - 1] - s200[i - 1];
    if ((a > 0) !== (b > 0)) { cruce = { tipo: a > 0 ? "dorado" : "muerte", fecha: rows[i].d, ruedas: n - 1 - i }; break; }
  }

  return {
    last, date: rows[n - 1].d,
    cambio1: at(1) !== null ? last - at(1) : null,
    ret1: pct(last, at(1)), ret5: pct(last, at(5)), ret21: pct(last, at(21)),
    ret63: pct(last, at(63)), ret126: pct(last, at(126)), ret252: pct(last, base12m),
    retYtd: pct(last, baseYtd),
    vol21: vol(21), vol63: vol(63), vol252: vol(252),
    sma20: sma(20), sma50: sma(50), sma200: sma(200),
    vsSma20: pct(last, sma(20)), vsSma50: pct(last, sma(50)), vsSma200: pct(last, sma(200)),
    cruce,
    rsi14: rsi,
    macd: m.linea.at(-1), macdSenal: m.senal.at(-1), macdHist: m.hist.at(-1),
    bbSup: bbUp, bbInf: bbLo,
    bbPctB: bbUp !== null && bbUp !== bbLo ? (last - bbLo) / (bbUp - bbLo) : null,
    bbAncho: bbUp !== null && bb.mid.at(-1) ? ((bbUp - bbLo) / bb.mid.at(-1)) * 100 : null,
    atr14: atr, atrPct: atr ? (atr / last) * 100 : null,
    high52: hi, low52: lo,
    fromHigh: pct(last, hi), fromLow: pct(last, lo),
    posRango52: hi !== lo ? ((last - lo) / (hi - lo)) * 100 : null,
    maxDrawdown: dd * 100,
    avgVol21: avgVol,
    relVol: avgVol && finito(rows[n - 1].v) ? rows[n - 1].v / avgVol : null
  };
}

/* Lectura en lenguaje llano de los indicadores. Describe, no aconseja: cada
   frase dice qué muestra el número y qué no garantiza. */
export function lecturaTecnica(s) {
  const out = [];
  const f = (x, d = 1) => Number(x).toFixed(d).replace(".", ",");
  if (s.vsSma200 !== null) {
    out.push(s.vsSma200 > 0
      ? { tono: "up", texto: `Cotiza ${f(s.vsSma200)}% por encima de su media de 200 ruedas: la tendencia de largo plazo es alcista.` }
      : { tono: "down", texto: `Cotiza ${f(Math.abs(s.vsSma200))}% por debajo de su media de 200 ruedas: la tendencia de largo plazo es bajista.` });
  }
  if (s.cruce) {
    out.push({
      tono: s.cruce.tipo === "dorado" ? "up" : "down",
      texto: `Último cruce de medias 50/200: ${s.cruce.tipo === "dorado" ? "dorado (la de 50 pasó por encima)" : "de la muerte (la de 50 pasó por debajo)"} el ${s.cruce.fecha}, hace ${s.cruce.ruedas} ruedas.`
    });
  }
  if (s.rsi14 !== null && s.rsi14 !== undefined) {
    if (s.rsi14 >= 70) out.push({ tono: "warn", texto: `RSI(14) en ${f(s.rsi14, 0)}: zona de sobrecompra. Suele indicar un movimiento estirado, no un techo seguro.` });
    else if (s.rsi14 <= 30) out.push({ tono: "warn", texto: `RSI(14) en ${f(s.rsi14, 0)}: zona de sobreventa. Suele indicar un movimiento estirado, no un piso seguro.` });
    else out.push({ tono: "", texto: `RSI(14) en ${f(s.rsi14, 0)}: zona neutral (entre 30 y 70).` });
  }
  if (s.macdHist !== null && s.macdHist !== undefined) {
    out.push(s.macdHist > 0
      ? { tono: "up", texto: "MACD por encima de su señal: el impulso de corto plazo es positivo." }
      : { tono: "down", texto: "MACD por debajo de su señal: el impulso de corto plazo es negativo." });
  }
  if (s.bbPctB !== null) {
    if (s.bbPctB > 1) out.push({ tono: "warn", texto: "Cerró por encima de la banda de Bollinger superior: movimiento fuera de lo habitual de las últimas 20 ruedas." });
    else if (s.bbPctB < 0) out.push({ tono: "warn", texto: "Cerró por debajo de la banda de Bollinger inferior: movimiento fuera de lo habitual de las últimas 20 ruedas." });
  }
  if (s.relVol !== null && s.relVol > 1.8) out.push({ tono: "warn", texto: `Volumen de la última rueda ${f(s.relVol)} veces el promedio de 21 ruedas: hay más participación que lo normal.` });
  if (s.fromHigh !== null && s.fromHigh > -3) out.push({ tono: "up", texto: "Está a menos de 3% de su máximo de 52 semanas." });
  if (s.fromLow !== null && s.fromLow < 3) out.push({ tono: "down", texto: "Está a menos de 3% de su mínimo de 52 semanas." });
  return out;
}

/* ------------------------------------------------------- perfil de riesgo */

export function perfilRiesgo(rows, bench) {
  const c = rows.map((r) => r.c);
  const ret = [];
  for (let i = 1; i < c.length; i++) ret.push(c[i] / c[i - 1] - 1);

  const orden = [...ret].sort((a, b) => a - b);
  const percentil = (p) => orden[Math.max(0, Math.floor(orden.length * p))] * 100;
  const colaMedia = (p) => {
    const k = Math.max(1, Math.floor(orden.length * p));
    return media(orden.slice(0, k)) * 100;
  };

  const anual = (arr) => {
    const m = media(arr);
    return Math.sqrt((arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)) * 252) * 100;
  };
  const bajistas = ret.filter((x) => x < 0);

  const ventana = (n) => {
    let peor = 0;
    for (let i = n; i < c.length; i++) peor = Math.min(peor, c[i] / c[i - n] - 1);
    return peor * 100;
  };

  let peak = -Infinity, dd = 0, iPeak = 0, iPeakDd = 0, iFondo = 0, recuperado = null;
  const subagua = [];
  rows.forEach((r, i) => {
    if (r.c > peak) { peak = r.c; iPeak = i; }
    const d = r.c / peak - 1;
    subagua.push({ d: r.d, v: d * 100 });
    if (d < dd) { dd = d; iFondo = i; iPeakDd = iPeak; }
  });
  for (let i = iFondo; i < rows.length; i++) if (rows[i].c >= rows[iPeakDd].c) { recuperado = i - iFondo; break; }

  let beta = null, correl = null, volBench = null, retBench = null;
  if (bench?.length) {
    const mapa = new Map(bench.map((r) => [r.d, r.c]));
    const pares = [];
    for (let i = 1; i < rows.length; i++) {
      const b1 = mapa.get(rows[i].d), b0 = mapa.get(rows[i - 1].d);
      if (b1 && b0) pares.push([rows[i].c / rows[i - 1].c - 1, b1 / b0 - 1]);
    }
    if (pares.length > 60) {
      const n = pares.length;
      const ma = pares.reduce((a, p) => a + p[0], 0) / n;
      const mb = pares.reduce((a, p) => a + p[1], 0) / n;
      let cov = 0, va = 0, vb = 0;
      for (const [a, b] of pares) { cov += (a - ma) * (b - mb); va += (a - ma) ** 2; vb += (b - mb) ** 2; }
      beta = cov / (vb || 1e-12);
      correl = cov / (Math.sqrt(va * vb) || 1e-12);
      volBench = anual(pares.map((p) => p[1]));
      const b0 = mapa.get(rows[0].d), bN = mapa.get(rows[rows.length - 1].d);
      if (b0 && bN) retBench = (bN / b0 - 1) * 100;
    }
  }

  const big = (u) => (ret.filter((x) => Math.abs(x) > u).length / ret.length) * 100;

  /* Frecuencia histórica por ventana de tenencia. NO es probabilidad futura:
     es con qué frecuencia, en este período, mantener N ruedas terminó en verde. */
  const ventanas = [5, 10, 21, 63].map((n) => {
    const res = [];
    for (let i = n; i < c.length; i++) res.push((c[i] / c[i - n] - 1) * 100);
    if (res.length < 20) return { dias: n, muestras: res.length };
    const ord = [...res].sort((a, b) => a - b);
    const pc = (p) => ord[Math.floor(ord.length * p)];
    const ganan = res.filter((x) => x > 0);
    const pierden = res.filter((x) => x <= 0);
    const pGana = (ganan.length / res.length) * 100;
    const mediaGana = ganan.length ? media(ganan) : 0;
    const mediaPierde = pierden.length ? media(pierden) : 0;
    return {
      dias: n, muestras: res.length, pctPositivas: pGana,
      mediana: pc(0.5), media: media(res), p10: pc(0.1), p90: pc(0.9),
      peor: ord[0], mejor: ord[ord.length - 1], mediaGana, mediaPierde,
      expectativa: (pGana / 100) * mediaGana + (1 - pGana / 100) * mediaPierde,
      asimetria: mediaPierde ? Math.abs(mediaGana / mediaPierde) : null
    };
  });

  const anios = ret.length / 252;
  const total = c[c.length - 1] / c[0] - 1;
  const cagr = anios > 0.5 ? ((1 + total) ** (1 / anios) - 1) * 100 : null;
  const mediaDiaria = media(ret);
  const volA = anual(ret);
  const desvBaj = bajistas.length > 5 ? Math.sqrt(bajistas.reduce((a, b) => a + b * b, 0) / ret.length * 252) * 100 : null;

  /* Volatilidad móvil de 63 ruedas, muestreada para el gráfico. */
  const volMovil = [];
  for (let i = 63; i < ret.length; i += Math.max(1, Math.floor(ret.length / 200))) {
    volMovil.push({ d: rows[i + 1].d, v: anual(ret.slice(i - 63, i)) });
  }

  const paso = Math.max(1, Math.floor(subagua.length / 300));
  return {
    ventanas,
    ruedas: ret.length,
    retornoTotal: total * 100,
    retornoBench: retBench,
    cagr,
    volAnual: volA,
    volBench,
    volRelativa: volBench ? volA / volBench : null,
    desvBajista: desvBaj,
    sharpe: volA ? (mediaDiaria * 252 * 100) / volA : null,
    sortino: desvBaj ? (mediaDiaria * 252 * 100) / desvBaj : null,
    calmar: dd < 0 && cagr !== null ? cagr / Math.abs(dd * 100) : null,
    var95: percentil(0.05),
    var99: percentil(0.01),
    cvar95: colaMedia(0.05),
    peorDia: orden[0] * 100,
    mejorDia: orden[orden.length - 1] * 100,
    peorSemana: ventana(5),
    peorMes: ventana(21),
    diasMas3: big(0.03),
    diasMas5: big(0.05),
    maxDrawdown: dd * 100,
    ddPico: rows[iPeakDd]?.d, ddFondo: rows[iFondo]?.d,
    ruedasHastaRecuperar: recuperado,
    beta,
    correl,
    subagua: subagua.filter((_, i) => i % paso === 0 || i === subagua.length - 1),
    volMovil
  };
}

/* Percentil (0-100) de x dentro de una muestra. */
export function percentilDe(muestra, x) {
  const v = muestra.filter(finito);
  if (!v.length || !finito(x)) return null;
  return (v.filter((y) => y <= x).length / v.length) * 100;
}
