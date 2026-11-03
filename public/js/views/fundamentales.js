import { esc, enlace, num, pct, pctS, precio, grande, veces, cls, kpi, cargando, errorHtml, api, tarjeta, fecha, descargarCsv, vacio, subtabs, enlazarSubtabs, pref, setPref } from "../util.js";
import { barraRango, graficoBarras } from "../charts.js";
import { dossier } from "../dossier.js";
import { bloqueFundamentales, bloqueConsenso, REGLAS } from "./comun.js";

const FILAS = [
  ["Ingresos", "ingresos", grande],
  ["Crecimiento", "crecimiento", (v) => pctS(v, 1), cls],
  ["Margen bruto", "margenBruto", (v) => pct(v)],
  ["Margen operativo", "margenOperativo", (v) => pct(v)],
  ["Margen neto", "margenNeto", (v) => pct(v)],
  ["BPA diluido", "bpa", (v) => num(v, 2)],
  ["I+D / ventas", "idSobreVentas", (v) => pct(v)],
  ["Remuneración en acciones / ventas", "sbcSobreVentas", (v) => pct(v)],
  ["ROIC (aprox.)", "roic", (v) => pct(v), (v) => (v >= 15 ? "up" : !vacio(v) && v < 8 ? "down" : "")],
  ["ROE", "roe", (v) => pct(v)],
  ["Flujo de caja libre", "fcf", grande],
  ["Margen FCF", "margenFcf", (v) => pct(v)],
  ["Conversión FCF / beneficio", "conversion", (v) => pct(v, 0), (v) => (vacio(v) ? "" : v >= 80 ? "up" : v < 50 ? "down" : "warn")],
  ["Deuda neta", "deudaNeta", grande, (v) => (!vacio(v) && v < 0 ? "up" : "")],
  ["Deuda neta / EBITDA", "deudaNetaEbitda", (v) => veces(v, 2), (v) => (vacio(v) ? "" : v > 3 ? "down" : v < 1 ? "up" : "")],
  ["Cobertura de intereses", "cobertura", (v) => veces(v), (v) => (vacio(v) ? "" : v < 3 ? "down" : "up")],
  ["Recompras", "recompras", grande],
  ["Acciones diluidas", "acciones", grande]
];
const FILAS_Q = [
  ["Ingresos", "ingresos", grande], ["Crec. interanual", "crecimientoIA", (v) => pctS(v, 1), cls],
  ["Margen bruto", "margenBruto", (v) => pct(v)], ["Margen operativo", "margenOperativo", (v) => pct(v)], ["Margen neto", "margenNeto", (v) => pct(v)],
  ["BPA diluido", "bpa", (v) => num(v, 2)], ["Crec. BPA interanual", "crecimientoBpa", (v) => pctS(v, 1), cls], ["Flujo de caja libre", "fcf", grande]
];

const REC = { strong_buy: "compra fuerte", buy: "compra", hold: "mantener", underperform: "bajo rendimiento", sell: "venta", none: "—" };

export default {
  id: "fundamentales",
  titulo: "Fundamentales",
  icono: "▤",
  requiereTicker: true,
  descripcion: "Estados financieros presentados a la SEC (últimos 12 meses, anuales y trimestrales), valuación con precio de hoy y consenso de analistas. Para ADRs argentinos usa el 20-F (YPFD.BA → YPF).",

  async render(el, ctx) {
    el.innerHTML = `<div data-perfil></div><div data-val>${cargando("Bajando los estados financieros de la SEC (la primera vez tarda: el archivo es grande)…")}</div><div data-cons></div><div data-tablas></div><div data-estados></div><div data-ia></div>`;
    const consP = ctx.memo("consenso", () => api(`/api/consenso?t=${encodeURIComponent(ctx.ticker)}`));
    const fundP = ctx.memo("fund", () => api(`/api/fundamentales?t=${encodeURIComponent(ctx.ticker)}`));

    let cons = null, fund = null;
    const pc = consP.then((c) => { cons = c; pintarConsenso(el, c); }).catch((e) => {
      el.querySelector("[data-cons]").innerHTML = tarjeta("Consenso de analistas", `<div class="msg">No disponible: ${esc(e.message)}</div>`);
    });
    const pf = fundP.then((f) => { fund = f; pintarFundamentales(el, f); }).catch((e) => {
      el.querySelector("[data-val]").innerHTML = errorHtml(e);
    });
    estadosFinancieros(el.querySelector("[data-estados]"), ctx);
    await Promise.allSettled([pc, pf]);
    if (!fund && !cons) return;

    const filasTxt = (campo, fmt) => fund.filas.map((x) => `${x.fy}: ${fmt(x[campo])}`).join(" · ");
    const prompt =
`Analizá los fundamentales de ${fund?.empresa || ctx.ticker} (${ctx.ticker}).

${fund ? `ÚLTIMOS 12 MESES Y VALUACIÓN
${bloqueFundamentales(fund)}

SERIE ANUAL (${fund.moneda})
Ingresos: ${filasTxt("ingresos", grande)}
Crecimiento: ${filasTxt("crecimiento", (v) => pctS(v, 1))}
Margen bruto: ${filasTxt("margenBruto", pct)}
Margen operativo: ${filasTxt("margenOperativo", pct)}
Margen neto: ${filasTxt("margenNeto", pct)}
ROIC aproximado: ${filasTxt("roic", pct)}
Flujo de caja libre: ${filasTxt("fcf", grande)}
Conversión FCF/beneficio: ${filasTxt("conversion", (v) => pct(v, 0))}
Deuda neta/EBITDA: ${filasTxt("deudaNetaEbitda", (v) => veces(v, 2))}
Remuneración en acciones/ventas: ${filasTxt("sbcSobreVentas", pct)}
Dilución anual de acciones: ${pct(fund.dilucionAnual, 2)}

ÚLTIMOS TRIMESTRES
${fund.trimestral.map((q) => `${fecha(q.fin)}: ingresos ${grande(q.ingresos)} (${pctS(q.crecimientoIA, 1)} i.a.) · margen op. ${pct(q.margenOperativo)} · BPA ${num(q.bpa, 2)}`).join("\n")}` : "(estados financieros no disponibles)"}

${cons ? `CONSENSO DE ANALISTAS
${bloqueConsenso(cons)}
${cons.estimaciones?.map((e) => `${e.periodo}: BPA estimado ${num(e.bpa, 2)} (${pctS(e.crecimientoBpa, 1)}), ingresos ${grande(e.ingresos)} (${pctS(e.crecimientoIngresos, 1)}), revisiones 30 días: ${e.revSuben30 ?? "—"} al alza / ${e.revBajan30 ?? "—"} a la baja`).join("\n") || ""}` : ""}

Devolvé:

1. QUÉ TIPO DE NEGOCIO ES
   Leído en los márgenes y el ROIC, no en el sector. ¿Fija precios o los acepta? ¿Crea valor al crecer, o lo destruye?

2. ¿EL BENEFICIO ES REAL?
   Conversión a caja y peso de la remuneración en acciones. Si diverge en algún año, decí en cuál y qué lo explicaría.

3. LA TENDENCIA, NO LA FOTO
   Qué mejora y qué se deteriora, anual y trimestralmente. Un margen que baja mientras los ingresos suben significa algo distinto que uno que baja con ingresos planos.

4. SOLVENCIA
   ¿Puede aguantar un año malo? Deuda neta, cobertura y caja.

5. CALIDAD CONTRA PRECIO
   Separá las dos preguntas: qué tan bueno es el negocio y qué tan caro está. Si la valuación descuenta un crecimiento, decí cuál y compáralo con lo que estiman los analistas.

6. LO QUE ESTOS NÚMEROS NO MUESTRAN
   Y qué habría que mirar en el 10-K para completarlo.

${REGLAS}`;
    dossier(el.querySelector("[data-ia]"), { titulo: "Fundamentales", prompt });
  }
};

function pintarFundamentales(el, d) {
  const v = d.valuacion, t = d.ttm;
  el.querySelector("[data-val]").innerHTML = `
    ${d.viaAdr ? `<div class="msg">Estados de la SEC y precio de <b>${esc(d.viaAdr)}</b>, que cotiza en EE.UU. (${esc(d.empresa)}).</div>` : ""}
    ${v && d.avisoValuacion ? `<div class="msg">${esc(d.avisoValuacion)}</div>` : ""}
    <div class="grupo-titulo">Valuación · ${esc(v?.base || t.base)}</div>
    ${v ? `<div class="kpis compactos">
      ${kpi("Capitalización", grande(v.capitalizacion), `${esc(v.moneda)} · precio ${precio(v.precio)}`)}
      ${kpi("PER", veces(v.per), "precio / beneficio 12m")}
      ${kpi("Precio / ventas", veces(v.precioVentas, 2))}
      ${kpi("EV / EBITDA", veces(v.evEbitda), `EV ${grande(v.ev)}`)}
      ${kpi("EV / EBIT", veces(v.evEbit))}
      ${kpi("Precio / libro", veces(v.precioLibro))}
      ${kpi("Rentab. del FCF", pct(v.rentabilidadFcf), "FCF / capitalización", v.rentabilidadFcf > 5 ? "up" : v.rentabilidadFcf < 2 ? "down" : "")}
      ${kpi("Retorno al accionista", pct(v.rentabilidadAccionista), "recompras + dividendos")}
      ${kpi("Dilución anual", pct(d.dilucionAnual, 2), "acciones, promedio", d.dilucionAnual > 1 ? "down" : "up")}
    </div>` : `<div class="msg">${esc(d.avisoValuacion || "Sin valuación.")}</div>`}
    <div class="grupo-titulo">Últimos 12 meses</div>
    <div class="kpis compactos">
      ${kpi("Ingresos", grande(t.ingresos), `crec. ${pctS(t.crecimiento, 1)}`, cls(t.crecimiento))}
      ${kpi("Margen bruto", pct(t.margenBruto))}${kpi("Margen operativo", pct(t.margenOperativo))}${kpi("Margen neto", pct(t.margenNeto))}
      ${kpi("Flujo de caja libre", grande(t.fcf), `margen ${pct(t.margenFcf)}`)}
      ${kpi("ROIC aprox.", pct(t.roic), "", t.roic >= 15 ? "up" : t.roic < 8 ? "down" : "")}
      ${kpi("Deuda neta", grande(t.deudaNeta), `${veces(t.deudaNetaEbitda, 2)} EBITDA`, t.deudaNeta < 0 ? "up" : "")}
      ${kpi("BPA 12m", num(t.bpa, 2))}
    </div>`;

  const tablas = el.querySelector("[data-tablas]");
  let modo = "anual";
  const pintar = () => {
    const anual = modo === "anual";
    const cols = anual ? d.filas : d.trimestral;
    const defs = anual ? FILAS : FILAS_Q;
    const titulo = (x) => (anual ? `${x.fy}` : fecha(x.fin).slice(3));
    tablas.innerHTML = tarjeta(`${d.empresa} · ${anual ? "ejercicios fiscales" : "últimos trimestres"}`, `
      ${cols.length ? `<div class="tabla-scroll"><table><thead><tr><th>Métrica</th>${cols.map((x) => `<th class="n">${esc(titulo(x))}</th>`).join("")}${anual ? `<th class="n">12m</th>` : ""}</tr></thead><tbody>
      ${defs.map(([n, k, fmt, c]) => `<tr><td>${esc(n)}</td>${cols.map((x) => `<td class="n ${c ? c(x[k]) : ""}">${fmt(x[k])}</td>`).join("")}${anual ? `<td class="n ${c ? c(t[k]) : ""}"><b>${fmt(t[k])}</b></td>` : ""}</tr>`).join("")}
      </tbody></table></div>` : `<div class="msg">Esta empresa no publica trimestres en formato XBRL (es habitual en emisores extranjeros que presentan 20-F).</div>`}
      ${!anual && cols.length ? `<div data-g style="margin-top:14px"></div>` : ""}
      <p class="nota">Fuente: ${esc(d.fuente)}. El ROIC usa resultado operativo después de impuestos sobre patrimonio + deuda − caja: aproximación, no definición contable. El cuarto trimestre y el flujo de caja trimestral se reconstruyen restando acumulados. ${d.splits?.length ? `BPA y acciones ajustados por split (${d.splits.map((s) => `${fecha(s.d)} ${num(s.factor, 0)}:1`).join(", ")}).` : ""}</p>`, {
      acciones: `<div class="segmentos" data-modo><button data-v="anual" aria-pressed="${anual}">Anual</button><button data-v="trim" aria-pressed="${!anual}">Trimestral</button></div><button class="btn chico" data-csv>CSV</button>`
    });
    tablas.querySelector("[data-modo]").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { modo = b.dataset.v === "anual" ? "anual" : "trim"; pintar(); } });
    tablas.querySelector("[data-csv]").addEventListener("click", () => {
      descargarCsv(`${d.ticker}-${anual ? "anual" : "trimestral"}`, ["Métrica", ...cols.map(titulo)], defs.map(([n, k]) => [n, ...cols.map((x) => x[k])]));
    });
    if (!anual && cols.length) {
      graficoBarras(tablas.querySelector("[data-g]"), cols.map((q) => ({ etiqueta: fecha(q.fin).slice(3), v: q.ingresos, color: "var(--c1)" })), { alto: 160, fmt: grande });
    }
  };
  pintar();
}

function pintarConsenso(el, c) {
  const o = c.objetivo || {};
  const t = c.tendencia?.find((x) => x.periodo === "0m") || c.tendencia?.[0];
  const perfil = c.perfil || {};
  if (perfil.descripcion || perfil.sector) {
    el.querySelector("[data-perfil]").innerHTML = tarjeta(perfil.sector ? `${perfil.sector} · ${perfil.industria || ""}` : "Perfil", `
      ${perfil.descripcion ? `<p class="descripcion" data-desc>${esc(perfil.descripcion)}</p><button class="btn chico" data-mas style="margin-top:6px">Ver más</button>` : ""}
      <p class="nota">${[perfil.pais, perfil.empleados ? `${num(perfil.empleados, 0)} empleados` : "", perfil.web ? `<a href="${enlace(perfil.web)}" target="_blank" rel="noopener">${esc(perfil.web.replace(/^https?:\/\//, ""))}</a>` : ""].filter(Boolean).join(" · ")}</p>`);
    el.querySelector("[data-mas]")?.addEventListener("click", (e) => { el.querySelector("[data-desc]").classList.toggle("abierta"); e.target.textContent = e.target.textContent === "Ver más" ? "Ver menos" : "Ver más"; });
  }
  const total = t ? t.compraFuerte + t.compra + t.mantener + t.venta + t.ventaFuerte : 0;
  const seg = (n, col, et) => (n ? `<span style="width:${(n / total) * 100}%;background:${col}" title="${et}: ${n}">${n}</span>` : "");
  const k = c.clave || {};
  el.querySelector("[data-cons]").innerHTML = `
    <div class="grid2 bloque">
      ${tarjeta("Consenso de analistas", `
        ${c.aviso ? `<div class="msg">${esc(c.aviso)}</div>` : ""}
        <div class="kpis compactos">
          ${kpi("Recomendación", REC[c.recomendacionClave] || "—", `media ${num(c.recomendacionMedia, 2)} (1 compra · 5 venta)`)}
          ${kpi("Analistas", c.analistas ?? "—")}
          ${kpi("Próximo balance", fecha(c.proximoBalance))}
          ${o.medio ? kpi("Objetivo medio", precio(o.medio), c.precio ? `${pctS((o.medio / c.precio - 1) * 100, 1)} vs precio` : "", c.precio ? cls(o.medio - c.precio) : "") : ""}
        </div>
        ${o.bajo && o.alto && c.precio ? `<div class="grupo-titulo">Rango de precios objetivo</div>${barraRango(Math.min(o.bajo, c.precio), Math.max(o.alto, c.precio), c.precio, [{ v: o.medio, t: "medio", eje: true }], { fmt: precio, invertir: true })}` : ""}
        ${t && total ? `<div class="grupo-titulo" style="margin-top:12px">Distribución de recomendaciones</div>
          <div class="barra-apilada">${seg(t.compraFuerte, "#1f9d63", "Compra fuerte")}${seg(t.compra, "#5fbf8a", "Compra")}${seg(t.mantener, "#8a93a3", "Mantener")}${seg(t.venta, "#e08a5c", "Venta")}${seg(t.ventaFuerte, "#d9475b", "Venta fuerte")}</div>
          <div class="leyenda"><span><i style="background:#1f9d63"></i>compra fuerte</span><span><i style="background:#5fbf8a"></i>compra</span><span><i style="background:#8a93a3"></i>mantener</span><span><i style="background:#e08a5c"></i>venta</span><span><i style="background:#d9475b"></i>venta fuerte</span></div>` : ""}
        <p class="nota">Fuente: ${esc(c.fuente)}. Es lo que publican los analistas de los brokers; <b>no es una recomendación de esta herramienta</b>. El consenso suele ser optimista y llega tarde a los cambios.</p>`)}
      ${tarjeta("Estimaciones y sorpresas", `
        ${c.estimaciones?.length ? `<div class="tabla-scroll"><table><thead><tr><th>Período</th><th class="n">BPA est.</th><th class="n">Crec.</th><th class="n">Ingresos est.</th><th class="n">Rev. 30d</th></tr></thead><tbody>
          ${c.estimaciones.map((e) => `<tr><td>${esc(e.periodo)}<span class="sub">${esc(e.fin || "")}</span></td><td class="n">${num(e.bpa, 2)}</td><td class="n ${cls(e.crecimientoBpa)}">${pctS(e.crecimientoBpa, 1)}</td><td class="n">${grande(e.ingresos)}</td>
            <td class="n"><span class="up">▲${e.revSuben30 ?? 0}</span> <span class="down">▼${e.revBajan30 ?? 0}</span></td></tr>`).join("")}</tbody></table></div>` : ""}
        ${c.historia?.length ? `<div class="grupo-titulo" style="margin-top:12px">Últimos balances: BPA real vs estimado</div><table><thead><tr><th>Trimestre</th><th class="n">Real</th><th class="n">Estimado</th><th class="n">Sorpresa</th></tr></thead><tbody>
          ${c.historia.map((h) => `<tr><td>${fecha(h.trimestre)}</td><td class="n">${num(h.real, 2)}</td><td class="n">${num(h.estimado, 2)}</td><td class="n ${cls(h.sorpresaPct)}">${pctS(h.sorpresaPct, 1)}</td></tr>`).join("")}</tbody></table>` : ""}
        ${!c.estimaciones?.length && !c.historia?.length ? `<p class="vacio">Sin estimaciones publicadas.</p>` : ""}`)}
    </div>
    ${(k.perForward || k.cortoSobreFlotante || c.cambios?.length) ? `<div class="grid2 bloque">
      ${tarjeta("Otros datos de mercado", `<div class="kpis compactos" style="margin:0">
        ${kpi("PER futuro", veces(k.perForward), "sobre BPA estimado")}${kpi("PEG", num(k.peg, 2))}${kpi("Beta", num(k.beta, 2))}
        ${kpi("Venta en corto", pct(k.cortoSobreFlotante), `del flotante · ${num(k.diasParaCubrir, 1)} días`)}
        ${kpi("Insiders", pct(k.insiders))}${kpi("Institucionales", pct(k.institucionales))}
      </div>`)}
      ${c.cambios?.length ? tarjeta("Cambios recientes de calificación", `<div class="tabla-scroll"><table><tbody>${c.cambios.map((x) => `<tr><td class="n" style="text-align:left">${fecha(x.fecha)}</td><td>${esc(x.firma)}</td><td>${esc(x.desde || "—")} → <b>${esc(x.hacia)}</b></td><td class="faint">${esc({ up: "sube", down: "baja", main: "mantiene", init: "inicia", reit: "reitera" }[x.accion] || x.accion || "")}</td></tr>`).join("")}</tbody></table></div>`) : "<div></div>"}
    </div>` : ""}`;
}

/* ------------------------------------------------- estados financieros */

const ESTADOS_TXT = { resultados: "Estado de resultados", balance: "Balance general", flujo: "Flujo de efectivo" };

async function estadosFinancieros(cont, ctx) {
  cont.innerHTML = tarjeta("Estados financieros", cargando("Armando estado de resultados, balance y flujo de efectivo…"));
  let d;
  try { d = await ctx.memo("estados", () => api(`/api/estados?t=${encodeURIComponent(ctx.ticker)}`)); }
  catch (e) { cont.innerHTML = tarjeta("Estados financieros", `<div class="msg">No disponibles: ${esc(e.message)}</div>`); return; }
  let estado = pref("estados.tab", "resultados"), modo = pref("estados.modo", "anual"), vertical = pref("estados.vertical", false);
  const pintar = () => {
    const bloque = d[modo];
    if (!bloque.columnas.length) { modo = "anual"; }
    const cols = d[modo].columnas, lineas = d[modo].estados[estado] || [];
    /* Análisis vertical: cada línea como % de los ingresos (resultados y
       flujo) o del activo total (balance). */
    const baseK = estado === "balance" ? "activo" : "ingresos";
    const base = (d[modo].estados[estado === "flujo" ? "resultados" : estado] || []).find((l) => l.k === baseK)?.valores || [];
    const fmt = (l, v, i) => {
      if (v === null || v === undefined) return "—";
      if (vertical && !l.sinVertical) return base[i] ? pct((v / Math.abs(base[i])) * 100, 1) : "—";
      if (l.ratio) return num(v, 2);
      if (l.tipo === "bpa") return num(v, 2);
      return grande(v);
    };
    const titulo = (c) => (modo === "anual" ? c.slice(0, 4) : fecha(c).slice(3));
    cont.innerHTML = tarjeta(`Estados financieros · ${esc(d.empresa)}`, `
      ${subtabs("estados", Object.entries(ESTADOS_TXT), estado)}
      ${lineas.length ? `<div class="tabla-scroll"><table class="estados"><thead><tr><th>${esc(d.moneda)}</th>${cols.map((c) => `<th class="n" title="${esc(c)}">${esc(titulo(c))}</th>`).join("")}</tr></thead><tbody>
        ${lineas.map((l) => `<tr class="${l.total ? "total" : ""} ${l.separador ? "separador" : ""} ${l.ratio ? "ratio" : ""}"><td>${esc(l.t)}${l.calculada ? ` <span class="faint" title="Calculada a partir de otras líneas">·</span>` : ""}</td>${l.valores.map((v, i) => `<td class="n ${v < 0 ? "down" : ""}">${fmt(l, v, i)}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>` : `<p class="vacio">Sin datos de este estado para ${esc(d.ticker)}${modo === "trimestral" ? " en formato trimestral" : ""}.</p>`}
      <p class="nota">Fuente: ${esc(d.fuente)}${d.viaAdr ? ` (emisor ${esc(d.viaAdr)})` : ""}. Las salidas de fondos y los costos van en negativo. Las líneas marcadas con · son calculadas (por ejemplo, el resultado bruto o el pasivo total cuando la empresa no los informa). En trimestral, el flujo de efectivo y el cuarto trimestre se reconstruyen restando acumulados.</p>`, {
      acciones: `<div class="segmentos" data-modo><button data-v="anual" aria-pressed="${modo === "anual"}">Anual</button><button data-v="trimestral" aria-pressed="${modo === "trimestral"}">Trimestral</button></div>
        <label class="chk"><input type="checkbox" data-vertical ${vertical ? "checked" : ""}>Análisis vertical</label><button class="btn chico" data-csv>CSV</button>`
    });
    enlazarSubtabs(cont, "estados", (k) => { estado = k; setPref("estados.tab", k); pintar(); });
    cont.querySelector("[data-modo]").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { modo = b.dataset.v; setPref("estados.modo", modo); pintar(); } });
    cont.querySelector("[data-vertical]").addEventListener("change", (e) => { vertical = e.target.checked; setPref("estados.vertical", vertical); pintar(); });
    cont.querySelector("[data-csv]").addEventListener("click", () => {
      descargarCsv(`${d.ticker}-${estado}-${modo}`, [`Línea (${d.moneda})`, ...cols], lineas.map((l) => [l.t, ...l.valores]));
    });
  };
  pintar();
}
