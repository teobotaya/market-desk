/* Gráficos en SVG, sin librerías. Todos se redibujan al cambiar el ancho del
   contenedor y muestran un cursor con el detalle del punto más cercano. */

import { num, precio, fecha, esc, grande, pctS } from "./util.js";

const NS = "http://www.w3.org/2000/svg";

function observar(el, dibujar) {
  dibujar();
  if (el._ro) el._ro.disconnect();
  let ancho = el.clientWidth;
  el._ro = new ResizeObserver(() => {
    if (Math.abs(el.clientWidth - ancho) > 4) { ancho = el.clientWidth; dibujar(); }
  });
  el._ro.observe(el);
}

/* Marcas "lindas" para un eje: 1, 2, 2,5 o 5 por potencia de diez. */
function marcas(min, max, n = 4) {
  const rango = max - min || Math.abs(max) || 1;
  const bruto = rango / n;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((k) => k >= bruto) || bruto;
  const out = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max + paso * 1e-9; v += paso) out.push(Math.round(v / paso) * paso);
  return out;
}

const fechaCorta = (d) => {
  const [y, m, dd] = String(d).split("-");
  return dd ? `${dd}/${m}/${y.slice(2)}` : d;
};

function contenedor(el, alto) {
  el.classList.add("chart");
  el.innerHTML = `<svg xmlns="${NS}" width="100%" height="${alto}" role="img"></svg><div class="tip" hidden></div>`;
  return { svg: el.querySelector("svg"), tip: el.querySelector(".tip") };
}

function ubicarTip(el, tip, x, y) {
  const w = tip.offsetWidth, W = el.clientWidth;
  tip.style.left = `${Math.min(Math.max(4, x + 14), W - w - 4)}px`;
  tip.style.top = `${Math.max(4, y - 10)}px`;
}

/* ------------------------------------------------------------ precio */

function sma(v, n) {
  const out = new Array(v.length).fill(null);
  let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
function bollinger(v, n = 20, k = 2) {
  const m = sma(v, n), up = [], lo = [];
  for (let i = 0; i < v.length; i++) {
    if (m[i] === null) { up.push(null); lo.push(null); continue; }
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - m[i]) ** 2;
    const sd = Math.sqrt(s / n);
    up.push(m[i] + k * sd); lo.push(m[i] - k * sd);
  }
  return { up, lo };
}
function rsi(v, n = 14) {
  const out = new Array(v.length).fill(null);
  if (v.length <= n) return out;
  let g = 0, p = 0;
  for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; if (d > 0) g += d; else p -= d; }
  g /= n; p /= n;
  out[n] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; p = (p * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
  }
  return out;
}

const COLORES_SMA = { 20: "var(--c3)", 50: "var(--c2)", 200: "var(--c4)" };

/* candles: serie completa (para que las medias largas existan desde el
   primer punto visible); ruedas: cuántas mostrar. */
export function graficoPrecio(el, candles, o = {}) {
  const ruedas = Math.min(o.ruedas || 180, candles.length);
  observar(el, () => {
    const cierres = candles.map((c) => c.c);
    const ini = candles.length - ruedas;
    const vis = candles.slice(ini);
    const medias = (o.sma || []).map((n) => ({ n, v: sma(cierres, n).slice(ini) }));
    const bb = o.bb ? (() => { const b = bollinger(cierres); return { up: b.up.slice(ini), lo: b.lo.slice(ini) }; })() : null;
    const rsiV = o.rsi ? rsi(cierres).slice(ini) : null;
    const hayVol = o.volumen !== false && vis.some((c) => c.v > 0);

    /* Comparación: las dos series en % desde el primer punto visible. */
    let comp = null;
    if (o.comparar?.candles?.length) {
      const mapa = new Map(o.comparar.candles.map((c) => [c.d, c.c]));
      let base = null;
      comp = vis.map((c) => {
        const v = mapa.get(c.d);
        if (v && base === null) base = v;
        return v && base ? (v / base - 1) * 100 : null;
      });
    }
    const modoPct = Boolean(comp);
    const base0 = vis[0].c;
    const yVal = (v) => (modoPct ? (v / base0 - 1) * 100 : v);

    const W = Math.max(300, el.clientWidth);
    const hMain = o.alto || 300, hVol = hayVol ? 64 : 0, hRsi = rsiV ? 78 : 0, gap = 10;
    const H = hMain + (hVol ? hVol + gap : 0) + (hRsi ? hRsi + gap : 0) + 22;
    const m = { l: 8, r: 64, t: 8 };
    const pw = W - m.l - m.r;
    const { svg, tip } = contenedor(el, H);

    const valores = [];
    vis.forEach((c, i) => {
      if (o.tipo === "velas" && !modoPct) { valores.push(c.h ?? c.c, c.l ?? c.c); } else valores.push(yVal(c.c));
      for (const s of medias) if (s.v[i] !== null) valores.push(yVal(s.v[i]));
      if (bb && bb.up[i] !== null) valores.push(yVal(bb.up[i]), yVal(bb.lo[i]));
      if (comp && comp[i] !== null) valores.push(comp[i]);
    });
    let y0 = Math.min(...valores), y1 = Math.max(...valores);
    const pad = (y1 - y0) * 0.06 || Math.abs(y1) * 0.02 || 1;
    y0 -= pad; y1 += pad;
    const sx = (i) => m.l + (ruedas === 1 ? pw / 2 : (i / (ruedas - 1)) * pw);
    const sy = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (hMain - m.t);
    const fmtY = modoPct ? (v) => `${num(v, Math.abs(y1 - y0) < 10 ? 1 : 0)}%` : (v) => (Math.abs(v) >= 1000 ? num(v, 0) : precio(v));

    const partes = [];
    for (const t of marcas(y0, y1, 5)) {
      const yy = sy(t);
      if (yy < m.t - 1 || yy > hMain) continue;
      partes.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" class="grid"/><text x="${W - m.r + 6}" y="${yy + 3.5}" class="eje">${esc(fmtY(t))}</text>`);
    }
    if (modoPct && y0 < 0 && y1 > 0) partes.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" class="cero"/>`);

    const linea = (arr, f = (x) => x) => {
      let d = "", abierto = false;
      arr.forEach((v, i) => {
        if (v === null || v === undefined) { abierto = false; return; }
        d += `${abierto ? "L" : "M"}${sx(i).toFixed(1)},${sy(f(v)).toFixed(1)}`;
        abierto = true;
      });
      return d;
    };

    if (bb) {
      const area = `${linea(bb.up, yVal)}${bb.lo.map((v, i) => [v, i]).reverse().filter(([v]) => v !== null).map(([v, i]) => `L${sx(i).toFixed(1)},${sy(yVal(v)).toFixed(1)}`).join("")}Z`;
      partes.push(`<path d="${area}" style="fill:var(--accent);opacity:.08"/><path d="${linea(bb.up, yVal)}" class="bb"/><path d="${linea(bb.lo, yVal)}" class="bb"/>`);
    }

    const sube = vis.at(-1).c >= vis[0].c;
    const color = sube ? "var(--up)" : "var(--down)";
    if (o.tipo === "velas" && !modoPct) {
      const ancho = Math.max(1, Math.min(9, (pw / ruedas) * 0.68));
      vis.forEach((c, i) => {
        const x = sx(i), arriba = c.c >= (c.o ?? c.c);
        const col = arriba ? "var(--up)" : "var(--down)";
        const yo = sy(c.o ?? c.c), yc = sy(c.c);
        partes.push(`<line x1="${x}" x2="${x}" y1="${sy(c.h ?? c.c)}" y2="${sy(c.l ?? c.c)}" style="stroke:${col}"/>` +
          `<rect x="${x - ancho / 2}" y="${Math.min(yo, yc)}" width="${ancho}" height="${Math.max(1, Math.abs(yc - yo))}" style="fill:${col}"/>`);
      });
    } else {
      const d = linea(vis.map((c) => c.c), yVal);
      partes.push(`<defs><linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:${color};stop-opacity:.22"/><stop offset="100%" style="stop-color:${color};stop-opacity:0"/></linearGradient></defs>`);
      partes.push(`<path d="${d}L${sx(ruedas - 1)},${hMain}L${sx(0)},${hMain}Z" style="fill:url(#gp)"/><path d="${d}" style="fill:none;stroke:${modoPct ? "var(--accent)" : color};stroke-width:1.8"/>`);
    }
    for (const s of medias) partes.push(`<path d="${linea(s.v, yVal)}" style="fill:none;stroke:${COLORES_SMA[s.n] || "var(--c5)"};stroke-width:1.2"/>`);
    if (comp) partes.push(`<path d="${linea(comp)}" style="fill:none;stroke:var(--c5);stroke-width:1.6;stroke-dasharray:5 3"/>`);

    /* Último precio marcado sobre el eje. */
    const ultimoY = sy(yVal(vis.at(-1).c));
    partes.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${ultimoY}" y2="${ultimoY}" class="ultimo"/><rect x="${W - m.r + 2}" y="${ultimoY - 8}" width="${m.r - 4}" height="16" rx="3" style="fill:${modoPct ? "var(--accent)" : color}"/><text x="${W - m.r + 6}" y="${ultimoY + 4}" class="eje-ult">${esc(fmtY(yVal(vis.at(-1).c)))}</text>`);

    let y = hMain + gap;
    if (hVol) {
      const vmax = Math.max(...vis.map((c) => c.v || 0)) || 1;
      const ancho = Math.max(1, (pw / ruedas) * 0.7);
      vis.forEach((c, i) => {
        const hh = ((c.v || 0) / vmax) * hVol;
        partes.push(`<rect x="${sx(i) - ancho / 2}" y="${y + hVol - hh}" width="${ancho}" height="${hh}" style="fill:${c.c >= (vis[i - 1]?.c ?? c.c) ? "var(--up)" : "var(--down)"};opacity:.45"/>`);
      });
      partes.push(`<text x="${W - m.r + 6}" y="${y + 10}" class="eje">vol.</text>`);
      y += hVol + gap;
    }
    let syR = null;
    if (hRsi) {
      const yR = y;
      syR = (v) => yR + (1 - v / 100) * hRsi;
      partes.push(`<rect x="${m.l}" y="${syR(70)}" width="${pw}" height="${syR(30) - syR(70)}" style="fill:var(--accent);opacity:.07"/>`);
      for (const t of [30, 50, 70]) partes.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${syR(t)}" y2="${syR(t)}" class="grid"/><text x="${W - m.r + 6}" y="${syR(t) + 3.5}" class="eje">${t}</text>`);
      let d = "", ab = false;
      rsiV.forEach((v, i) => { if (v === null) { ab = false; return; } d += `${ab ? "L" : "M"}${sx(i).toFixed(1)},${syR(v).toFixed(1)}`; ab = true; });
      partes.push(`<path d="${d}" style="fill:none;stroke:var(--c5);stroke-width:1.3"/><text x="${m.l + 4}" y="${yR + 11}" class="eje">RSI 14</text>`);
      y += hRsi + gap;
    }
    const n3 = [0, Math.floor(ruedas / 2), ruedas - 1];
    n3.forEach((i, k) => partes.push(`<text x="${sx(i)}" y="${H - 6}" class="eje" text-anchor="${["start", "middle", "end"][k]}">${esc(fechaCorta(vis[i].d))}</text>`));
    partes.push(`<line class="cursor" x1="0" x2="0" y1="${m.t}" y2="${H - 20}" visibility="hidden"/><rect class="capa" x="${m.l}" y="0" width="${pw}" height="${H - 18}" style="fill:transparent"/>`);
    svg.innerHTML = partes.join("");

    const cursor = svg.querySelector(".cursor");
    svg.querySelector(".capa").addEventListener("mousemove", (ev) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(ruedas - 1, Math.round(((ev.clientX - r.left - m.l) / pw) * (ruedas - 1))));
      const c = vis[i], prev = vis[i - 1];
      cursor.setAttribute("x1", sx(i)); cursor.setAttribute("x2", sx(i)); cursor.setAttribute("visibility", "visible");
      const filas = [
        `<b>${esc(fecha(c.d))}</b>`,
        c.o !== undefined && c.o !== null ? `A ${precio(c.o)} · M ${precio(c.h)} · m ${precio(c.l)}` : "",
        `Cierre <b>${precio(c.c)}</b>${prev ? ` <span class="${c.c >= prev.c ? "up" : "down"}">${pctS((c.c / prev.c - 1) * 100)}</span>` : ""}`,
        modoPct ? `${esc(o.nombre || "Activo")}: ${pctS(yVal(c.c))}` : "",
        comp && comp[i] !== null ? `${esc(o.comparar.nombre)}: ${pctS(comp[i])}` : "",
        ...medias.map((s) => (s.v[i] !== null ? `SMA${s.n} ${precio(s.v[i])}` : "")),
        rsiV && rsiV[i] !== null ? `RSI ${num(rsiV[i], 0)}` : "",
        c.v ? `Vol. ${grande(c.v)}` : ""
      ].filter(Boolean);
      tip.innerHTML = filas.join("<br>");
      tip.hidden = false;
      ubicarTip(el, tip, sx(i), ev.clientY - r.top);
    });
    svg.querySelector(".capa").addEventListener("mouseleave", () => { tip.hidden = true; cursor.setAttribute("visibility", "hidden"); });
  });
}

/* ------------------------------------------------------------- líneas */

/* series: [{ nombre, datos: [{d, v}] o [{x, v}], color, area, punteada }] */
export function graficoLineas(el, series, o = {}) {
  observar(el, () => {
    const todos = series.flatMap((s) => s.datos.filter((p) => p.v !== null && p.v !== undefined));
    if (!todos.length) { el.innerHTML = `<div class="vacio">Sin datos para graficar.</div>`; return; }
    const xNum = o.xNum || todos[0].x !== undefined;
    /* Escala logarítmica opcional para plazos (días al vencimiento): separa
       las letras cortas que en escala lineal quedan una encima de la otra. */
    const X = (p) => (xNum ? (o.escalaX === "log" ? Math.log10(Math.max(1, p.x)) : p.x) : Date.parse(p.d));
    const W = Math.max(280, el.clientWidth), H = o.alto || 220;
    const m = { l: 8, r: 58, t: 10, b: 24 };
    const { svg, tip } = contenedor(el, H);
    const xs = todos.map(X);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const ys = [...todos.map((p) => p.v), ...(o.lineasY || []).map((l) => l.v), ...(o.bandas || []).flatMap((b) => [b.desde, b.hasta])];
    if (o.cero) ys.push(0);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.05 || 1;
    y0 -= pad; y1 += pad;
    if (o.desdeCero && y0 > 0) y0 = 0;
    const sx = (x) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const sy = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
    const fy = o.fmtY || ((v) => num(v, Math.abs(y1 - y0) < 5 ? 2 : Math.abs(y1 - y0) < 50 ? 1 : 0));
    const partes = [];
    for (const b of o.bandas || []) partes.push(`<rect x="${m.l}" y="${sy(b.hasta)}" width="${W - m.l - m.r}" height="${Math.max(0, sy(b.desde) - sy(b.hasta))}" style="fill:${b.color || "var(--accent)"};opacity:${b.opacidad ?? 0.08}"/>`);
    for (const t of marcas(y0, y1, 4)) {
      const yy = sy(t);
      if (yy < m.t - 1 || yy > H - m.b + 1) continue;
      partes.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" class="grid"/><text x="${W - m.r + 6}" y="${yy + 3.5}" class="eje">${esc(fy(t))}</text>`);
    }
    if (o.cero && y0 < 0 && y1 > 0) partes.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" class="cero"/>`);
    for (const l of o.lineasY || []) partes.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${sy(l.v)}" y2="${sy(l.v)}" style="stroke:${l.color || "var(--faint)"};stroke-dasharray:4 3"/><text x="${m.l + 4}" y="${sy(l.v) - 4}" class="eje">${esc(l.etiqueta || "")}</text>`);
    series.forEach((s, k) => {
      const pts = s.datos.filter((p) => p.v !== null && p.v !== undefined).sort((a, b) => X(a) - X(b));
      if (!pts.length) return;
      const col = s.color || `var(--c${(k % 5) + 1})`;
      const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(X(p)).toFixed(1)},${sy(p.v).toFixed(1)}`).join("");
      if (s.area) partes.push(`<path d="${d}L${sx(X(pts.at(-1)))},${sy(Math.max(y0, Math.min(0, y1)))}L${sx(X(pts[0]))},${sy(Math.max(y0, Math.min(0, y1)))}Z" style="fill:${col};opacity:.14"/>`);
      partes.push(`<path d="${d}" style="fill:none;stroke:${col};stroke-width:${s.ancho || 1.8}${s.punteada ? ";stroke-dasharray:5 3" : ""}"/>`);
      if (o.puntos || s.puntos) for (const p of pts) partes.push(`<circle cx="${sx(X(p))}" cy="${sy(p.v)}" r="3" style="fill:${col}"/>`);
      if (s.etiquetas) {
        /* Etiquetas de cada punto, salteando las que se pisarían. */
        const puestas = [];
        for (const p of pts) {
          if (!p.etiqueta) continue;
          const px = sx(X(p)), py = sy(p.v) - 7;
          if (puestas.some(([a, b]) => Math.abs(a - px) < 40 && Math.abs(b - py) < 12)) continue;
          puestas.push([px, py]);
          partes.push(`<text x="${px}" y="${py}" class="eje" text-anchor="middle">${esc(p.etiqueta)}</text>`);
        }
      }
    });
    const etX = o.etiquetasX || (xNum ? null : [x0, (x0 + x1) / 2, x1].map((x) => ({ x, t: fechaCorta(new Date(x).toISOString().slice(0, 10)) })));
    const posX = (x) => sx(o.escalaX === "log" ? Math.log10(Math.max(1, x)) : x);
    (etX || []).forEach((e, k, arr) => partes.push(`<text x="${o.etiquetasX ? posX(e.x) : sx(e.x)}" y="${H - 6}" class="eje" text-anchor="${arr.length === 3 && !o.etiquetasX ? ["start", "middle", "end"][k] : "middle"}">${esc(e.t)}</text>`));
    partes.push(`<line class="cursor" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/><rect class="capa" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" style="fill:transparent"/>`);
    svg.innerHTML = partes.join("");

    const ref = series[0].datos.filter((p) => p.v !== null && p.v !== undefined).sort((a, b) => X(a) - X(b));
    const cursor = svg.querySelector(".cursor");
    svg.querySelector(".capa").addEventListener("mousemove", (ev) => {
      const r = svg.getBoundingClientRect();
      const xv = x0 + ((ev.clientX - r.left - m.l) / (W - m.l - m.r)) * (x1 - x0);
      let mejor = ref[0];
      for (const p of ref) if (Math.abs(X(p) - xv) < Math.abs(X(mejor) - xv)) mejor = p;
      const xm = X(mejor);
      cursor.setAttribute("x1", sx(xm)); cursor.setAttribute("x2", sx(xm)); cursor.setAttribute("visibility", "visible");
      const titulo = xNum ? (mejor.etiqueta || mejor.x) : fecha(mejor.d);
      const filas = series.map((s, k) => {
        const lista = s.datos.filter((p) => p.v !== null && p.v !== undefined);
        if (!lista.length) return "";
        let q = lista[0];
        for (const p of lista) if (Math.abs(X(p) - xm) < Math.abs(X(q) - xm)) q = p;
        return `<span style="color:${s.color || `var(--c${(k % 5) + 1})`}">●</span> ${esc(s.nombre || "")} <b>${esc((o.fmtTip || fy)(q.v))}</b>`;
      });
      tip.innerHTML = `<b>${esc(titulo)}</b><br>${filas.filter(Boolean).join("<br>")}`;
      tip.hidden = false;
      ubicarTip(el, tip, sx(xm), ev.clientY - r.top);
    });
    svg.querySelector(".capa").addEventListener("mouseleave", () => { tip.hidden = true; cursor.setAttribute("visibility", "hidden"); });
  });
}

/* ------------------------------------------------------------- barras */

/* items: [{ etiqueta, v, color? }]. horizontal: etiquetas a la izquierda. */
export function graficoBarras(el, items, o = {}) {
  observar(el, () => {
    if (!items.length) { el.innerHTML = `<div class="vacio">Sin datos.</div>`; return; }
    const fmt = o.fmt || ((v) => num(v, 1));
    const color = (it) => it.color || (it.v >= 0 ? "var(--up)" : "var(--down)");
    const W = Math.max(280, el.clientWidth);
    if (o.horizontal) {
      const fila = 24, H = items.length * fila + 8, eti = Math.min(170, W * 0.36), valW = 64;
      const { svg, tip } = contenedor(el, H);
      const max = Math.max(...items.map((i) => Math.abs(i.v || 0))) || 1;
      const hayNeg = items.some((i) => i.v < 0), hayPos = items.some((i) => i.v > 0);
      const ancho = W - eti - valW;
      /* El cero va al centro solo si hay barras de los dos signos. */
      const mixto = hayNeg && hayPos;
      const cero = eti + (mixto ? ancho / 2 : hayNeg ? ancho : 0);
      const esc_ = (v) => (Math.abs(v) / max) * (mixto ? ancho / 2 : ancho);
      svg.innerHTML = items.map((it, k) => {
        const y = 4 + k * fila, w = esc_(it.v || 0), x = it.v >= 0 ? cero : cero - w;
        return `<text x="${eti - 8}" y="${y + 15}" class="eje-l" text-anchor="end">${esc(it.etiqueta)}</text>` +
          `<rect x="${x}" y="${y + 4}" width="${Math.max(1, w)}" height="${fila - 9}" rx="2" style="fill:${color(it)}" data-k="${k}"/>` +
          `<text x="${W - 4}" y="${y + 15}" class="eje-v ${it.v >= 0 ? "up" : "down"}" text-anchor="end">${esc(fmt(it.v))}</text>`;
      }).join("") + (hayNeg ? `<line x1="${cero}" x2="${cero}" y1="0" y2="${H}" class="cero"/>` : "");
      if (o.alClick) svg.addEventListener("click", (e) => { const r = e.target.closest("rect[data-k]"); if (r) o.alClick(items[Number(r.dataset.k)]); });
      tip.remove();
      return;
    }
    const H = o.alto || 200, m = { l: 8, r: 50, t: 10, b: 26 };
    const { svg, tip } = contenedor(el, H);
    const vals = items.map((i) => i.v || 0);
    let y0 = Math.min(0, ...vals), y1 = Math.max(0, ...vals);
    const pad = (y1 - y0) * 0.1 || 1; y1 += pad; if (y0 < 0) y0 -= pad;
    const pw = W - m.l - m.r, bw = pw / items.length;
    const sy = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
    const partes = [];
    for (const t of marcas(y0, y1, 4)) partes.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${sy(t)}" y2="${sy(t)}" class="grid"/><text x="${W - m.r + 6}" y="${sy(t) + 3.5}" class="eje">${esc(fmt(t))}</text>`);
    items.forEach((it, k) => {
      const x = m.l + k * bw + bw * 0.15, y = sy(Math.max(0, it.v)), hh = Math.abs(sy(it.v) - sy(0));
      partes.push(`<rect x="${x}" y="${y}" width="${bw * 0.7}" height="${Math.max(1, hh)}" rx="1.5" style="fill:${color(it)}" data-k="${k}"/>`);
    });
    const paso = Math.ceil(items.length / Math.max(1, Math.floor(pw / 46)));
    items.forEach((it, k) => { if (k % paso === 0 || k === items.length - 1) partes.push(`<text x="${m.l + k * bw + bw / 2}" y="${H - 8}" class="eje" text-anchor="middle">${esc(it.etiqueta)}</text>`); });
    partes.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" class="cero"/>`);
    svg.innerHTML = partes.join("");
    svg.addEventListener("mousemove", (e) => {
      const r = e.target.closest("rect[data-k]");
      if (!r) { tip.hidden = true; return; }
      const it = items[Number(r.dataset.k)];
      tip.innerHTML = `<b>${esc(it.titulo || it.etiqueta)}</b><br>${esc(fmt(it.v))}`;
      tip.hidden = false;
      const b = svg.getBoundingClientRect();
      ubicarTip(el, tip, e.clientX - b.left, e.clientY - b.top);
    });
    svg.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
}

/* ---------------------------------------------------------- miniaturas */

export function sparkline(valores, { w = 96, h = 26, color } = {}) {
  const v = (valores || []).filter((x) => Number.isFinite(x));
  if (v.length < 2) return "";
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const d = v.map((x, i) => `${i ? "L" : "M"}${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - min) / span) * (h - 4)).toFixed(1)}`).join("");
  const col = color || (v.at(-1) >= v[0] ? "var(--up)" : "var(--down)");
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" style="fill:none;stroke:${col};stroke-width:1.4"/></svg>`;
}

/* Medidor semicircular 0-100 (Fear & Greed). */
export function medidor(valor, etiqueta) {
  const v = Math.max(0, Math.min(100, valor || 0));
  const ang = Math.PI * (1 - v / 100);
  const cx = 90, cy = 86, r = 70;
  const x = cx + r * Math.cos(ang), y = cy - r * Math.sin(ang);
  const tramos = [["var(--down)", 0, 25], ["#e0864a", 25, 45], ["var(--faint)", 45, 55], ["#8fc46a", 55, 75], ["var(--up)", 75, 100]];
  const arco = (a, b) => {
    const a1 = Math.PI * (1 - a / 100), a2 = Math.PI * (1 - b / 100);
    return `M${cx + r * Math.cos(a1)},${cy - r * Math.sin(a1)} A${r},${r} 0 0 1 ${cx + r * Math.cos(a2)},${cy - r * Math.sin(a2)}`;
  };
  /* La aguja llega hasta el arco interno y el número va debajo del eje, así
     nunca se tapan. */
  const xi = cx + (r - 14) * Math.cos(ang), yi = cy - (r - 14) * Math.sin(ang);
  return `<svg viewBox="0 0 180 122" class="medidor" role="img" aria-label="${esc(etiqueta)} ${Math.round(v)}">
    ${tramos.map(([c, a, b]) => `<path d="${arco(a, b)}" style="fill:none;stroke:${c};stroke-width:12"/>`).join("")}
    <circle cx="${x}" cy="${y}" r="7" style="fill:var(--panel);stroke:var(--ink);stroke-width:2.5"/>
    <line x1="${cx}" y1="${cy}" x2="${xi}" y2="${yi}" style="stroke:var(--ink);stroke-width:2.5;stroke-linecap:round"/><circle cx="${cx}" cy="${cy}" r="4" style="fill:var(--ink)"/>
    <text x="${cx}" y="${cy + 30}" text-anchor="middle" class="medidor-v">${Math.round(v)}</text></svg>`;
}

/* Barra de rango: dónde está un valor entre mínimo y máximo, con marcas. */
export function barraRango(min, max, actual, marcasExtra = [], { fmt = (v) => num(v, 1), invertir = false } = {}) {
  const pos = (v) => Math.max(0, Math.min(100, ((v - min) / (max - min || 1)) * 100));
  const grad = invertir ? "linear-gradient(90deg,var(--down),var(--warn),var(--up))" : "linear-gradient(90deg,var(--up),var(--warn),var(--down))";
  return `<div class="rango">
    <div class="rango-barra" style="background:${grad}">
      ${marcasExtra.map((m) => `<span class="rango-marca" style="left:${pos(m.v)}%" title="${esc(m.t)}: ${esc(fmt(m.v))}"></span>`).join("")}
      <span class="rango-actual" style="left:${pos(actual)}%" title="Actual: ${esc(fmt(actual))}"></span>
    </div>
    <div class="rango-eje"><span>mín ${esc(fmt(min))}</span>${marcasExtra.filter((m) => m.eje).map((m) => `<span>${esc(m.t)} ${esc(fmt(m.v))}</span>`).join("")}<span>máx ${esc(fmt(max))}</span></div>
  </div>`;
}
