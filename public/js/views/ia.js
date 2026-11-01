import { esc, pct, pctS, grande, veces, cls, kpi, cargando, errorHtml, api, tarjeta, pref, setPref, qs } from "../util.js";
import { dossier } from "../dossier.js";
import { bloquePrecio, bloqueFundamentales, bloqueConsenso, REGLAS } from "./comun.js";

const sinError = (p) => p.then((v) => v, () => null);

/* ------------------------------------------------------------------ tesis */

export const tesis = {
  id: "tesis",
  titulo: "Red team de la tesis",
  icono: "✦",
  requiereTicker: true,
  descripcion: "Escribí tu tesis en una o dos frases. La app la empaqueta con precio, fundamentales, consenso y titulares recientes, y arma el prompt para que un modelo busque lo que la refutaría, no lo que la confirma.",

  async render(el, ctx) {
    el.innerHTML = `
      <textarea data-tesis placeholder="Ej.: Compro ${esc(ctx.ticker)} a tres meses porque el guidance de la última call superó lo esperado y el sector viene de una corrección exagerada.">${esc(pref(`tesis.${ctx.ticker}`, ""))}</textarea>
      <div class="fila" style="margin-top:10px">
        <label>Horizonte <select data-h>${["dos semanas", "un mes", "tres meses", "seis meses", "un año o más"].map((h) => `<option${h === pref("tesis.h", "tres meses") ? " selected" : ""}>${h}</option>`).join("")}</select></label>
        <label class="chk"><input type="checkbox" data-inc="fund" checked>Fundamentales</label>
        <label class="chk"><input type="checkbox" data-inc="cons" checked>Consenso</label>
        <label class="chk"><input type="checkbox" data-inc="news" checked>Titulares</label>
        <button class="btn primario" data-armar>Armar dossier</button>
      </div>
      <div data-out></div>`;
    el.querySelector("[data-armar]").addEventListener("click", async () => {
      const t = el.querySelector("[data-tesis]").value.trim();
      const out = el.querySelector("[data-out]");
      if (!t) { out.innerHTML = `<div class="msg err">Escribí la tesis primero.</div>`; return; }
      setPref(`tesis.${ctx.ticker}`, t);
      const h = el.querySelector("[data-h]").value; setPref("tesis.h", h);
      const inc = (k) => el.querySelector(`[data-inc="${k}"]`).checked;
      out.innerHTML = cargando("Juntando datos…");
      const [p, f, c] = await Promise.all([
        sinError(ctx.precio()),
        inc("fund") ? sinError(ctx.memo("fund", () => api(`/api/fundamentales?t=${encodeURIComponent(ctx.ticker)}`))) : null,
        inc("cons") ? sinError(ctx.memo("consenso", () => api(`/api/consenso?t=${encodeURIComponent(ctx.ticker)}`))) : null
      ]);
      const n = inc("news") ? await sinError(api(`/api/news?${qs({ q: (p?.nombre || ctx.ticker).replace(/,?\s+(Inc|Corp|Corporation)\.?$/i, ""), days: 14, lang: "es" })}`)) : null;
      out.innerHTML = "";
      const prompt =
`Actuá como un analista escéptico haciendo red team. Tu trabajo NO es validar la tesis: es encontrar por dónde se rompe.

TESIS DEL ANALISTA (horizonte: ${h}):
${t}

DATOS DE PRECIO
${p ? bloquePrecio(p) : "(no disponibles)"}
${f ? `\nFUNDAMENTALES\n${bloqueFundamentales(f)}` : ""}
${c ? `\nCONSENSO\n${bloqueConsenso(c)}` : ""}
${n ? `\nTITULARES RECIENTES\n${n.items.slice(0, 15).map((i) => `- [${i.score > 0 ? "+" : i.score < 0 ? "−" : "0"}] ${i.title} (${i.source})`).join("\n")}` : ""}

Respondé con esta estructura, sin relleno:

1. QUÉ TIENE QUE PASAR PARA QUE LA TESIS SEA CIERTA
   Supuestos implícitos, incluidos los que no están escritos. Marcá el más frágil.

2. POR DÓNDE SE ROMPE
   Tres escenarios concretos de refutación, cada uno con el dato observable que lo anticiparía y en qué plazo se vería.

3. RIESGOS QUE LA TESIS IGNORA
   Separados en empresa, sector y macro/regulatorio. Para cada uno: por qué importa en este horizonte.

4. LO QUE CONTRADICE A LA TESIS EN LOS DATOS DE ARRIBA
   Cifras exactas en contra. Si no hay, decilo.

5. EL CONSENSO
   ¿La tesis es consenso o contraria? Si es consenso, qué parte ya está en el precio.

6. QUÉ FALTA SABER
   El dato, que no está acá, que más cambiaría la evaluación.

${REGLAS}`;
      dossier(out, { titulo: "Red team", prompt });
    });
  }
};

/* -------------------------------------------------------- earnings call */

const CUE = ["expect", "outlook", "guidance", "guide", "anticipate", "forecast", "next quarter", "next year", "fiscal", "will be", "we plan", "target", "going forward", "upcoming",
  "esperamos", "perspectiva", "guía", "proyect", "próximo trimestre", "próximo año", "objetivo", "prevemos", "anticipamos"];
const NEGW = ["decline", "decrease", "weak", "soft", "headwind", "challenging", "challenge", "pressure", "slowdown", "slower", "miss", "below", "uncertain", "cautious", "delay", "shortage", "impairment", "loss", "restructuring", "layoff", "inventory correction", "deceleration", "normalization", "digestion", "moderation",
  "caída", "disminu", "débil", "presión", "desaceler", "incertidumbre", "cautel", "demora", "pérdida", "reestructur", "deterioro"];
const POSW = ["record", "strong", "strength", "growth", "grew", "accelerat", "beat", "exceeded", "above", "robust", "demand", "expansion", "improv", "momentum", "upside", "raise", "confident",
  "récord", "fuerte", "crecimiento", "creci", "aceler", "superó", "sólid", "mejora", "confia"];

export const call = {
  id: "call",
  titulo: "Earnings call",
  icono: "☏",
  requiereTicker: true,
  descripcion: "Pegá la transcripción (en inglés o español). El análisis léxico corre en tu navegador: separa el lenguaje prospectivo, mide el tono, marca las citas más negativas y estima la dirección de la guía. El prompt pide lo que un léxico no ve: eufemismos y preguntas esquivadas.",

  async render(el, ctx) {
    el.innerHTML = `<textarea data-tr placeholder="Pegá acá la transcripción completa de la earnings call de ${esc(ctx.ticker)}…"></textarea>
      <div class="fila" style="margin-top:10px"><button class="btn primario" data-go>Analizar</button><span class="nota" style="margin:0">Las transcripciones no tienen fuente libre: se consiguen en el sitio de relación con inversores de cada empresa.</span></div>
      <div data-out></div>`;
    el.querySelector("[data-go]").addEventListener("click", () => {
      const raw = el.querySelector("[data-tr]").value.trim();
      const out = el.querySelector("[data-out]");
      if (raw.length < 400) { out.innerHTML = `<div class="msg err">Pegá la transcripción completa (al menos unos párrafos).</div>`; return; }
      const frases = raw.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ"“¿¡])/).filter((s) => s.length > 40);
      const score = (s) => { const w = s.toLowerCase(); let v = 0; for (const x of NEGW) if (w.includes(x)) v--; for (const x of POSW) if (w.includes(x)) v++; return v; };
      const scored = frases.map((s) => ({ s, v: score(s), fwd: CUE.some((c) => s.toLowerCase().includes(c)) }));
      const fwd = scored.filter((x) => x.fwd);
      const net = scored.reduce((a, b) => a + b.v, 0), netFwd = fwd.reduce((a, b) => a + b.v, 0);
      const peores = [...scored].sort((a, b) => a.v - b.v).slice(0, 3).filter((x) => x.v < 0);
      const dir = netFwd > 2 ? "alcista" : netFwd < -2 ? "bajista" : "neutra";
      const tono = net > 3 ? "positivo" : net < -3 ? "negativo" : "mixto";
      out.innerHTML = `<div class="kpis compactos" style="margin-top:14px">
          ${kpi("Tono general", tono, `neto ${net}`, tono === "negativo" ? "down" : tono === "positivo" ? "up" : "warn")}
          ${kpi("Dirección de la guía", dir, `neto prospectivo ${netFwd}`, dir === "bajista" ? "down" : dir === "alcista" ? "up" : "warn")}
          ${kpi("Frases analizadas", String(scored.length), `${fwd.length} prospectivas`)}
        </div>
        ${tarjeta(peores.length ? "Las citas más negativas" : "Citas negativas", peores.length
          ? peores.map((x) => `<p class="quote">“${esc(x.s)}”<small>puntuación ${x.v}${x.fwd ? " · lenguaje prospectivo" : ""}</small></p>`).join("")
          : `<p class="vacio">El léxico no encontró frases claramente negativas. Eso no significa que la call sea buena: puede estar escrita con eufemismos, que es justamente lo que conviene mandarle al modelo.</p>`)}`;
      const prompt =
`Analizá esta transcripción de earnings call de ${ctx.ticker}. El análisis léxico previo dio: tono ${tono} (neto ${net}), dirección de la guía ${dir} (neto prospectivo ${netFwd}), sobre ${scored.length} frases, ${fwd.length} con lenguaje prospectivo. Tomalo como señal cruda, no como conclusión.

Devolvé:

1. TONO REAL DE LA CALL
   Positivo, negativo o mixto, y por qué. Atención a los eufemismos: "normalización", "digestión de inventario", "moderación" suelen ser malas noticias en vocabulario amable.

2. TRES CITAS TEXTUALES QUE IMPORTAN
   Exactamente tres, entre comillas, sin parafrasear, con quién las dijo si figura. Las que más información traen, no las más dramáticas.
   Candidatas del léxico:
${peores.map((x, i) => `   ${i + 1}. "${x.s}"`).join("\n") || "   (ninguna)"}

3. DIRECCIÓN QUE MARCA LA EMPRESA
   Guía de ingresos, márgenes, capex y demanda para el próximo trimestre y el año. Alcista, bajista o neutra, y qué frase exacta lo sostiene.

4. LO QUE ESQUIVARON
   Preguntas de analistas respondidas de forma vaga o no respondidas.

5. DIVERGENCIA
   Dónde el discurso se contradice con los números que ellos mismos dieron.

Reglas: citas textuales siempre entre comillas; si algo no está en la transcripción, decí que no está en vez de inferirlo.

TRANSCRIPCIÓN:
${raw.length > 80000 ? `${raw.slice(0, 80000)}\n\n[...truncada a 80.000 caracteres...]` : raw}`;
      dossier(out, { titulo: "Earnings call", prompt });
    });
  }
};

/* -------------------------------------------------------------- foso */

export const foso = {
  id: "foso",
  titulo: "Foso competitivo",
  icono: "⛨",
  requiereTicker: true,
  descripcion: "Compara la empresa contra un competidor en los tres ejes que sostienen un foso: poder de fijación de precios, costos de cambio y propiedad intelectual. Márgenes, ROIC e I+D de la SEC dan la evidencia; el juicio lo aporta el modelo.",

  async render(el, ctx) {
    el.innerHTML = `<section class="card"><div class="fila" style="margin:0">
        <label>Competidor <input class="tk" data-rival value="${esc(pref(`foso.${ctx.ticker}`, ""))}" placeholder="AMD"></label>
        <button class="btn primario" data-cmp>Comparar</button><span class="nota" data-est style="margin:0"></span>
      </div></section><div data-out></div>`;
    const rivalInp = el.querySelector("[data-rival]");
    if (!rivalInp.value) {
      el.querySelector("[data-est]").textContent = "Buscando un competidor sugerido…";
      try { const r = await api(`/api/pares?t=${encodeURIComponent(ctx.ticker)}`); rivalInp.value = r.pares[0] || ""; el.querySelector("[data-est]").textContent = r.pares.length ? `Sugerido por ${r.fuente}; cambialo si no es el rival real.` : ""; }
      catch { el.querySelector("[data-est]").textContent = ""; }
    }
    const comparar = async () => {
      const rival = rivalInp.value.trim().toUpperCase();
      const out = el.querySelector("[data-out]");
      if (!rival) { out.innerHTML = `<div class="msg err">Escribí un competidor.</div>`; return; }
      setPref(`foso.${ctx.ticker}`, rival);
      out.innerHTML = cargando("Bajando precios y estados financieros de las dos empresas…");
      const [a, b, fa, fb] = await Promise.all([
        sinError(ctx.precio()), sinError(api(`/api/price?t=${encodeURIComponent(rival)}`)),
        sinError(ctx.memo("fund", () => api(`/api/fundamentales?t=${encodeURIComponent(ctx.ticker)}`))), sinError(api(`/api/fundamentales?t=${encodeURIComponent(rival)}`))
      ]);
      if (!a || !b) { out.innerHTML = errorHtml(new Error(`No pude cargar ${!a ? ctx.ticker : rival}.`)); return; }
      /* Retornos con signo y color; la volatilidad es una magnitud, va sin signo. */
      const filasPx = [["1 mes", "ret21"], ["3 meses", "ret63"], ["En el año", "retYtd"], ["1 año", "ret252"], ["Volatilidad 63 ruedas", "vol63", true], ["Desde máx. 52 sem.", "fromHigh"], ["Caída máx. 1 año", "maxDrawdown"]];
      const celda = (s, k, magnitud) => (magnitud ? `<td class="n">${pct(s[k])}</td>` : `<td class="n ${cls(s[k])}">${pctS(s[k], 1)}</td>`);
      const filasF = [["Crecimiento ingresos", "crecimiento", (v) => pctS(v, 1)], ["Margen bruto", "margenBruto", pct], ["Margen operativo", "margenOperativo", pct], ["Margen neto", "margenNeto", pct], ["I+D / ventas", "idSobreVentas", pct], ["ROIC", "roic", pct], ["Margen FCF", "margenFcf", pct], ["Ingresos 12m", "ingresos", grande]];
      out.innerHTML = `<div class="grid2 bloque">
        ${tarjeta(`${a.ticker} frente a ${b.ticker}: mercado`, `<table><thead><tr><th>Métrica</th><th class="n">${esc(a.ticker)}</th><th class="n">${esc(b.ticker)}</th></tr></thead><tbody>
          ${filasPx.map(([n, k, mag]) => `<tr><td>${n}</td>${celda(a.stats, k, mag)}${celda(b.stats, k, mag)}</tr>`).join("")}</tbody></table>`)}
        ${tarjeta("Negocio (últimos 12 meses, SEC)", fa || fb ? `<table><thead><tr><th>Métrica</th><th class="n">${esc(a.ticker)}</th><th class="n">${esc(b.ticker)}</th></tr></thead><tbody>
          ${filasF.map(([n, k, f]) => `<tr><td>${n}</td><td class="n">${fa ? f(fa.ttm[k]) : "—"}</td><td class="n">${fb ? f(fb.ttm[k]) : "—"}</td></tr>`).join("")}
          <tr><td>PER</td><td class="n">${veces(fa?.valuacion?.per)}</td><td class="n">${veces(fb?.valuacion?.per)}</td></tr></tbody></table>
          <p class="nota">El margen bruto es la mejor huella pública del poder de fijación de precios; el ROIC, de si la ventaja se traduce en rentabilidad.</p>` : `<div class="msg">Sin estados de la SEC para estas empresas.</div>`)}
      </div>`;
      const prompt =
`Hacé un estrés del foso competitivo de ${a.ticker} frente a ${b.ticker}. No describas las empresas: evaluá si el foso aguanta.

CONTEXTO DE MERCADO
${bloquePrecio(a)}

${bloquePrecio(b)}

${fa ? `NEGOCIO DE ${a.ticker}\n${bloqueFundamentales(fa)}\nI+D/ventas ${pct(fa.ttm.idSobreVentas)} · margen bruto por año: ${fa.filas.map((x) => `${x.fy} ${pct(x.margenBruto)}`).join(" · ")}` : ""}

${fb ? `NEGOCIO DE ${b.ticker}\n${bloqueFundamentales(fb)}\nI+D/ventas ${pct(fb.ttm.idSobreVentas)} · margen bruto por año: ${fb.filas.map((x) => `${x.fy} ${pct(x.margenBruto)}`).join(" · ")}` : ""}

Evaluá exactamente tres ejes. Para cada uno: veredicto (foso amplio / estrecho / inexistente), evidencia concreta, y qué tendría que pasar para que se erosione.

1. PODER DE FIJACIÓN DE PRECIOS
   Márgenes brutos y su tendencia frente al competidor, quién pone los precios, qué pasó cuando un rival bajó precios.

2. COSTOS DE CAMBIO
   Tiempo de integración, reentrenamiento, ecosistema de software, contratos, datos atrapados. Fricción real frente a fricción que el cliente ya está pagando por salir.

3. PROPIEDAD INTELECTUAL
   Patentes, secretos de fabricación, exclusividades, acceso a capacidad. Intensidad de I+D de cada uno y si la ventaja es la patente o la curva de aprendizaje.

Después:
4. DÓNDE ${b.ticker} ESTÁ MÁS CERCA: el eje en que la distancia se acorta más rápido, y con qué dato se mide.
5. LA SEÑAL TEMPRANA: si el foso se estuviera erosionando ahora, en qué métrica pública aparecería primero.

${REGLAS}`;
      const div = document.createElement("div");
      out.appendChild(div);
      dossier(div, { titulo: "Foso competitivo", prompt });
    };
    el.querySelector("[data-cmp]").addEventListener("click", comparar);
    rivalInp.addEventListener("keydown", (e) => { if (e.key === "Enter") comparar(); });
    if (rivalInp.value) await comparar();
  }
};
