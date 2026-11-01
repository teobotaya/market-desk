import { esc, enlace, num, grande, precio, fecha, cargando, errorHtml, api, tarjeta, kpi, subtabs, enlazarSubtabs, pref, setPref, tablaOrdenable } from "../util.js";
import { dossier } from "../dossier.js";

export default {
  id: "sec",
  titulo: "SEC: riesgos, filings e insiders",
  icono: "§",
  requiereTicker: true,
  descripcion: "Factores de riesgo del último 10-K (o 20-F) comparados con el informe anterior, presentaciones recientes con los hechos relevantes destacados, y compras y ventas de directivos (formulario 4). Todo directo de SEC EDGAR, sin clave.",

  async render(el, ctx) {
    const activa = pref("sec.tab", "riesgos");
    el.innerHTML = `${subtabs("sec", [["riesgos", "Factores de riesgo"], ["filings", "Presentaciones"], ["insiders", "Insiders"]], activa)}<div data-tab></div>`;
    const cont = el.querySelector("[data-tab]");
    const abrir = (k) => {
      setPref("sec.tab", k);
      cont.innerHTML = "";
      const div = document.createElement("div");
      cont.appendChild(div);
      ({ riesgos, filings, insiders })[k](div, ctx);
    };
    enlazarSubtabs(el, "sec", abrir);
    abrir(activa);
  }
};

async function riesgos(el, ctx) {
  el.innerHTML = cargando("Bajando el informe anual y el del año anterior para compararlos (son documentos grandes)…");
  let d;
  try { d = await ctx.memo("10k", () => api(`/api/risk?t=${encodeURIComponent(ctx.ticker)}`)); }
  catch (e) { el.innerHTML = errorHtml(e); return; }
  const esp = d.risks.filter((r) => r.kind === "especifico");
  const gen = d.risks.filter((r) => r.kind === "generico");
  const mix = d.risks.filter((r) => r.kind === "mixto");
  const nuevos = d.risks.filter((r) => r.nuevo);
  const temas = {};
  for (const r of d.risks) for (const t of r.temas) temas[t] = (temas[t] || 0) + 1;

  const lista = (arr, titulo, abierto = false) => arr.length ? `<details class="card" ${abierto ? "open" : ""}><summary style="cursor:pointer"><b>${esc(titulo)}</b> <span class="etiqueta">${arr.length}</span></summary>
    <div class="tabla-scroll" style="margin-top:10px"><table><tbody>${arr.slice(0, 40).map((r) => `<tr><td>
      ${r.nuevo ? `<span class="etiqueta nuevo">nuevo</span>` : ""}${r.temas.map((t) => `<span class="etiqueta">${esc(t)}</span>`).join("")}
      <div><b>${esc(r.heading)}</b></div><details><summary class="faint" style="cursor:pointer;font-size:12.5px">${esc(r.text.slice(0, 220))}…</summary><p style="font-size:13px;color:var(--muted)">${esc(r.text)}</p></details>
    </td></tr>`).join("")}</tbody></table></div></details>` : "";

  el.innerHTML = `
    ${d.viaAdr ? `<div class="msg">Informe del ADR <b>${esc(d.viaAdr)}</b>.</div>` : ""}
    <div class="kpis compactos">
      ${kpi("Documento", d.form, d.company)}${kpi("Presentado", fecha(d.filed), `período ${fecha(d.period)}`)}
      ${kpi("Específicos", String(esp.length), "de la empresa", "warn")}${kpi("Genéricos", String(gen.length), "boilerplate")}${kpi("Dudosos", String(mix.length), "a revisar")}
      ${d.comparado ? kpi("Nuevos vs año anterior", String(d.comparado.nuevos), `informe del ${fecha(d.comparado.filed)}`, d.comparado.nuevos ? "warn" : "") : ""}
    </div>
    <p class="nota" style="margin:-6px 0 14px"><a href="${enlace(d.url)}" target="_blank" rel="noopener">Abrir el documento en la SEC</a>${d.comparado ? ` · <a href="${enlace(d.comparado.url)}" target="_blank" rel="noopener">informe anterior</a>` : ""} · Temas: ${Object.entries(temas).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${esc(t)} (${n})`).join(", ") || "—"}. La clasificación es por reglas léxicas y falla en los dos sentidos: sirve para ordenar la lectura, no para saltearla.</p>
    ${lista(nuevos, "Riesgos nuevos respecto del informe anterior", true)}
    ${d.comparado?.eliminados?.length ? `<details class="card"><summary style="cursor:pointer"><b>Riesgos que ya no aparecen</b> <span class="etiqueta">${d.comparado.eliminados.length}</span></summary><ul>${d.comparado.eliminados.map((x) => `<li style="font-size:13px">${esc(x)}</li>`).join("")}</ul></details>` : ""}
    ${lista(esp, "Específicos de la empresa", !nuevos.length)}
    ${lista(mix, "Dudosos")}
    ${lista(gen, "Boilerplate genérico")}
    <div data-ia></div>`;

  const prompt =
`Analizá la sección de factores de riesgo del ${d.form} de ${d.company}, presentado el ${fecha(d.filed)}.

Una clasificación por reglas marcó ${esp.length} párrafos como específicos, ${gen.length} como boilerplate genérico y ${mix.length} dudosos. Verificá esa clasificación, no la asumas.
${d.comparado ? `Comparado con el informe del ${fecha(d.comparado.filed)}: ${d.comparado.nuevos} riesgos con título nuevo y ${d.comparado.eliminados.length} que desaparecieron.` : ""}

Devolvé:

1. LO QUE CAMBIÓ
   Riesgos nuevos o redacciones que se endurecieron. Un riesgo que aparece o gana detalle suele anticipar algo.

2. RIESGOS ESPECÍFICOS DE ESTA EMPRESA
   Los que no aparecerían en el informe de cualquier otra. Para cada uno: qué lo hace específico y qué magnitud declara (porcentajes, nombres, geografías).
   Atención a: concentración de clientes, proveedor o fábrica únicos, geografía concreta, contratos o licencias que puedan caerse.

3. CADENA DE SUMINISTRO Y GEOPOLÍTICA
   Proveedor único, concentración geográfica, controles de exportación, aranceles. Cuantificá lo que la empresa cuantifique.

4. BOILERPLATE
   Agrupalo y despachalo en pocas líneas, diciendo cuáles descartás.

5. LOS TRES QUE IMPORTAN
   Si tuvieras que vigilar solo tres, cuáles, y qué señal pública los dispararía.

RIESGOS NUEVOS:
${nuevos.slice(0, 15).map((r, i) => `${i + 1}. ${r.heading}\n${r.text.slice(0, 900)}`).join("\n\n") || "(ninguno detectado)"}

${d.comparado?.eliminados?.length ? `RIESGOS QUE DESAPARECIERON:\n${d.comparado.eliminados.map((x) => `- ${x}`).join("\n")}\n` : ""}
PÁRRAFOS ESPECÍFICOS:
${esp.filter((r) => !r.nuevo).slice(0, 20).map((r, i) => `${i + 1}. ${r.heading}\n${r.text.slice(0, 1200)}`).join("\n\n") || "(ninguno)"}

PÁRRAFOS DUDOSOS:
${mix.slice(0, 8).map((r, i) => `${i + 1}. ${r.heading}: ${r.text.slice(0, 500)}`).join("\n\n") || "(ninguno)"}`;
  dossier(el.querySelector("[data-ia]"), { titulo: "Factores de riesgo", prompt });
}

async function filings(el, ctx) {
  el.innerHTML = cargando("Bajando el índice de presentaciones…");
  let d;
  try { d = await ctx.memo("filings", () => api(`/api/filings?t=${encodeURIComponent(ctx.ticker)}`)); }
  catch (e) { el.innerHTML = errorHtml(e); return; }
  const criticos = d.filings.filter((f) => f.items.some((i) => i.critico));
  el.innerHTML = `
    <div class="kpis compactos">${kpi("Empresa", d.empresa, d.sic || "")}${kpi("CIK", d.cik)}${kpi("Presentaciones listadas", String(d.filings.length))}${kpi("Hechos críticos", String(criticos.length), "auditor, deterioro, ciberataque…", criticos.length ? "warn" : "")}</div>
    ${tarjeta("Presentaciones recientes", `<div data-t></div><p class="nota">Los ítems de los 8-K dicen de qué trata cada hecho relevante; en rojo, los que suelen merecer lectura inmediata (cambio de auditor, estados no confiables, deterioro, reestructuración, incidente de ciberseguridad, exclusión de cotización).</p>`)}`;
  tablaOrdenable(el.querySelector("[data-t]"), {
    columnas: [
      { k: "fecha", t: "Fecha", n: true, fmt: fecha },
      { k: "form", t: "Formulario", fmt: (v) => `<b>${esc(v)}</b>` },
      { k: "descripcion", t: "Qué es", fmt: (v, f) => `${esc(v)}${f.items.length ? `<span class="sub">${f.items.filter((i) => i.codigo !== "9.01").map((i) => `<span class="etiqueta ${i.critico ? "crit" : ""}">${esc(i.texto)}</span>`).join("")}</span>` : ""}` },
      { k: "periodo", t: "Período", n: true, fmt: fecha },
      { k: "url", t: "", fmt: (v) => `<a href="${enlace(v)}" target="_blank" rel="noopener">abrir</a>` }
    ],
    filas: d.filings, filtro: true, nombreCsv: `filings-${d.ticker}`, limite: 60
  });
}

async function insiders(el, ctx) {
  el.innerHTML = cargando("Leyendo los últimos formularios 4 (uno por uno, respetando el límite de la SEC)…");
  let d;
  try { d = await ctx.memo("insiders", () => api(`/api/insiders?t=${encodeURIComponent(ctx.ticker)}`)); }
  catch (e) { el.innerHTML = errorHtml(e); return; }
  if (!d.operaciones.length) { el.innerHTML = `<div class="msg">${esc(d.aviso || "Sin operaciones de insiders recientes.")}</div>`; return; }
  const r = d.resumen;
  const neto = r.montoCompras - r.montoVentas;
  el.innerHTML = `
    <div class="kpis compactos">
      ${kpi("Compras en mercado", String(r.compras), `${grande(r.montoCompras)} · ${r.compradores} personas`, r.compras ? "up" : "")}
      ${kpi("Ventas en mercado", String(r.ventas), `${grande(r.montoVentas)} · ${r.vendedores} personas`, r.ventas ? "down" : "")}
      ${kpi("Ventas planificadas", String(r.ventasPlanificadas), "bajo plan 10b5-1")}
      ${kpi("Neto", grande(neto), `${fecha(r.desde)} a ${fecha(r.hasta)}`, neto > 0 ? "up" : neto < 0 ? "down" : "")}
    </div>
    ${tarjeta("Operaciones declaradas", `<div data-t></div><p class="nota">Últimos ${d.leidos} formularios 4. <b>Una compra en mercado (P) dice más que una venta:</b> los directivos venden por muchas razones (impuestos, diversificación, planes 10b5-1 programados de antemano), pero compran por una sola. Otorgamientos y ejercicios de opciones son remuneración, no una señal.</p>`)}`;
  tablaOrdenable(el.querySelector("[data-t]"), {
    columnas: [
      { k: "fecha", t: "Fecha", n: true, fmt: fecha },
      { k: "nombre", t: "Quién", fmt: (v, f) => `${esc(v)}<span class="sub">${esc(f.relacion)}</span>` },
      { k: "tipo", t: "Operación", fmt: (v, f) => `<span class="etiqueta ${f.codigo === "P" ? "ok" : f.codigo === "S" ? "crit" : ""}">${esc(f.codigo)}</span>${esc(v)}${f.planificada ? ` <span class="faint">(10b5-1)</span>` : ""}` },
      { k: "acciones", t: "Acciones", n: true, fmt: (v) => num(v, 0) },
      { k: "precio", t: "Precio", n: true, fmt: (v) => (v ? precio(v) : "—") },
      { k: "monto", t: "Monto", n: true, fmt: (v) => (v ? grande(v) : "—") },
      { k: "tenenciaPosterior", t: "Tenencia después", n: true, fmt: grande },
      { k: "url", t: "", fmt: (v) => `<a href="${enlace(v)}" target="_blank" rel="noopener">form</a>` }
    ],
    filas: d.operaciones, filtro: true, nombreCsv: `insiders-${d.ticker}`
  });
}
