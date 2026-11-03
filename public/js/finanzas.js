/* Fórmulas financieras puras, sin dependencias ni DOM. Las usan las
   calculadoras del navegador y el servidor (bonos, APT y carteras), así el
   resultado es el mismo en los dos lados. Tienen tests en
   test/finanzas.test.mjs.

   Convenciones: tasas en porcentaje (5 = 5%), fechas en ISO (AAAA-MM-DD). */

const finito = (x) => typeof x === "number" && Number.isFinite(x);
const DIA = 864e5;
export const diasEntre = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA;

/* ------------------------------------------------------- costo de capital */

/* CAPM: costo del capital propio. Para Argentina se suele sumar el riesgo
   país (en puntos porcentuales) como prima adicional. */
export function capm({ rf, beta, primaMercado, riesgoPais = 0 }) {
  if (![rf, beta, primaMercado].every(finito)) return null;
  return rf + beta * primaMercado + (finito(riesgoPais) ? riesgoPais : 0);
}

/* WACC: costo promedio ponderado del capital, con el escudo fiscal de la deuda. */
export function wacc({ E, D, ke, kd, t = 0 }) {
  if (![E, D, ke, kd].every(finito) || E < 0 || D < 0 || E + D <= 0) return null;
  const V = E + D;
  const kdNeto = kd * (1 - t / 100);
  return { wacc: (E / V) * ke + (D / V) * kdNeto, pesoE: (E / V) * 100, pesoD: (D / V) * 100, kdNeto };
}

/* APT: retorno esperado = tasa libre de riesgo + suma de beta × prima de cada factor. */
export function apt({ rf, betas, primas }) {
  if (!finito(rf) || betas.length !== primas.length) return null;
  return betas.reduce((s, b, i) => s + b * primas[i], rf);
}

/* --------------------------------------------------------- VAN y TIR */

/* VAN con flujos periódicos: el primero es el período 0 (sin descontar). */
export function van(tasa, flujos) {
  const r = tasa / 100;
  return flujos.reduce((s, f, i) => s + f / (1 + r) ** i, 0);
}

/* Raíz por bisección en [a, b]; f debe cambiar de signo. Es lenta pero no
   diverge, que importa más que la velocidad para flujos irregulares. */
function biseccion(f, a, b, tol = 1e-10, max = 300) {
  let fa = f(a), fb = f(b);
  if (!finito(fa) || !finito(fb) || fa * fb > 0) return null;
  for (let i = 0; i < max; i++) {
    const m = (a + b) / 2, fm = f(m);
    if (Math.abs(fm) < tol || (b - a) / 2 < tol) return m;
    if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

/* Busca un intervalo con cambio de signo y lo resuelve. Devuelve la TIR en %
   o null si los flujos no tienen una (por ejemplo, todos del mismo signo). */
function resolverTasa(fn) {
  const puntos = [-0.9999, -0.9, -0.5, -0.2, 0, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 50];
  for (let i = 0; i < puntos.length - 1; i++) {
    const r = biseccion(fn, puntos[i], puntos[i + 1]);
    if (r !== null) return r * 100;
  }
  return null;
}

export function tir(flujos) {
  if (!flujos.some((f) => f > 0) || !flujos.some((f) => f < 0)) return null;
  return resolverTasa((r) => flujos.reduce((s, f, i) => s + f / (1 + r) ** i, 0));
}

/* Con fechas (como XVAN y XTIR de Excel): tasa efectiva anual, base 365. */
export function xvan(tasa, flujos, fecha0 = flujos[0]?.fecha) {
  const r = tasa / 100;
  return flujos.reduce((s, f) => s + f.monto / (1 + r) ** (diasEntre(fecha0, f.fecha) / 365), 0);
}

export function xtir(flujos, fecha0 = flujos[0]?.fecha) {
  if (!flujos.some((f) => f.monto > 0) || !flujos.some((f) => f.monto < 0)) return null;
  return resolverTasa((r) => flujos.reduce((s, f) => s + f.monto / (1 + r) ** (diasEntre(fecha0, f.fecha) / 365), 0));
}

/* Período de recupero: en qué período el acumulado deja de ser negativo,
   interpolando dentro del período. */
export function recupero(flujos) {
  let acum = 0;
  for (let i = 0; i < flujos.length; i++) {
    const antes = acum;
    acum += flujos[i];
    if (i > 0 && antes < 0 && acum >= 0) return i - 1 + -antes / flujos[i];
  }
  return null;
}

/* ---------------------------------------------------------------- DCF */

/* Flujo de caja descontado. crecimientos: un % por año proyectado. El valor
   terminal usa Gordon (crecimiento perpetuo), que exige WACC > g. */
export function dcf({ fcf0, crecimientos, gTerminal, wacc: w, deudaNeta = 0, acciones }) {
  if (!finito(fcf0) || !finito(gTerminal) || !finito(w) || !crecimientos.length) return null;
  if (w <= gTerminal) return { error: "El WACC tiene que ser mayor que el crecimiento perpetuo." };
  const r = w / 100;
  let fcf = fcf0;
  const proyeccion = crecimientos.map((g, i) => {
    fcf *= 1 + g / 100;
    const factor = 1 / (1 + r) ** (i + 1);
    return { anio: i + 1, crecimiento: g, fcf, factor, pv: fcf * factor };
  });
  const n = proyeccion.length;
  const terminal = (proyeccion[n - 1].fcf * (1 + gTerminal / 100)) / (r - gTerminal / 100);
  const pvTerminal = terminal / (1 + r) ** n;
  const sumaPv = proyeccion.reduce((s, p) => s + p.pv, 0);
  const ev = sumaPv + pvTerminal;
  const equity = ev - (finito(deudaNeta) ? deudaNeta : 0);
  return {
    proyeccion, terminal, pvTerminal, sumaPv, ev, equity,
    porAccion: finito(acciones) && acciones > 0 ? equity / acciones : null,
    pesoTerminal: ev ? (pvTerminal / ev) * 100 : null
  };
}

/* Matriz de valor por acción para combinaciones de WACC y crecimiento perpetuo. */
export function sensibilidadDcf(base, waccs, gs) {
  return waccs.map((w) => gs.map((g) => {
    const d = dcf({ ...base, wacc: w, gTerminal: g });
    return d && !d.error ? d.porAccion : null;
  }));
}

/* ------------------------------------------------------- regresión (APT) */

/* Mínimos cuadrados con intercepto. X: una fila por observación, una columna
   por factor. Devuelve alfa, betas, sus estadísticos t y el R². */
export function regresion(y, X) {
  const n = y.length, k = X[0]?.length || 0, p = k + 1;
  if (n <= p) return null;
  const A = X.map((fila) => [1, ...fila]);
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => A.reduce((s, f) => s + f[i] * f[j], 0)));
  const Xty = Array.from({ length: p }, (_, i) => A.reduce((s, f, t) => s + f[i] * y[t], 0));
  const inv = invertir(XtX);
  if (!inv) return null;
  const coef = inv.map((fila) => fila.reduce((s, v, j) => s + v * Xty[j], 0));
  const ajuste = A.map((f) => f.reduce((s, v, j) => s + v * coef[j], 0));
  const media = y.reduce((s, v) => s + v, 0) / n;
  const ssRes = y.reduce((s, v, t) => s + (v - ajuste[t]) ** 2, 0);
  const ssTot = y.reduce((s, v) => s + (v - media) ** 2, 0);
  const sigma2 = ssRes / (n - p);
  const t = coef.map((c, i) => (inv[i][i] > 0 ? c / Math.sqrt(sigma2 * inv[i][i]) : null));
  return { alfa: coef[0], betas: coef.slice(1), tAlfa: t[0], tBetas: t.slice(1), r2: ssTot ? 1 - ssRes / ssTot : null, n };
}

/* Inversa por Gauss-Jordan con pivoteo parcial. */
export function invertir(M) {
  const n = M.length;
  const A = M.map((fila, i) => [...fila, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let f = c + 1; f < n; f++) if (Math.abs(A[f][c]) > Math.abs(A[piv][c])) piv = f;
    if (Math.abs(A[piv][c]) < 1e-14) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c];
    for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
    for (let f = 0; f < n; f++) {
      if (f === c) continue;
      const m = A[f][c];
      if (m) for (let j = 0; j < 2 * n; j++) A[f][j] -= m * A[c][j];
    }
  }
  return A.map((fila) => fila.slice(n));
}

/* ------------------------------------------------------------ carteras */

export function covarianza(series) {
  const n = series[0].length, k = series.length;
  const medias = series.map((s) => s.reduce((a, b) => a + b, 0) / n);
  return Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => {
    let s = 0;
    for (let t = 0; t < n; t++) s += (series[i][t] - medias[i]) * (series[j][t] - medias[j]);
    return s / (n - 1);
  }));
}

export function correlacion(cov) {
  return cov.map((fila, i) => fila.map((v, j) => v / Math.sqrt(cov[i][i] * cov[j][j] || 1e-18)));
}

/* Retorno, volatilidad y Sharpe de una cartera (todo anualizado, en %). */
export function estadisticasCartera(pesos, medias, cov, rf = 0) {
  const ret = pesos.reduce((s, w, i) => s + w * medias[i], 0);
  let v = 0;
  for (let i = 0; i < pesos.length; i++) for (let j = 0; j < pesos.length; j++) v += pesos[i] * pesos[j] * cov[i][j];
  const vol = Math.sqrt(Math.max(0, v));
  return { retorno: ret, vol, sharpe: vol ? (ret - rf) / vol : null };
}

/* Generador pseudoaleatorio con semilla: el mismo pedido da el mismo resultado. */
export function azar(semilla = 42) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Simulación de Montecarlo de carteras sin ventas en corto: pesos al azar
   (distribución de Dirichlet), y de ahí la de mínima varianza y la de máximo
   Sharpe. No es una optimización exacta, pero con miles de carteras queda muy
   cerca y se entiende sin álgebra. */
export function simularCarteras(medias, cov, rf = 0, n = 4000, semilla = 7) {
  const k = medias.length, r = azar(semilla);
  const puntos = [];
  let minVar = null, maxSharpe = null;
  for (let s = 0; s < n; s++) {
    let pesos;
    if (s < k) pesos = medias.map((_, i) => (i === s ? 1 : 0));
    else {
      const e = medias.map(() => -Math.log(1 - r()));
      const suma = e.reduce((a, b) => a + b, 0);
      pesos = e.map((x) => x / suma);
    }
    const st = estadisticasCartera(pesos, medias, cov, rf);
    const p = { ...st, pesos };
    puntos.push(p);
    if (!minVar || st.vol < minVar.vol) minVar = p;
    if (st.sharpe !== null && (!maxSharpe || st.sharpe > maxSharpe.sharpe)) maxSharpe = p;
  }
  return { puntos, minVar, maxSharpe };
}

/* --------------------------------------------------------------- bonos */

/* Medidas de un bono a partir de sus flujos futuros y su precio (sucio, por
   cada 100 de valor nominal). TIR efectiva anual, base actual/365, como se
   publica en el mercado local. */
export function medidasBono(flujos, precio, fechaLiq) {
  const futuros = flujos.filter((f) => f.fecha > fechaLiq && f.total > 0);
  if (!futuros.length || !(precio > 0)) return null;
  const t = futuros.map((f) => diasEntre(fechaLiq, f.fecha) / 365);
  const vp = (r) => futuros.reduce((s, f, i) => s + f.total / (1 + r) ** t[i], 0);
  const r = biseccion((x) => vp(x) - precio, -0.95, 20);
  if (r === null) return null;
  const pv = futuros.map((f, i) => f.total / (1 + r) ** t[i]);
  const P = pv.reduce((a, b) => a + b, 0);
  const duration = pv.reduce((s, v, i) => s + t[i] * v, 0) / P;
  const md = duration / (1 + r);
  const convexidad = pv.reduce((s, v, i) => s + t[i] * (t[i] + 1) * v, 0) / (P * (1 + r) ** 2);
  return { tir: r * 100, duration, md, convexidad, pvbp: md * precio * 0.0001, vida: t.at(-1) };
}

export function precioDesdeTir(flujos, tirPct, fechaLiq) {
  const r = tirPct / 100;
  return flujos.filter((f) => f.fecha > fechaLiq).reduce((s, f) => s + f.total / (1 + r) ** (diasEntre(fechaLiq, f.fecha) / 365), 0);
}

/* Días entre fechas en base 30/360 (convención de los bonos soberanos). */
export function dias30360(a, b) {
  const [y1, m1, d1x] = a.split("-").map(Number), [y2, m2, d2x] = b.split("-").map(Number);
  const d1 = Math.min(d1x, 30);
  const d2 = d2x === 31 && d1 >= 30 ? 30 : d2x;
  return 360 * (y2 - y1) + 30 * (m2 - m1) + (d2 - d1);
}

/* Fecha de liquidación T+1 hábil (no contempla feriados). */
export function liquidacion(hoy = new Date().toISOString().slice(0, 10), dias = 1) {
  const d = new Date(`${hoy}T12:00:00Z`);
  let n = 0;
  while (n < dias) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return d.toISOString().slice(0, 10);
}
