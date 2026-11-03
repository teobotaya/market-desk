/* Utilidades de la interfaz: formato numérico argentino, DOM, API, CSV y
   preferencias guardadas en el navegador. */

/* ------------------------------------------------------------ formato */

const formatos = new Map();
const nf = (d) => {
  if (!formatos.has(d)) formatos.set(d, new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  return formatos.get(d);
};
export const vacio = (v) => v === null || v === undefined || Number.isNaN(v) || !Number.isFinite(Number(v));

export const num = (v, d = 2) => (vacio(v) ? "—" : nf(d).format(v));
export const pct = (v, d = 1) => (vacio(v) ? "—" : `${nf(d).format(v)}%`);
export const pctS = (v, d = 2) => (vacio(v) ? "—" : `${v > 0 ? "+" : ""}${nf(d).format(v)}%`);
export const numS = (v, d = 2) => (vacio(v) ? "—" : `${v > 0 ? "+" : ""}${nf(d).format(v)}`);
export const veces = (v, d = 1) => (vacio(v) ? "—" : `${nf(d).format(v)}x`);

/* Precio con decimales según su magnitud: 0,0123 · 12,34 · 7.450,00 */
export const precio = (v) => {
  if (vacio(v)) return "—";
  const a = Math.abs(v);
  return nf(a < 1 ? 4 : a < 10 ? 3 : a >= 100000 ? 0 : 2).format(v);
};

/* "mil M" evita la ambigüedad de "MM" (que en Argentina a veces significa
   millones y a veces miles de millones). Billón = millón de millones. */
export const grande = (v) => {
  if (vacio(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return `${nf(2).format(v / 1e12)} bill.`;
  if (a >= 1e9) return `${nf(1).format(v / 1e9)} mil M`;
  if (a >= 1e6) return `${nf(1).format(v / 1e6)} M`;
  if (a >= 1e3) return nf(0).format(v);
  return nf(2).format(v);
};

export const fecha = (iso) => {
  if (!iso) return "—";
  const s = String(iso);
  const [y, m, d] = s.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : s;
};
export const fechaHora = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export const cls = (v) => (vacio(v) ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
export const esc = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&#39;" }[c]));
/* Enlaces que vienen de fuentes externas: solo http(s), ya escapados. */
export const enlace = (u) => (/^https?:\/\//i.test(String(u || "")) ? esc(u) : "#");

/* --------------------------------------------------------------- DOM */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const cargando = (txt = "Cargando…") => `<div class="cargando"><span class="spin"></span>${esc(txt)}</div>`;
export const errorHtml = (e, reintentar = false) =>
  `<div class="msg err"><b>No se pudo cargar.</b> ${esc(e?.message || e)}${reintentar ? ` <button class="btn chico" data-reintentar>Reintentar</button>` : ""}</div>`;
export const avisoHtml = (txt) => `<div class="msg">${txt}</div>`;

/* Tarjeta de indicador: etiqueta, valor y nota. */
export const kpi = (k, v, x = "", c = "", titulo = "") =>
  `<div class="kpi"${titulo ? ` title="${esc(titulo)}"` : ""}><div class="k">${esc(k)}</div><div class="v ${c}">${esc(v)}</div>${x ? `<div class="x">${esc(x)}</div>` : ""}</div>`;

export function tarjeta(titulo, cuerpo, { acciones = "", sub = "", clase = "" } = {}) {
  return `<section class="card ${clase}"><header class="card-h"><div><h3>${esc(titulo)}</h3>${sub ? `<p class="card-sub">${sub}</p>` : ""}</div>${acciones ? `<div class="card-acc">${acciones}</div>` : ""}</header>${cuerpo}</section>`;
}

/* Pestañas internas de una vista. Devuelve el HTML y un enlazador. */
export function subtabs(id, opciones, activa) {
  return `<div class="subtabs" role="tablist" data-subtabs="${id}">${opciones.map(([k, t]) =>
    `<button role="tab" data-k="${k}" aria-selected="${k === activa}">${esc(t)}</button>`).join("")}</div>`;
}
export function enlazarSubtabs(root, id, alCambiar) {
  const cont = root.querySelector(`[data-subtabs="${id}"]`);
  if (!cont) return;
  cont.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    cont.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    alCambiar(b.dataset.k);
  });
}

/* ---------------------------------------------------------------- API */

export async function api(ruta, opciones) {
  const r = await fetch(ruta, opciones);
  let j;
  try { j = await r.json(); } catch { throw new Error(`respuesta inválida del servidor (${r.status})`); }
  if (!r.ok || j.error) throw new Error(j.error || `error ${r.status}`);
  return j;
}

export const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

/* ------------------------------------------------------- preferencias */

export function pref(clave, def) {
  try {
    const v = localStorage.getItem(`md.${clave}`);
    return v === null ? def : JSON.parse(v);
  } catch { return def; }
}
export function setPref(clave, valor) {
  try { localStorage.setItem(`md.${clave}`, JSON.stringify(valor)); } catch { /* modo privado */ }
}

/* ---------------------------------------------------------------- CSV */

/* Separador ";" y coma decimal: es lo que espera Excel configurado en
   español de Argentina. El BOM hace que respete los acentos. */
export function descargarCsv(nombre, encabezados, filas) {
  const celda = (v) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return Number.isFinite(v) ? String(v).replace(".", ",") : "";
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
  };
  const txt = [encabezados, ...filas].map((f) => f.map(celda).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${nombre}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copiar(texto, boton) {
  const original = boton?.textContent;
  try { await navigator.clipboard.writeText(texto); if (boton) boton.textContent = "Copiado ✓"; }
  catch { if (boton) boton.textContent = "Seleccioná y copiá"; }
  if (boton) setTimeout(() => { boton.textContent = original; }, 1600);
}

/* ----------------------------------------------------------- markdown */

/* Markdown mínimo y seguro para las respuestas de la IA: primero se escapa
   todo el HTML y después se aplican títulos, negritas, listas y tablas. */
export function markdown(src) {
  const lineas = esc(src).split(/\r?\n/);
  const out = [];
  let lista = null, tabla = null, parrafo = [];
  const inline = (s) => s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  const cerrarParrafo = () => { if (parrafo.length) { out.push(`<p>${inline(parrafo.join(" "))}</p>`); parrafo = []; } };
  const cerrarLista = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  const cerrarTabla = () => {
    if (!tabla) return;
    const [cab, ...resto] = tabla.filter((f) => !/^\s*\|?\s*:?-{2,}/.test(f));
    const celdas = (f) => f.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => inline(c.trim()));
    out.push(`<div class="tabla-scroll"><table><thead><tr>${celdas(cab).map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${resto.map((f) => `<tr>${celdas(f).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    tabla = null;
  };
  for (const l of lineas) {
    const t = l.trim();
    if (/^\|.*\|$/.test(t)) { cerrarParrafo(); cerrarLista(); (tabla ||= []).push(t); continue; }
    cerrarTabla();
    let m;
    if (!t) { cerrarParrafo(); cerrarLista(); continue; }
    if ((m = t.match(/^(#{1,4})\s+(.*)$/))) { cerrarParrafo(); cerrarLista(); out.push(`<h${Math.min(6, m[1].length + 2)}>${inline(m[2])}</h${Math.min(6, m[1].length + 2)}>`); continue; }
    if ((m = t.match(/^[-*•]\s+(.*)$/))) { cerrarParrafo(); if (lista !== "ul") { cerrarLista(); out.push("<ul>"); lista = "ul"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { cerrarParrafo(); if (lista !== "ol") { cerrarLista(); out.push("<ol>"); lista = "ol"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(t)) { cerrarParrafo(); cerrarLista(); out.push("<hr>"); continue; }
    cerrarLista();
    parrafo.push(t);
  }
  cerrarParrafo(); cerrarLista(); cerrarTabla();
  return out.join("\n");
}

/* ---------------------------------------------------------- tablas */

/* Tabla ordenable con exportación a CSV. columnas: [{k, t, fmt, cls, n}] */
export function tablaOrdenable(cont, { columnas, filas, nombreCsv, alClick, limite = 0, filtro = false, claseFila }) {
  let orden = null, asc = false, texto = "";
  const dibujar = () => {
    let datos = [...filas];
    if (texto) datos = datos.filter((f) => columnas.some((c) => String(f[c.k] ?? "").toLowerCase().includes(texto)));
    if (orden) {
      datos.sort((a, b) => {
        const x = a[orden], y = b[orden];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * (asc ? 1 : -1);
      });
    }
    const visibles = limite ? datos.slice(0, limite) : datos;
    cont.querySelector("tbody").innerHTML = visibles.map((f) => `<tr class="${alClick ? "clic" : ""} ${claseFila ? claseFila(f) : ""}" data-i="${filas.indexOf(f)}">${columnas.map((c) =>
      `<td class="${c.n ? "n" : ""} ${c.cls ? c.cls(f[c.k], f) : ""}">${c.fmt ? c.fmt(f[c.k], f) : esc(f[c.k] ?? "—")}</td>`).join("")}</tr>`).join("")
      || `<tr><td colspan="${columnas.length}" class="vacio">Sin filas${texto ? " para ese filtro" : ""}.</td></tr>`;
    cont.querySelectorAll("th[data-k]").forEach((th) => { th.dataset.orden = th.dataset.k === orden ? (asc ? "asc" : "desc") : ""; });
    const pie = cont.querySelector(".tabla-pie span");
    if (pie) pie.textContent = `${visibles.length} de ${datos.length} filas`;
  };
  cont.innerHTML = `${filtro ? `<input class="filtro" type="search" placeholder="Filtrar…" aria-label="Filtrar tabla">` : ""}
    <div class="tabla-scroll"><table><thead><tr>${columnas.map((c) => `<th data-k="${c.k}" class="${c.n ? "n" : ""}" title="Ordenar">${esc(c.t)}</th>`).join("")}</tr></thead><tbody></tbody></table></div>
    <div class="tabla-pie"><span></span>${nombreCsv ? `<button class="btn chico" data-csv>Descargar CSV</button>` : ""}</div>`;
  cont.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (!th) return;
    if (orden === th.dataset.k) asc = !asc; else { orden = th.dataset.k; asc = false; }
    dibujar();
  });
  cont.querySelector(".filtro")?.addEventListener("input", (e) => { texto = e.target.value.trim().toLowerCase(); dibujar(); });
  cont.querySelector("[data-csv]")?.addEventListener("click", () => {
    descargarCsv(nombreCsv, columnas.map((c) => c.t), filas.map((f) => columnas.map((c) => (c.csv ? c.csv(f[c.k], f) : f[c.k]))));
  });
  if (alClick) cont.querySelector("tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-i]");
    if (tr && !e.target.closest("a, button, input, select")) alClick(filas[Number(tr.dataset.i)]);
  });
  dibujar();
  return { redibujar: dibujar };
}
