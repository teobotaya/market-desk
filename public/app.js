"use strict";

const $ = (id) => document.getElementById(id);
const state = { price: null, rival: null, news: null, risk: null };

const n2 = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(d));
const sign = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? "—" : (v > 0 ? "+" : "") + Number(v).toFixed(d) + "%");
const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

function status(text, bad) {
  const el = $("status");
  el.textContent = text;
  el.style.color = bad ? "var(--down)" : "";
  el.style.borderColor = bad ? "var(--down)" : "";
}

async function api(path) {
  const r = await fetch(path);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `error ${r.status}`);
  return j;
}

/* ------------------------------------------------------------------ tabs */

document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "v-" + t.dataset.v));
    if (t.dataset.v === "foso") renderFoso();
  });
});

/* --------------------------------------------------------------- dossier */

function dossier(container, label, text, extraHtml) {
  const id = "d" + Math.random().toString(36).slice(2, 8);
  container.innerHTML = (extraHtml || "") +
    `<div class="dossier"><header><span>${esc(label)}</span><button data-copy="${id}">Copiar prompt</button></header><pre id="${id}">${esc(text)}</pre></div>`;
  const btn = container.querySelector("[data-copy]");
  btn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); btn.textContent = "Copiado"; }
    catch { btn.textContent = "Seleccioná y copiá ⌘C"; }
    setTimeout(() => { btn.textContent = "Copiar prompt"; }, 1800);
  });
}

function priceBlock(p) {
  const s = p.stats;
  return [
    `${p.ticker} · cierre ${n2(s.last)} del ${s.date}`,
    `Retornos: 1d ${sign(s.ret1)} · 5d ${sign(s.ret5)} · 1m ${sign(s.ret21)} · 3m ${sign(s.ret63)} · 1a ${sign(s.ret252)}`,
    `Volatilidad anualizada: 21d ${n2(s.vol21, 1)}% · 63d ${n2(s.vol63, 1)}%`,
    `ATR(14): ${n2(s.atr14)} (${n2(s.atrPct, 1)}% del precio)`,
    `Medias: SMA20 ${n2(s.sma20)} · SMA50 ${n2(s.sma50)} · SMA200 ${n2(s.sma200)}`,
    `Rango 52 semanas: ${n2(s.low52)} – ${n2(s.high52)} · desde el máximo ${sign(s.fromHigh)} · desde el mínimo ${sign(s.fromLow)}`,
    `Drawdown máximo del último año: ${n2(s.maxDrawdown, 1)}%`,
    `Volumen relativo de hoy vs media de 21 ruedas: ${n2(s.relVol)}x`
  ].join("\n");
}

/* ----------------------------------------------------------------- panel */

function renderPanel() {
  const p = state.price, s = p.stats;
  $("chartTitle").textContent = `${p.ticker} · cierre diario (${p.candles.length} ruedas)`;
  const cells = [
    ["Último", n2(s.last), s.date, ""],
    ["1 día", sign(s.ret1), "", cls(s.ret1)],
    ["5 días", sign(s.ret5), "", cls(s.ret5)],
    ["1 mes", sign(s.ret21), "", cls(s.ret21)],
    ["3 meses", sign(s.ret63), "", cls(s.ret63)],
    ["Vol. 21d anual.", n2(s.vol21, 1) + "%", "desv. de retornos", s.vol21 > 60 ? "warn" : ""],
    ["ATR(14)", n2(s.atr14), n2(s.atrPct, 1) + "% del precio", ""],
    ["Desde máx. 52s", sign(s.fromHigh), n2(s.high52), cls(s.fromHigh)],
    ["Drawdown 1a", n2(s.maxDrawdown, 1) + "%", "peor caída", "down"],
    ["Vol. relativo", n2(s.relVol) + "x", "vs media 21d", s.relVol > 1.5 ? "warn" : ""],
    ["vs SMA20", sign(((s.last / s.sma20) - 1) * 100), n2(s.sma20), cls(s.last - s.sma20)],
    ["vs SMA200", sign(((s.last / s.sma200) - 1) * 100), n2(s.sma200), cls(s.last - s.sma200)]
  ];
  $("stats").innerHTML = cells.map(([k, v, x, c]) =>
    `<div class="cell"><div class="k">${esc(k)}</div><div class="v ${c}">${esc(v)}</div><div class="x">${esc(x)}</div></div>`).join("");
  chart(p.candles);
}

function chart(rows) {
  const svg = $("chart"), W = 900, H = 260, pad = 26;
  const data = rows.slice(-180);
  const cs = data.map((r) => r.c);
  const min = Math.min(...cs), max = Math.max(...cs), span = max - min || 1;
  const x = (i) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const path = data.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.c).toFixed(1)}`).join("");
  const area = `${path}L${x(data.length - 1).toFixed(1)},${H - pad}L${pad},${H - pad}Z`;
  const up = data[data.length - 1].c >= data[0].c;
  const col = up ? "var(--up)" : "var(--down)";
  const grid = [0, .25, .5, .75, 1].map((f) => {
    const v = min + span * f, yy = y(v);
    return `<line x1="${pad}" y1="${yy}" x2="${W - pad}" y2="${yy}" stroke="var(--line)" stroke-width="1"/>` +
           `<text x="${W - pad + 3}" y="${yy + 3.5}" fill="var(--faint)" font-size="10" font-family="var(--mono)">${v.toFixed(0)}</text>`;
  }).join("");
  svg.innerHTML =
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity=".28"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/>
    </linearGradient></defs>${grid}
    <path d="${area}" fill="url(#g)"/><path d="${path}" fill="none" stroke="${col}" stroke-width="1.8"/>
    <text x="${pad}" y="${H - 7}" fill="var(--faint)" font-size="10" font-family="var(--mono)">${esc(data[0].d)}</text>
    <text x="${W - pad}" y="${H - 7}" text-anchor="end" fill="var(--faint)" font-size="10" font-family="var(--mono)">${esc(data[data.length - 1].d)}</text>`;
}

/* ----------------------------------------------------------------- tesis */

$("genTesis").addEventListener("click", () => {
  const t = $("tesis").value.trim();
  if (!t) return ($("outTesis").innerHTML = `<div class="msg err">Escribí la tesis primero.</div>`);
  if (!state.price) return ($("outTesis").innerHTML = `<div class="msg err">Cargá un ticker antes.</div>`);
  const heads = state.news ? state.news.items.slice(0, 12).map((i) => `- [${i.score > 0 ? "+" : i.score < 0 ? "−" : "0"}] ${i.title} (${i.source})`).join("\n") : "(sin titulares cargados: abrí la pestaña Sentimiento y buscá)";
  const prompt =
`Actuá como un analista escéptico haciendo red team. Tu trabajo NO es validar la tesis: es encontrar por dónde se rompe.

TESIS DEL OPERADOR (horizonte de corto plazo):
${t}

DATOS DE PRECIO
${priceBlock(state.price)}

TITULARES RECIENTES
${heads}

Respondé con esta estructura, sin relleno:

1. QUÉ TIENE QUE PASAR PARA QUE LA TESIS SEA CIERTA
   Enumerá los supuestos implícitos, incluidos los que el operador no escribió. Marcá cuál es el más frágil.

2. POR DÓNDE SE ROMPE
   Tres escenarios concretos de refutación, cada uno con el dato observable que lo anticiparía y en qué plazo se vería.

3. RIESGOS QUE LA TESIS IGNORA
   Distinguí explícitamente entre riesgos de la empresa, del sector o industria, y macro o regulatorios.
   Para cada uno: por qué importa en este horizonte y no en otro.

4. LO QUE CONTRADICE A LA TESIS EN LOS DATOS DE ARRIBA
   Citá las cifras exactas que van en contra. Si los datos no contradicen nada, decilo.

5. QUÉ FALTA SABER
   Qué dato, que no está acá, cambiaría más tu evaluación.

Reglas: no recomiendes comprar ni vender. Cada afirmación tiene que apoyarse en un dato de arriba o declararse explícitamente como supuesto tuyo.`;
  dossier($("outTesis"), "Prompt de red team", prompt);
});

/* ------------------------------------------------------------------ call */

const CUE = ["expect", "expects", "expected", "outlook", "guidance", "guide", "anticipate", "forecast", "next quarter", "next year", "fiscal", "will be", "we plan", "target", "going forward", "upcoming"];
const NEGW = ["decline", "declined", "decrease", "weak", "weakness", "soft", "softness", "headwind", "headwinds", "challenging", "challenges", "pressure", "slowdown", "slower", "miss", "missed", "below", "uncertain", "uncertainty", "cautious", "delay", "delayed", "shortage", "impairment", "loss", "losses", "restructuring", "layoff", "inventory correction", "deceleration"];
const POSW = ["record", "strong", "strength", "growth", "grew", "accelerate", "accelerating", "beat", "exceeded", "above", "robust", "demand", "expansion", "improved", "improving", "momentum", "upside", "raise", "raised", "confident"];

$("genCall").addEventListener("click", () => {
  const raw = $("transcript").value.trim();
  if (raw.length < 400) return ($("outCall").innerHTML = `<div class="msg err">Pegá la transcripción completa (al menos unos párrafos).</div>`);

  const sentences = raw.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"“])/).filter((s) => s.length > 40);
  const score = (s) => {
    const w = s.toLowerCase();
    let v = 0;
    for (const x of NEGW) if (w.includes(x)) v--;
    for (const x of POSW) if (w.includes(x)) v++;
    return v;
  };
  const scored = sentences.map((s) => ({ s, v: score(s), fwd: CUE.some((c) => s.toLowerCase().includes(c)) }));
  const fwd = scored.filter((x) => x.fwd);
  const net = scored.reduce((a, b) => a + b.v, 0);
  const netFwd = fwd.reduce((a, b) => a + b.v, 0);
  const worst = [...scored].sort((a, b) => a.v - b.v).slice(0, 3).filter((x) => x.v < 0);
  const best = [...scored].sort((a, b) => b.v - a.v).slice(0, 3).filter((x) => x.v > 0);

  const dir = netFwd > 2 ? "alcista" : netFwd < -2 ? "bajista" : "neutra";
  const tone = net > 3 ? "positivo" : net < -3 ? "negativo" : "mixto";

  const quotesHtml = worst.length
    ? `<div class="card"><h3>Las tres citas más negativas</h3>${worst.map((x) => `<p class="quote">“${esc(x.s)}”<small>puntuación ${x.v}${x.fwd ? " · lenguaje prospectivo" : ""}</small></p>`).join("")}</div>`
    : `<div class="card"><h3>Citas negativas</h3><p class="sub" style="margin:0">El léxico no encontró frases claramente negativas. Eso no significa que la call sea buena: puede estar escrita con eufemismos, que es justamente lo que conviene mandarle al modelo.</p></div>`;

  const statsHtml = `<div class="grid">
    <div class="cell"><div class="k">Tono general</div><div class="v ${tone === "negativo" ? "down" : tone === "positivo" ? "up" : "warn"}">${tone}</div><div class="x">neto ${net}</div></div>
    <div class="cell"><div class="k">Dirección de la guía</div><div class="v ${dir === "bajista" ? "down" : dir === "alcista" ? "up" : "warn"}">${dir}</div><div class="x">neto prospectivo ${netFwd}</div></div>
    <div class="cell"><div class="k">Frases analizadas</div><div class="v">${scored.length}</div><div class="x">${fwd.length} prospectivas</div></div>
  </div>`;

  const prompt =
`Analizá esta transcripción de earnings call. El análisis léxico previo dio: tono ${tone} (neto ${net}), dirección de la guía ${dir} (neto prospectivo ${netFwd}), sobre ${scored.length} frases, ${fwd.length} con lenguaje prospectivo. Tomá eso como señal cruda, no como conclusión.

Devolvé:

1. TONO REAL DE LA CALL
   Positivo, negativo o mixto, y por qué. Prestá atención a los eufemismos: "normalización", "digestión de inventario", "moderación" suelen ser malas noticias en un vocabulario amable.

2. SI EL TONO ES NEGATIVO, TRES CITAS TEXTUALES
   Exactamente tres, entre comillas, sin parafrasear, con quién las dijo si figura. Elegí las que más información traen, no las más dramáticas.
   Estas son las candidatas que marcó el léxico:
${worst.map((x, i) => `   ${i + 1}. "${x.s}"`).join("\n") || "   (ninguna)"}

3. DIRECCIÓN QUE MARCA LA EMPRESA
   Qué dijeron sobre el próximo trimestre y el año: guía de ingresos, márgenes, capex, demanda.
   Concluí si el mensaje es alcista, bajista o neutro, y qué frase exacta lo sostiene.

4. LO QUE ESQUIVARON
   Preguntas de analistas respondidas de forma vaga o no respondidas. Suele ser lo más informativo de toda la call.

5. DIVERGENCIA
   Dónde el discurso de la dirección se contradice con los números que ellos mismos dieron.

Reglas: citas textuales siempre entre comillas; si algo no está en la transcripción, decí que no está en vez de inferirlo.

TRANSCRIPCIÓN:
${raw.length > 60000 ? raw.slice(0, 60000) + "\n\n[...truncada a 60.000 caracteres...]" : raw}`;

  dossier($("outCall"), "Prompt de análisis de la call", prompt, statsHtml + quotesHtml);
});

/* ------------------------------------------------------------------ foso */

function renderFoso() {
  const box = $("outFoso");
  if (!state.price || !state.rival) { box.innerHTML = `<div class="msg">Cargá los dos tickers arriba y volvé a esta pestaña.</div>`; return; }
  const a = state.price, b = state.rival;
  const cmp = `<div class="card"><h3>${esc(a.ticker)} frente a ${esc(b.ticker)}</h3><table>
    <tr><th>Métrica</th><th style="text-align:right">${esc(a.ticker)}</th><th style="text-align:right">${esc(b.ticker)}</th></tr>
    ${[["1 mes", "ret21", "%"], ["3 meses", "ret63", "%"], ["1 año", "ret252", "%"], ["Vol. 21d", "vol21", "%"], ["ATR %", "atrPct", "%"], ["Desde máx. 52s", "fromHigh", "%"], ["Drawdown 1a", "maxDrawdown", "%"]]
      .map(([k, f]) => `<tr><td>${k}</td><td class="n ${cls(a.stats[f])}">${n2(a.stats[f], 1)}%</td><td class="n ${cls(b.stats[f])}">${n2(b.stats[f], 1)}%</td></tr>`).join("")}
  </table></div>`;

  const prompt =
`Hacé un estrés del foso competitivo de ${a.ticker} frente a ${b.ticker}. No describas las empresas: evaluá si el foso aguanta.

CONTEXTO DE MERCADO
${a.ticker}:
${priceBlock(a)}

${b.ticker}:
${priceBlock(b)}

Evaluá exactamente tres ejes. Para cada uno: veredicto (foso amplio / estrecho / inexistente), la evidencia concreta que lo sostiene, y qué tendría que pasar para que se erosione.

1. PODER DE FIJACIÓN DE PRECIOS
   ¿Puede subir precios sin perder volumen? Mirá márgenes brutos y su tendencia, si los precios los pone la empresa o el mercado, y qué pasó la última vez que un competidor bajó precios.

2. COSTES DE CAMBIO
   ¿Qué le cuesta a un cliente irse? Tiempo de integración, reentrenamiento, ecosistema de software, contratos, datos atrapados. Distinguí entre fricción real y fricción que el cliente ya está pagando por salir.

3. PROPIEDAD INTELECTUAL
   Patentes, secretos de fabricación, exclusividades, acceso a capacidad productiva. ¿Cuánto falta para que expire o se replique? ¿La ventaja es la patente o la curva de aprendizaje?

Después:

4. DÓNDE ${b.ticker} ESTÁ MÁS CERCA
   El eje en el que la distancia se acorta más rápido, y con qué dato se mide.

5. LA SEÑAL TEMPRANA
   Si el foso se estuviera erosionando ahora mismo, ¿en qué métrica pública aparecería primero, y antes de cuánto?

Reglas: cada veredicto apoyado en un hecho verificable o declarado como supuesto. Sin recomendación de compra ni de venta.`;

  dossier(box, "Prompt de foso competitivo", prompt, cmp);
}

/* ------------------------------------------------------------ sentimiento */

$("goNews").addEventListener("click", async () => {
  const q = $("q").value.trim(), days = $("days").value;
  const box = $("outSent");
  box.innerHTML = `<div class="msg">Buscando…</div>`;
  try {
    const d = await api(`/api/news?q=${encodeURIComponent(q)}&days=${days}`);
    state.news = d;
    const s = d.summary;
    const maxN = Math.max(1, ...d.timeline.map((t) => t.n));
    const bars = d.timeline.map((t) =>
      `<div title="${t.day}: ${t.n} titulares, neto ${t.score}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:70px">
         <div style="height:${(t.n / maxN) * 100}%;background:${t.score > 0 ? "var(--up)" : t.score < 0 ? "var(--down)" : "var(--line2)"};border-radius:2px 2px 0 0"></div>
       </div>`).join("");

    box.innerHTML = `<div class="grid">
        <div class="cell"><div class="k">Titulares</div><div class="v">${s.total}</div><div class="x">últimos ${d.days} días</div></div>
        <div class="cell"><div class="k">Positivos</div><div class="v up">${s.pos}</div><div class="x"></div></div>
        <div class="cell"><div class="k">Negativos</div><div class="v down">${s.neg}</div><div class="x"></div></div>
        <div class="cell"><div class="k">Neto</div><div class="v ${cls(s.net)}">${s.net > 0 ? "+" : ""}${s.net}</div><div class="x">pos − neg</div></div>
      </div>
      <div class="card"><h3>Volumen de noticias por día</h3><div style="display:flex;gap:3px;align-items:flex-end">${bars}</div></div>
      <div class="card"><h3>Titulares</h3><table>${d.items.slice(0, 30).map((i) =>
        `<tr><td class="n ${cls(i.score)}" style="text-align:left;padding-right:10px">${i.score > 0 ? "+" : ""}${i.score}</td>
             <td><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a><br><span class="x" style="font-family:var(--mono);font-size:11px;color:var(--faint)">${esc(i.source)} · ${esc(i.date)}</span></td></tr>`).join("")}</table></div>`;

    const prompt =
`Resumí el sentimiento de mercado sobre "${q}" con base en estos ${s.total} titulares de los últimos ${d.days} días.

Recuento léxico crudo: ${s.pos} positivos, ${s.neg} negativos, ${s.neutral} neutros, neto ${s.net}. Tomalo como ruido de fondo: un lexicón no entiende ironía, contexto ni si la noticia ya estaba en precio.

Devolvé:

1. EL CLIMA EN DOS FRASES
   Qué está descontando el mercado ahora mismo sobre este sector.

2. LOS TRES TEMAS QUE DOMINAN
   Con los titulares que los sostienen y si cada tema empuja al alza o a la baja.

3. QUÉ CAMBIÓ EN ESTAS SEMANAS
   Si hay un quiebre de narrativa respecto del período anterior, y qué titular lo marca.

4. LO QUE NADIE ESTÁ MIRANDO
   Un titular de baja repercusión que podría importar más de lo que parece, y por qué.

5. SESGO DE LA MUESTRA
   Qué falta acá: fuentes ausentes, sobre-representación de un medio, cobertura concentrada en un solo día.

TITULARES:
${d.items.map((i) => `- ${i.title} — ${i.source} (${i.date})`).join("\n")}`;

    const extra = box.innerHTML;
    dossier(box, "Prompt de sentimiento del sector", prompt, extra);
  } catch (e) {
    box.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
});

/* --------------------------------------------------------------- riesgos */

$("goRisk").addEventListener("click", async () => {
  const box = $("outRisk"), t = $("ticker").value.trim().toUpperCase();
  box.innerHTML = `<div class="msg">Bajando el 10-K de la SEC… (puede tardar, son documentos grandes)</div>`;
  try {
    const d = await api(`/api/risk?t=${encodeURIComponent(t)}`);
    state.risk = d;
    const esp = d.risks.filter((r) => r.kind === "especifico");
    const gen = d.risks.filter((r) => r.kind === "generico");
    const mix = d.risks.filter((r) => r.kind === "mixto");

    const list = (arr, label, cl) => arr.length ? `<div class="card"><h3>${label} <span class="pill ${cl}">${arr.length}</span></h3><table>${
      arr.slice(0, 14).map((r) => `<tr><td>${esc(r.heading)}<br><span style="color:var(--faint);font-size:12.5px">${esc(r.text.slice(0, 260))}…</span></td></tr>`).join("")}</table></div>` : "";

    box.innerHTML = `<div class="grid">
        <div class="cell"><div class="k">Documento</div><div class="v" style="font-size:15px">${esc(d.form)}</div><div class="x">${esc(d.company)}</div></div>
        <div class="cell"><div class="k">Presentado</div><div class="v" style="font-size:15px">${esc(d.filed)}</div><div class="x">período ${esc(d.period || "—")}</div></div>
        <div class="cell"><div class="k">Específicos</div><div class="v warn">${esp.length}</div><div class="x">de la empresa</div></div>
        <div class="cell"><div class="k">Genéricos</div><div class="v">${gen.length}</div><div class="x">boilerplate</div></div>
        <div class="cell"><div class="k">Mixtos</div><div class="v">${mix.length}</div><div class="x">a revisar</div></div>
      </div>
      <p class="sub"><a href="${esc(d.url)}" target="_blank" rel="noopener">Abrir el documento original en la SEC</a> · la clasificación es por reglas léxicas y falla: usala para ordenar la lectura, no para saltearla.</p>
      ${list(esp, "Riesgos específicos de la empresa", "esp")}
      ${list(mix, "Mixtos", "mix")}
      ${list(gen, "Boilerplate genérico", "gen")}`;

    const prompt =
`Analizá la sección de factores de riesgo (Item 1A) del ${d.form} de ${d.company}, presentado el ${d.filed}.

Una clasificación por reglas marcó ${esp.length} párrafos como específicos de la empresa, ${gen.length} como boilerplate genérico y ${mix.length} dudosos. Verificá esa clasificación, no la asumas.

Devolvé:

1. RIESGOS ESPECÍFICOS DE ESTA EMPRESA
   Los que no aparecerían en el 10-K de cualquier otra compañía. Para cada uno: qué lo hace específico, qué magnitud declara la empresa (porcentajes, nombres, geografías) y si empeoró respecto del informe anterior.
   Prestá atención especial a: concentración de clientes, dependencia de un proveedor o de una única fábrica, exposición a una geografía concreta, y contratos o licencias que puedan caerse.

2. BOILERPLATE GENÉRICO
   Agrupalos y despachalos en pocas líneas: volatilidad del mercado, amenaza regulatoria general, litigios, ciberseguridad, retención de personal. Decí explícitamente cuáles descartás y por qué.

3. LO QUE CAMBIÓ
   Riesgos nuevos respecto del 10-K anterior, o redacciones que se endurecieron. Un riesgo que sube de párrafo o gana detalle suele anticipar algo.

4. CADENA DE SUMINISTRO Y GEOPOLÍTICA
   Tratalo aparte: proveedor único, concentración geográfica de la producción, controles de exportación, aranceles, exposición a un conflicto armado. Cuantificá lo que la empresa cuantifique.

5. LOS TRES QUE IMPORTAN
   Si tuvieras que vigilar solo tres, cuáles, y qué señal pública los dispararía.

PÁRRAFOS CLASIFICADOS COMO ESPECÍFICOS:
${esp.slice(0, 25).map((r, i) => `${i + 1}. ${r.text}`).join("\n\n") || "(ninguno)"}

PÁRRAFOS DUDOSOS:
${mix.slice(0, 10).map((r, i) => `${i + 1}. ${r.text.slice(0, 700)}`).join("\n\n") || "(ninguno)"}`;

    const extra = box.innerHTML;
    dossier(box, "Prompt de factores de riesgo", prompt, extra);
  } catch (e) {
    box.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
});

/* ------------------------------------------------------------------ load */

async function load() {
  const t = $("ticker").value.trim(), r = $("rival").value.trim();
  $("load").disabled = true;
  status("cargando…");
  try {
    state.price = await api(`/api/price?t=${encodeURIComponent(t)}`);
    renderPanel();
    status(`${state.price.ticker} · ${state.price.stats.date}`);
    if (r) {
      try { state.rival = await api(`/api/price?t=${encodeURIComponent(r)}`); }
      catch { state.rival = null; }
    }
    if (document.querySelector('.tab[aria-selected=true]').dataset.v === "foso") renderFoso();
  } catch (e) {
    status(e.message, true);
    $("stats").innerHTML = `<div class="msg err" style="grid-column:1/-1">${esc(e.message)}</div>`;
  } finally {
    $("load").disabled = false;
  }
}

$("load").addEventListener("click", load);
$("ticker").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
$("rival").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
load();
