import { $, $$, api, esc, qs, pref, setPref, precio, pctS, numS, cls, fechaHora, fecha, cargando, errorHtml } from "./util.js";
import { sparkline } from "./charts.js";
import { configurarIA } from "./dossier.js";

import mercado from "./views/mercado.js";
import argentina from "./views/argentina.js";
import calendario from "./views/calendario.js";
import cotizacion from "./views/cotizacion.js";
import fundamentales from "./views/fundamentales.js";
import valuacion from "./views/valuacion.js";
import riesgo from "./views/riesgo.js";
import criterios from "./views/criterios.js";
import sec from "./views/sec.js";
import noticias from "./views/noticias.js";
import { tesis, call, foso } from "./views/ia.js";
import tradingview from "./views/tradingview.js";
import fuentes from "./views/fuentes.js";
import clientes from "./views/clientes.js";
import carteras from "./views/carteras.js";

const VISTAS = Object.fromEntries([mercado, argentina, calendario, clientes, carteras, cotizacion, fundamentales, valuacion, riesgo, criterios, sec, noticias, tesis, call, foso, tradingview, fuentes].map((v) => [v.id, v]));

const GRUPOS = [
  ["Mercados", ["resumen", "argentina", "calendario"]],
  ["Clientes y carteras", ["clientes", "carteras"]],
  ["Activo", ["cotizacion", "fundamentales", "valuacion", "riesgo", "criterios", "sec", "noticias"]],
  ["Análisis con IA", ["tesis", "call", "foso"]],
  ["Herramientas", ["tradingview", "fuentes"]]
];

/* ------------------------------------------------------------ estado */

const estado = {
  ticker: pref("ticker", "NVDA"),
  usdCcl: pref("usdCcl", false),
  memo: new Map(),
  servidor: null
};

/* Memoria por ticker: cada vista guarda lo que bajó, y al cambiar de ticker
   se descarta todo. Así navegar entre vistas no repite descargas. */
function memo(clave, fn) {
  const k = `${estado.ticker}|${estado.usdCcl}|${clave}`;
  if (!estado.memo.has(k)) {
    const p = Promise.resolve().then(fn);
    estado.memo.set(k, p);
    p.catch(() => estado.memo.delete(k));
  }
  return estado.memo.get(k);
}

const ctx = {
  get ticker() { return estado.ticker; },
  get usdCcl() { return estado.usdCcl; },
  get servidor() { return estado.servidor; },
  memo,
  precio: (rango = "2y") => memo(`px:${rango}`, () => api(`/api/price?${qs({ t: estado.ticker, rango, usd: estado.usdCcl ? "ccl" : "" })}`)),
  ir: (vista, t) => { location.hash = `#/${vista}${t ? `?t=${encodeURIComponent(t)}` : ""}`; },
  /* Parámetros de la dirección (#/clientes?c=ID) y navegación con ellos. */
  get params() { return new URLSearchParams(location.hash.split("?")[1] || ""); },
  irCon: (vista, params = {}) => { const q = new URLSearchParams(params).toString(); location.hash = `#/${vista}${q ? `?${q}` : ""}`; },
  cargarTicker: (t, vista) => cambiarTicker(t, vista),
  watchlist: () => pref("watchlist", WATCH_INICIAL),
  enWatchlist: (t) => pref("watchlist", WATCH_INICIAL).includes(t),
  alternarWatchlist: (t) => alternarWatch(t),
  rerender: () => render()
};

/* ------------------------------------------------------------ router */

function leerHash() {
  const [ruta, query] = location.hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(query || "");
  return { vista: VISTAS[ruta] ? ruta : "resumen", t: params.get("t") };
}

function cambiarTicker(t, vista) {
  const nuevo = String(t || "").trim().toUpperCase();
  if (!nuevo) return;
  const destino = vista || (VISTAS[leerHash().vista]?.requiereTicker ? leerHash().vista : "cotizacion");
  if (nuevo !== estado.ticker) {
    estado.ticker = nuevo;
    estado.memo.clear();
    setPref("ticker", nuevo);
  }
  const hash = `#/${destino}?t=${encodeURIComponent(nuevo)}`;
  if (location.hash === hash) render(); else location.hash = hash;
}

let renderId = 0;
async function render() {
  const { vista, t } = leerHash();
  if (t && t.toUpperCase() !== estado.ticker) {
    estado.ticker = t.toUpperCase();
    estado.memo.clear();
    setPref("ticker", estado.ticker);
  }
  const v = VISTAS[vista];
  const id = ++renderId;
  document.title = `${v.titulo}${v.requiereTicker ? ` · ${estado.ticker}` : ""} · Market Desk`;
  $$(".nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.v === vista ? "page" : "false"));
  $$(".nav a[data-t]").forEach((a) => { a.href = `#/${a.dataset.v}?t=${encodeURIComponent(estado.ticker)}`; });
  document.body.classList.remove("nav-abierta");
  $("#buscar").value = "";
  $("#buscar").placeholder = `${estado.ticker} · buscar ticker o empresa  ( / )`;

  const main = $("#vista");
  main.innerHTML = "";
  const cab = document.createElement("div");
  const cuerpo = document.createElement("div");
  cuerpo.className = "vista-cuerpo";
  main.append(cab, cuerpo);
  cuerpo.innerHTML = `<header class="vista-h"><h1>${esc(v.titulo)}</h1>${v.descripcion ? `<p>${v.descripcion}</p>` : ""}</header><div class="vista-contenido"></div>`;
  window.scrollTo({ top: 0 });

  if (v.requiereTicker) encabezadoActivo(cab, id);
  try {
    await v.render(cuerpo.querySelector(".vista-contenido"), ctx);
  } catch (e) {
    if (id === renderId) cuerpo.querySelector(".vista-contenido").innerHTML = errorHtml(e);
  }
}

/* ------------------------------------------------ encabezado del activo */

async function encabezadoActivo(cab, id) {
  cab.className = "activo-h";
  cab.innerHTML = `<div class="activo-id"><span class="activo-tk">${esc(estado.ticker)}</span><span class="activo-nombre">${cargando("")}</span></div>`;
  try {
    const p = await ctx.precio();
    if (id !== renderId) return;
    const s = p.stats;
    const esArs = p.moneda === "ARS" || p.moneda === "USD CCL";
    const enWatch = ctx.enWatchlist(estado.ticker);
    cab.innerHTML = `
      <div class="activo-id">
        <button class="estrella" data-watch aria-pressed="${enWatch}" title="${enWatch ? "Quitar de" : "Agregar a"} la watchlist">${enWatch ? "★" : "☆"}</button>
        <span class="activo-tk">${esc(p.ticker)}</span>
        <span class="activo-nombre">${esc(p.nombre || "")}</span>
        <span class="chip">${esc(p.bolsa || p.source)}</span>
        <span class="chip">${esc(p.moneda)}</span>
        ${esArs ? `<span class="toggle"><button data-mon="ars" aria-pressed="${!estado.usdCcl}">Pesos</button><button data-mon="ccl" aria-pressed="${estado.usdCcl}">USD CCL</button></span>` : ""}
      </div>
      <div class="activo-px">
        <span class="activo-precio">${precio(s.last)}</span>
        <span class="${cls(s.ret1)}">${numS(s.cambio1, Math.abs(s.last) < 10 ? 3 : 2)} (${pctS(s.ret1)})</span>
        <span class="activo-fecha">${p.horaMercado ? `${fechaHora(p.horaMercado)} · demorado` : `cierre ${fecha(s.date)}`} · ${esc(p.source)}</span>
      </div>
      ${p.note ? `<div class="msg aviso-activo">${esc(p.note)}</div>` : ""}`;
    cab.querySelector("[data-watch]").addEventListener("click", () => { alternarWatch(estado.ticker); encabezadoActivo(cab, id); });
    cab.querySelectorAll("[data-mon]").forEach((b) => b.addEventListener("click", () => {
      const ccl = b.dataset.mon === "ccl";
      if (ccl === estado.usdCcl) return;
      estado.usdCcl = ccl;
      setPref("usdCcl", ccl);
      render();
    }));
  } catch (e) {
    if (id !== renderId) return;
    cab.innerHTML = `<div class="activo-id"><span class="activo-tk">${esc(estado.ticker)}</span></div><div class="msg err">${esc(e.message)}</div>`;
  }
}

/* ------------------------------------------------------------- watchlist */

const WATCH_INICIAL = ["^GSPC", "^MERV", "NVDA", "AAPL", "MSFT", "GGAL.BA", "YPFD.BA", "BTC-USD"];

function alternarWatch(t) {
  const l = pref("watchlist", WATCH_INICIAL);
  const i = l.indexOf(t);
  if (i >= 0) l.splice(i, 1); else l.push(t);
  setPref("watchlist", l);
  dibujarWatchlist();
}

let watchTimer = null;
async function dibujarWatchlist() {
  const cont = $("#watchlist");
  const lista = pref("watchlist", WATCH_INICIAL);
  if (!lista.length) { cont.innerHTML = `<p class="nav-vacio">Vacía. Usá la ☆ junto al nombre de un activo para agregarlo.</p>`; return; }
  if (!cont.children.length || cont.querySelector(".nav-vacio")) cont.innerHTML = lista.map((t) => `<a class="wl" data-wt="${esc(t)}" href="#/cotizacion?t=${encodeURIComponent(t)}"><span class="wl-t">${esc(t)}</span><span class="wl-v">…</span></a>`).join("");
  try {
    const { filas } = await api(`/api/cotizaciones?t=${encodeURIComponent(lista.join(","))}`);
    cont.innerHTML = filas.map((f, i) => {
      const t = lista[i];
      return `<a class="wl" data-wt="${esc(t)}" href="#/cotizacion?t=${encodeURIComponent(t)}" title="${esc(f.nombre || f.error || "")}">
        <span class="wl-t">${esc(t)}</span>${f.error ? `<span class="wl-v faint">sin datos</span>` : `<span class="wl-s">${sparkline(f.spark?.slice(-22), { w: 44, h: 16 })}</span><span class="wl-v ${cls(f.ret1)}">${pctS(f.ret1, 1)}</span>`}
        <button class="wl-x" data-quitar="${esc(t)}" title="Quitar" aria-label="Quitar ${esc(t)}">×</button></a>`;
    }).join("");
  } catch { /* la watchlist no es crítica */ }
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => { if (!document.hidden) dibujarWatchlist(); }, 120000);
}

/* -------------------------------------------------------------- búsqueda */

function buscador() {
  const input = $("#buscar"), lista = $("#sugerencias");
  let timer = null, items = [], sel = -1, ultimo = "";
  const cerrar = () => { lista.hidden = true; sel = -1; };
  const pintar = () => {
    lista.innerHTML = items.map((r, i) => `<li role="option" aria-selected="${i === sel}" data-i="${i}"><b>${esc(r.ticker)}</b><span>${esc(r.nombre)}</span><small>${esc([r.tipo, r.bolsa].filter(Boolean).join(" · "))}</small></li>`).join("")
      || `<li class="vacio">Enter para cargar "${esc(input.value.trim().toUpperCase())}"</li>`;
    lista.hidden = false;
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { cerrar(); return; }
    timer = setTimeout(async () => {
      ultimo = q;
      try {
        const r = await api(`/api/buscar?q=${encodeURIComponent(q)}`);
        if (ultimo !== q) return;
        items = r.resultados; sel = -1; pintar();
      } catch { items = []; pintar(); }
    }, 220);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); pintar(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(-1, sel - 1); pintar(); e.preventDefault(); }
    else if (e.key === "Escape") { cerrar(); input.blur(); }
    else if (e.key === "Enter") {
      const t = sel >= 0 ? items[sel].ticker : input.value.trim();
      cerrar(); input.blur();
      if (t) cambiarTicker(t);
    }
  });
  lista.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (!li) return;
    e.preventDefault();
    cerrar(); input.blur();
    cambiarTicker(items[Number(li.dataset.i)].ticker);
  });
  input.addEventListener("blur", () => setTimeout(cerrar, 120));
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); input.focus(); }
  });
}

/* ------------------------------------------------------------------ tema */

function aplicarTema(t) {
  document.documentElement.dataset.theme = t;
  $("#tema").textContent = t === "light" ? "◐ Claro" : "◑ Oscuro";
}

/* ------------------------------------------------------------------ inicio */

function navegacion() {
  $("#nav").innerHTML = GRUPOS.map(([g, ids]) => `<div class="nav-g"><div class="nav-titulo">${esc(g)}</div>${ids.map((id) => {
    const v = VISTAS[id];
    return `<a href="#/${id}${v.requiereTicker ? `?t=${encodeURIComponent(estado.ticker)}` : ""}" data-v="${id}"${v.requiereTicker ? " data-t" : ""}><span class="ico">${v.icono || "·"}</span>${esc(v.titulo)}</a>`;
  }).join("")}</div>`).join("");
}

async function estadoServidor() {
  try {
    const e = await api("/api/estado");
    estado.servidor = e;
    configurarIA(e.ia);
    const pill = $("#iaEstado");
    const conf = e.ia.proveedores.filter((p) => p.configurado);
    pill.textContent = conf.length ? `IA: ${conf.find((p) => p.id === e.ia.proveedor)?.nombre || conf[0].nombre}` : "IA: sin clave";
    pill.classList.toggle("ok", conf.length > 0);
    pill.title = conf.length ? `Proveedores configurados: ${conf.map((p) => p.nombre).join(", ")}` : "Sumá una clave gratuita en .env para analizar sin copiar y pegar";
  } catch { /* sin estado igual funciona */ }
}

async function iniciar() {
  aplicarTema(pref("tema", matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  $("#tema").addEventListener("click", () => {
    const t = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    setPref("tema", t); aplicarTema(t);
    /* Los gráficos propios usan variables de CSS y cambian solos; los
       widgets de TradingView reciben el tema al crearse y hay que recargarlos. */
    if (["tradingview", "calendario"].includes(leerHash().vista)) render();
  });
  $("#menu").addEventListener("click", () => document.body.classList.toggle("nav-abierta"));
  $("#watchlist").addEventListener("click", (e) => {
    const x = e.target.closest("[data-quitar]");
    if (x) { e.preventDefault(); alternarWatch(x.dataset.quitar); }
  });
  navegacion();
  buscador();
  await estadoServidor();
  window.addEventListener("hashchange", render);
  render();
  dibujarWatchlist();
}

iniciar();
