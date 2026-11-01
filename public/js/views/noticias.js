import { esc, enlace, num, cls, kpi, cargando, errorHtml, api, tarjeta, fechaHora, pref, setPref, qs } from "../util.js";
import { graficoBarras } from "../charts.js";
import { dossier } from "../dossier.js";

export default {
  id: "noticias",
  titulo: "Noticias y sentimiento",
  icono: "✎",
  requiereTicker: true,
  descripcion: "Titulares de Google News con una puntuación léxica en español e inglés. Sirve para ver el clima y la concentración de noticias, no para decidir: un léxico no entiende ironía ni contexto.",

  async render(el, ctx) {
    let nombre = ctx.ticker;
    try { const p = await ctx.precio(); nombre = (p.nombre || p.ticker).replace(/,?\s+(Inc|Corp|Corporation|S\.A\.|SA|Ltd|plc|Holdings?)\.?$/i, ""); } catch { /* usamos el ticker */ }
    const q0 = pref(`noticias.q.${ctx.ticker}`, nombre);
    el.innerHTML = `<section class="card"><div class="fila" style="margin:0">
        <input data-q value="${esc(q0)}" style="width:300px" aria-label="Qué buscar">
        <select data-lang aria-label="Idioma"><option value="es"${pref("noticias.lang", "es") === "es" ? " selected" : ""}>Español (Argentina)</option><option value="en"${pref("noticias.lang", "es") === "en" ? " selected" : ""}>Inglés (EE.UU.)</option></select>
        <select data-dias aria-label="Período">${[[3, "3 días"], [7, "7 días"], [14, "14 días"], [30, "30 días"]].map(([d, t]) => `<option value="${d}"${d === pref("noticias.dias", 14) ? " selected" : ""}>${t}</option>`).join("")}</select>
        <button class="btn primario" data-buscar>Buscar</button>
      </div></section><div data-out></div><div data-ia></div>`;
    const buscar = async () => {
      const q = el.querySelector("[data-q]").value.trim(), lang = el.querySelector("[data-lang]").value, days = Number(el.querySelector("[data-dias]").value);
      setPref(`noticias.q.${ctx.ticker}`, q); setPref("noticias.lang", lang); setPref("noticias.dias", days);
      const out = el.querySelector("[data-out]");
      out.innerHTML = cargando("Buscando titulares…");
      el.querySelector("[data-ia]").innerHTML = "";
      try {
        const d = await api(`/api/news?${qs({ q, days, lang })}`);
        pintar(el, d);
      } catch (e) { out.innerHTML = errorHtml(e); }
    };
    el.querySelector("[data-buscar]").addEventListener("click", buscar);
    el.querySelector("[data-q]").addEventListener("keydown", (e) => { if (e.key === "Enter") buscar(); });
    await buscar();
  }
};

function pintar(el, d) {
  const s = d.summary;
  const out = el.querySelector("[data-out]");
  out.innerHTML = `
    <div class="kpis compactos">
      ${kpi("Titulares", String(s.total), `últimos ${d.days} días`)}${kpi("Positivos", String(s.pos), "", "up")}${kpi("Negativos", String(s.neg), "", "down")}
      ${kpi("Neto", `${s.net > 0 ? "+" : ""}${s.net}`, "positivos − negativos", cls(s.net))}${kpi("Medio principal", d.medios[0]?.medio || "—", d.medios[0] ? `${d.medios[0].n} titulares` : "")}
    </div>
    <div class="grid2 bloque">
      ${tarjeta("Titulares por día", `<div data-g></div><p class="nota">Color según el neto léxico del día.</p>`)}
      ${tarjeta("Medios", `<table><tbody>${d.medios.map((m) => `<tr><td>${esc(m.medio)}</td><td class="n">${m.n}</td></tr>`).join("")}</tbody></table><p class="nota">Si un medio concentra la cobertura, la muestra está sesgada.</p>`)}
    </div>
    ${tarjeta("Titulares", `<div class="tabla-scroll"><table><tbody>${d.items.slice(0, 50).map((i) => `<tr><td class="n ${cls(i.score)}" style="text-align:left;width:34px">${i.score > 0 ? "+" : ""}${i.score}</td>
      <td><a href="${enlace(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a><span class="sub">${esc(i.source)} · ${esc(fechaHora(i.date))}</span></td></tr>`).join("")}</tbody></table></div>`)}`;
  graficoBarras(out.querySelector("[data-g]"), d.timeline.map((t) => ({ etiqueta: t.day.slice(8, 10) + "/" + t.day.slice(5, 7), v: t.n, color: t.score > 0 ? "var(--up)" : t.score < 0 ? "var(--down)" : "var(--faint)", titulo: `${t.day}: ${t.n} titulares, neto ${t.score}` })), { alto: 150, fmt: (v) => num(v, 0) });

  const prompt =
`Resumí el sentimiento de mercado sobre "${d.query}" con base en estos ${s.total} titulares de los últimos ${d.days} días.

Recuento léxico crudo: ${s.pos} positivos, ${s.neg} negativos, ${s.neutral} neutros, neto ${s.net}. Tomalo como ruido de fondo: un léxico no entiende ironía, contexto ni si la noticia ya estaba en precio.
Medios con más titulares: ${d.medios.slice(0, 5).map((m) => `${m.medio} (${m.n})`).join(", ")}.

Devolvé:
1. EL CLIMA EN DOS FRASES: qué está descontando el mercado ahora mismo.
2. LOS TRES TEMAS QUE DOMINAN: con los titulares que los sostienen y si empujan al alza o a la baja.
3. QUÉ CAMBIÓ EN ESTAS SEMANAS: quiebre de narrativa y qué titular lo marca.
4. LO QUE NADIE ESTÁ MIRANDO: un titular de baja repercusión que podría importar más de lo que parece.
5. SESGO DE LA MUESTRA: fuentes ausentes, sobrerrepresentación de un medio, cobertura concentrada en un día.

TITULARES:
${d.items.map((i) => `- ${i.title} — ${i.source} (${(i.date || "").slice(0, 10)})`).join("\n")}`;
  dossier(el.querySelector("[data-ia]"), { titulo: "Sentimiento", prompt });
}
