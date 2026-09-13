"use strict";

const $ = (id) => document.getElementById(id);
const state = { price: null, rival: null, rivalError: null, news: null, risk: null };

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

let IA = { ia: false, modelo: null };

function dossier(container, label, text, extraHtml) {
  const id = "d" + Math.random().toString(36).slice(2, 8);
  const botonIA = IA.ia ? `<button data-ia="${id}" class="go">Analizar con ${esc(IA.proveedor === "gemini" ? "Gemini" : "Claude")}</button>` : "";
  container.innerHTML = (extraHtml || "") +
    `<div class="dossier"><header><span>${esc(label)}</span><span style="display:flex;gap:6px">${botonIA}<button data-copy="${id}">Copiar prompt</button></span></header>
     <pre id="${id}">${esc(text)}</pre><div class="ia" id="ia-${id}" style="display:none"></div></div>`;

  const btn = container.querySelector("[data-copy]");
  btn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); btn.textContent = "Copiado"; }
    catch { btn.textContent = "Seleccioná y copiá ⌘C"; }
    setTimeout(() => { btn.textContent = "Copiar prompt"; }, 1800);
  });

  const bia = container.querySelector("[data-ia]");
  if (!bia) return;
  bia.addEventListener("click", async () => {
    const salida = document.getElementById("ia-" + id);
    bia.disabled = true; bia.textContent = "Analizando…";
    salida.style.display = "block";
    salida.innerHTML = `<div class="head">Respuesta</div>Pensando…`;
    try {
      const r = await fetch("/api/analizar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text })
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `error ${r.status}`);
      salida.innerHTML = `<div class="head">${esc(j.proveedor)} · ${esc(j.modelo)}</div>` + esc(j.texto);
    } catch (e) {
      salida.innerHTML = `<div class="head">Error</div>${esc(e.message)}`;
    } finally {
      bia.disabled = false; bia.textContent = `Analizar con ${IA.proveedor === "gemini" ? "Gemini" : "Claude"}`;
    }
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
  $("chartTitle").textContent = `${p.ticker} · cierre diario (${p.candles.length} ruedas) · fuente: ${p.source || "—"}`;
  const aviso = $("aviso");
  if (aviso) { aviso.textContent = p.note || ""; aviso.style.display = p.note ? "block" : "none"; }
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
  if (!box) return;
  if (!state.price) { box.innerHTML = `<div class="msg">Cargá el ticker principal arriba.</div>`; return; }
  if (!state.rival) {
    box.innerHTML = `<div class="msg err"><b>No pude cargar el competidor.</b><br>${esc(state.rivalError || "razón desconocida")}</div>
      <div class="msg" style="margin-top:10px">Para comparar contra un índice usá su ETF: <b>SPY</b> (S&amp;P 500), <b>QQQ</b> (Nasdaq 100), <b>SOXX</b> (semiconductores), <b>DIA</b> (Dow), <b>IWM</b> (Russell 2000). Escribir SP500 o SPX también funciona: la app los traduce sola.</div>`;
    return;
  }
  const a = state.price, b = state.rival;
  const notas = [a.note, b.note].filter(Boolean).map((t) => `<div class="msg" style="margin-bottom:12px">${esc(t)}</div>`).join("");
  const cmp = notas + `<div class="card"><h3>${esc(a.ticker)} frente a ${esc(b.ticker)}</h3><table>
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



/* --------------------------------------------------------- fundamentales */

const M = (v) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + " B";
  if (a >= 1e9) return (v / 1e9).toFixed(2) + " MM";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + " M";
  return n2(v, 0);
};

$("goFund").addEventListener("click", async () => {
  const box = $("outFund"), t = $("ticker").value.trim();
  box.innerHTML = `<div class="msg">Bajando estados financieros de la SEC… (la primera vez tarda, el archivo es grande)</div>`;
  try {
    const d = await api(`/api/fundamentales?t=${encodeURIComponent(t)}`);
    const f = d.filas, u = f[f.length - 1];

    const fila = (nombre, campo, fmt, cl) =>
      `<tr><td>${esc(nombre)}</td>${f.map((x) => `<td class="n ${cl ? cl(x[campo]) : ""}">${fmt(x[campo])}</td>`).join("")}</tr>`;
    const pc = (v) => (v === null ? "—" : n2(v, 1) + "%");
    const x1 = (v) => (v === null ? "—" : n2(v) + "x");

    const tabla = `<div class="card"><h3>${esc(d.empresa)} · ejercicios fiscales</h3>
      <table>
        <tr><th>Métrica</th>${f.map((x) => `<th class="n">${x.fy}</th>`).join("")}</tr>
        ${fila("Ingresos", "ingresos", M)}
        ${fila("Crecimiento", "crecimiento", (v) => (v === null ? "—" : sign(v, 1)), cls)}
        ${fila("Margen bruto", "margenBruto", pc)}
        ${fila("Margen operativo", "margenOperativo", pc)}
        ${fila("Margen neto", "margenNeto", pc)}
        ${fila("I+D sobre ventas", "idSobreVentas", pc)}
        ${fila("ROIC", "roic", pc, (v) => (v >= 15 ? "up" : v !== null && v < 8 ? "down" : ""))}
        ${fila("ROE", "roe", pc)}
        ${fila("Flujo de caja libre", "fcf", M)}
        ${fila("Margen de FCF", "margenFcf", pc)}
        ${fila("Conversión FCF/beneficio", "conversion", pc, (v) => (v === null ? "" : v >= 80 ? "up" : v < 50 ? "down" : "warn"))}
        ${fila("Deuda neta", "deudaNeta", M, (v) => (v !== null && v < 0 ? "up" : ""))}
        ${fila("Deuda neta / EBITDA", "deudaNetaEbitda", x1, (v) => (v === null ? "" : v > 3 ? "down" : v < 1 ? "up" : ""))}
        ${fila("Cobertura de intereses", "cobertura", x1, (v) => (v === null ? "" : v < 3 ? "down" : "up"))}
        ${fila("Acciones diluidas", "acciones", M)}
      </table>
      <p class="sub" style="margin:12px 0 0">El ROIC usa el resultado operativo después de impuestos sobre patrimonio más deuda menos caja: es una aproximación razonable, no la definición contable exacta. Deuda neta negativa significa más caja que deuda.</p></div>`;

    const val = d.valuacion;
    const cuadro = val ? `<div class="grid">
      <div class="cell"><div class="k">Capitalización</div><div class="v">${M(val.capitalizacion)}</div><div class="x">precio ${n2(val.precio)} del ${esc(val.fecha)}</div></div>
      <div class="cell"><div class="k">PER</div><div class="v">${x1(val.per)}</div><div class="x">sobre ejercicio ${val.ejercicio}</div></div>
      <div class="cell"><div class="k">Precio / ventas</div><div class="v">${x1(val.precioVentas)}</div><div class="x"></div></div>
      <div class="cell"><div class="k">EV / EBITDA</div><div class="v">${x1(val.evEbitda)}</div><div class="x">incluye deuda neta</div></div>
      <div class="cell"><div class="k">Rentabilidad del FCF</div><div class="v ${val.rentabilidadFcf > 4 ? "up" : ""}">${pc(val.rentabilidadFcf)}</div><div class="x">caja libre sobre capitalización</div></div>
      <div class="cell"><div class="k">Dilución anual</div><div class="v ${d.dilucionAnual > 1 ? "down" : "up"}">${pc(d.dilucionAnual)}</div><div class="x">acciones, promedio anual</div></div>
    </div>` : `<div class="msg">Sin precio no puedo calcular la valuación. El resto de la tabla igual sirve.</div>`;

    const serie = (c) => f.map((x) => `${x.fy}: ${x[c] === null ? "—" : n2(x[c], 1)}`).join(" · ");
    const prompt =
`Analizá los fundamentales de ${d.empresa} (${d.ticker}) con los estados financieros presentados a la SEC.

MÁRGENES Y RENTABILIDAD (por ejercicio fiscal)
Ingresos: ${f.map((x) => `${x.fy}: ${M(x.ingresos)}`).join(" · ")}
Crecimiento: ${serie("crecimiento")}
Margen bruto: ${serie("margenBruto")}
Margen operativo: ${serie("margenOperativo")}
Margen neto: ${serie("margenNeto")}
ROIC aproximado: ${serie("roic")}
ROE: ${serie("roe")}

CALIDAD DEL BENEFICIO
Flujo de caja libre: ${f.map((x) => `${x.fy}: ${M(x.fcf)}`).join(" · ")}
Conversión FCF sobre beneficio neto: ${serie("conversion")}

SOLVENCIA
Deuda neta: ${f.map((x) => `${x.fy}: ${M(x.deudaNeta)}`).join(" · ")}
Deuda neta sobre EBITDA: ${serie("deudaNetaEbitda")}
Cobertura de intereses: ${serie("cobertura")}
Dilución anual de acciones: ${d.dilucionAnual === null ? "—" : n2(d.dilucionAnual, 2) + "%"}

VALUACIÓN
${val ? `Capitalización ${M(val.capitalizacion)} · PER ${n2(val.per)} · precio/ventas ${n2(val.precioVentas)} · EV/EBITDA ${n2(val.evEbitda)} · rentabilidad del FCF ${n2(val.rentabilidadFcf, 1)}%` : "no disponible"}

Devolvé:

1. QUÉ TIPO DE NEGOCIO ES
   Leído en los márgenes y el ROIC, no en el sector. ¿Fija precios o los acepta? ¿Crear valor al crecer, o destruirlo?

2. ¿EL BENEFICIO ES REAL?
   Mirá la conversión de beneficio a caja. Si diverge en algún año, decí en cuál y qué lo explicaría.

3. LA TENDENCIA, NO LA FOTO
   Qué mejora y qué se deteriora a lo largo de los ejercicios. Un margen que baja mientras los ingresos suben significa algo distinto que uno que baja con ingresos planos.

4. SOLVENCIA
   ¿Puede aguantar un año malo? Usá deuda neta, cobertura y caja.

5. CALIDAD CONTRA PRECIO
   Separá explícitamente las dos preguntas: qué tan bueno es el negocio, y qué tan caro está. Si la valuación descuenta un crecimiento determinado, decí cuál tendría que ser.

6. LO QUE ESTOS NÚMEROS NO MUESTRAN
   Y qué habría que mirar en el 10-K para completarlo.

Reglas: no recomiendes comprar, vender ni mantener. No des precio objetivo. Cada afirmación apoyada en una cifra de arriba.`;

    dossier(box, "Prompt de fundamentales", prompt, cuadro + tabla);
  } catch (e) {
    box.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
});


$("goPer").addEventListener("click", async () => {
  const box = $("outPer"), t = $("ticker").value.trim(), pares = $("pares").value.trim();
  box.innerHTML = `<div class="msg">Reconstruyendo el PER y trayendo los pares… (cada par es una descarga de la SEC, la primera vez tarda)</div>`;
  try {
    const d = await api(`/api/per?t=${encodeURIComponent(t)}&pares=${encodeURIComponent(pares)}`);
    const h = d.historico;
    const x1 = (v) => (v === null || v === undefined ? "—" : n2(v) + "x");

    /* Regla de lectura: caro o barato es siempre relativo a algo. */
    const banda = h.percentilActual >= 80 ? ["down", "en la parte alta de su propio rango"]
      : h.percentilActual <= 20 ? ["up", "en la parte baja de su propio rango"]
      : ["warn", "en la zona media de su propio rango"];

    const cuadro = `<div class="grid">
      <div class="cell"><div class="k">PER actual</div><div class="v">${x1(d.actual)}</div><div class="x">precio ${n2(d.precio)} · BPA ${n2(d.eps)} (ej. ${d.ejercicio})</div></div>
      <div class="cell"><div class="k">Mediana propia</div><div class="v">${x1(h.mediana)}</div><div class="x">${esc(h.desde)} a ${esc(h.hasta)}</div></div>
      <div class="cell"><div class="k">vs su mediana</div><div class="v ${cls(d.vsPropioMediana)}">${sign(d.vsPropioMediana, 0)}</div><div class="x">${esc(banda[1])}</div></div>
      <div class="cell"><div class="k">Percentil histórico</div><div class="v ${banda[0]}">${n2(h.percentilActual, 0)}</div><div class="x">de 100 · más alto = más caro que su historia</div></div>
      <div class="cell"><div class="k">Mediana de pares</div><div class="v">${x1(d.medianaPares)}</div><div class="x">${d.pares.filter((p) => p.per).length} comparables</div></div>
      <div class="cell"><div class="k">vs pares</div><div class="v ${cls(d.vsPares)}">${d.vsPares === null ? "—" : sign(d.vsPares, 0)}</div><div class="x">prima o descuento</div></div>
    </div>`;

    /* Rango propio: dónde está hoy dentro de min–max. */
    const ancho = h.max - h.min || 1;
    const pos = ((d.actual - h.min) / ancho) * 100;
    const marca = (v, etq, col) => `<div style="position:absolute;left:${Math.max(0, Math.min(100, ((v - h.min) / ancho) * 100))}%;top:0;height:100%;border-left:2px solid ${col}" title="${etq}: ${n2(v)}x"></div>`;
    const barra = `<div class="card"><h3>Dónde cotiza hoy dentro de su propio rango</h3>
      <div style="position:relative;height:34px;background:linear-gradient(90deg,var(--up),var(--warn),var(--down));border-radius:6px;opacity:.85">
        ${marca(h.p25, "percentil 25", "rgba(255,255,255,.5)")}${marca(h.mediana, "mediana", "#fff")}${marca(h.p75, "percentil 75", "rgba(255,255,255,.5)")}
        <div style="position:absolute;left:${Math.max(0, Math.min(100, pos))}%;top:-6px;height:46px;border-left:3px solid var(--ink)"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:6px">
        <span>mín ${n2(h.min)}x</span><span>mediana ${n2(h.mediana)}x</span><span>máx ${n2(h.max)}x</span></div>
      <p class="sub" style="margin:12px 0 0">La línea oscura es hoy (${n2(d.actual)}x). Rango medido sobre ${h.ruedas} ruedas. <b>Barato respecto de su historia no significa barato:</b> si el negocio se deterioró, un PER bajo puede estar bien puesto.</p></div>`;

    const tablaPares = `<div class="card"><h3>Pares que elegiste</h3><table>
      <tr><th>Ticker</th><th>Empresa</th><th class="n">PER</th><th class="n">vs ${esc(d.ticker)}</th></tr>
      <tr style="background:var(--panel2)"><td><b>${esc(d.ticker)}</b></td><td>${esc(d.empresa)}</td><td class="n"><b>${x1(d.actual)}</b></td><td class="n">—</td></tr>
      ${d.pares.map((p) => p.per
        ? `<tr><td>${esc(p.ticker)}</td><td>${esc(p.empresa || "")}</td><td class="n">${x1(p.per)}</td><td class="n ${cls(d.actual / p.per - 1)}">${sign((d.actual / p.per - 1) * 100, 0)}</td></tr>`
        : `<tr><td>${esc(p.ticker)}</td><td colspan="3" style="color:var(--faint);font-size:12.5px">${esc(p.error || "sin datos")}</td></tr>`).join("")}
    </table>
    <p class="sub" style="margin:12px 0 0">Los pares los elegís vos, y eso es a propósito: un "PER del sector" promediado a ciegas mezcla negocios que no se parecen. Cambiá la lista según con quién creas que compite de verdad.</p></div>`;

    const prompt =
`Interpretá la valuación de ${d.empresa} (${d.ticker}) cruzando sus tres referencias de PER.

PER ACTUAL: ${n2(d.actual)}x — precio ${n2(d.precio)} del ${d.fecha}, beneficio por acción ${n2(d.eps)} del ejercicio ${d.ejercicio}.

CONTRA SU PROPIA HISTORIA (${h.desde} a ${h.hasta}, ${h.ruedas} ruedas)
Mínimo ${n2(h.min)}x · percentil 25 ${n2(h.p25)}x · mediana ${n2(h.mediana)}x · percentil 75 ${n2(h.p75)}x · máximo ${n2(h.max)}x
Hoy está en el percentil ${n2(h.percentilActual, 0)} y ${sign(d.vsPropioMediana, 0)} respecto de su mediana.

CONTRA SUS PARES
${d.pares.map((p) => p.per ? `${p.ticker}: ${n2(p.per)}x` : `${p.ticker}: sin datos`).join(" · ")}
Mediana de pares: ${d.medianaPares === null ? "—" : n2(d.medianaPares) + "x"} · la empresa cotiza ${d.vsPares === null ? "—" : sign(d.vsPares, 0)} respecto de esa mediana.

Devolvé:

1. QUÉ ESTÁ DESCONTANDO EL PRECIO
   Qué crecimiento de beneficios haría falta para justificar el PER actual. Mostrá el razonamiento con números.

2. LAS TRES LECTURAS, POR SEPARADO
   Contra su historia, contra sus pares, y en términos absolutos. Pueden contradecirse: si lo hacen, decí cuál pesa más y por qué.

3. LA TRAMPA DE CADA COMPARACIÓN
   Por qué el rango histórico puede engañar (cambio de negocio, de márgenes, de tasas de interés) y por qué la mediana de pares puede engañar (empresas que no son comparables, ciclos distintos).

4. SI LA PRIMA O EL DESCUENTO ESTÁ JUSTIFICADO
   Con qué evidencia se sostendría, y qué dato lo desmentiría.

5. EL PER NO ES SUFICIENTE
   Qué otras métricas habría que mirar antes de sacar conclusiones de valuación en este caso concreto.

Reglas: no digas si comprar, vender o mantener. No des precio objetivo. No digas si "está barata" sin aclarar respecto de qué.`;

    dossier(box, "Prompt de valuación por PER", prompt, cuadro + barra + tablaPares);
  } catch (e) {
    box.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
});

/* ---------------------------------------------------------- perfil riesgo */

$("goPerfil").addEventListener("click", async () => {
  const box = $("outPerfil"), t = $("ticker").value.trim(), b = $("bench").value.trim() || "SPY";
  box.innerHTML = `<div class="msg">Midiendo…</div>`;
  try {
    const d = await api(`/api/riesgo?t=${encodeURIComponent(t)}&b=${encodeURIComponent(b)}`);
    const p = d.perfil;
    $("perfilQue").textContent = `${d.ticker} · ${d.desde} a ${d.hasta}`;

    const celda = (k, v, x, c) => `<div class="cell"><div class="k">${esc(k)}</div><div class="v ${c || ""}">${esc(v)}</div><div class="x">${esc(x)}</div></div>`;
    const cuadro = [
      celda("Volatilidad anual", n2(p.volAnual, 1) + "%", p.volBench ? `${d.benchmark}: ${n2(p.volBench, 1)}%` : "sin referencia", p.volAnual > 45 ? "warn" : ""),
      celda("Veces la referencia", p.volRelativa ? n2(p.volRelativa) + "x" : "—", "cuánto más se mueve", p.volRelativa > 1.5 ? "warn" : ""),
      celda("Beta", p.beta === null ? "—" : n2(p.beta), `correlación ${p.correl === null ? "—" : n2(p.correl)}`, ""),
      celda("Peor día", n2(p.peorDia, 1) + "%", `mejor: +${n2(p.mejorDia, 1)}%`, "down"),
      celda("Peor semana", n2(p.peorSemana, 1) + "%", "5 ruedas seguidas", "down"),
      celda("Peor mes", n2(p.peorMes, 1) + "%", "21 ruedas seguidas", "down"),
      celda("Caída máxima", n2(p.maxDrawdown, 1) + "%", p.ruedasHastaRecuperar === null ? "todavía no recuperó" : `recuperó en ${p.ruedasHastaRecuperar} ruedas`, "down"),
      celda("VaR 95% diario", n2(p.var95, 1) + "%", "1 de cada 20 días cae más", "warn"),
      celda("VaR 99% diario", n2(p.var99, 1) + "%", "1 de cada 100 días", "warn"),
      celda("Días ±3%", n2(p.diasMas3, 1) + "%", "de las ruedas medidas", ""),
      celda("Días ±5%", n2(p.diasMas5, 1) + "%", "de las ruedas medidas", ""),
      celda("Desvío bajista", p.desvBajista ? n2(p.desvBajista, 1) + "%" : "—", "solo días en rojo", "")
    ].join("");

    const lectura = `<div class="card"><h3>Cómo se lee esto</h3><table>
      <tr><td><b>Volatilidad anual</b></td><td>Cuánto oscila el precio en un año, en términos de desvío. 20% es un índice tranquilo; arriba de 45% es un activo que se mueve fuerte todos los días.</td></tr>
      <tr><td><b>Beta</b></td><td>Cuánto se mueve cuando ${esc(d.benchmark || "la referencia")} se mueve 1%. Beta 1,5 significa que amplifica las subidas <em>y</em> las bajadas.</td></tr>
      <tr><td><b>VaR 95%</b></td><td>En el 5% de los peores días del período medido, la caída fue de al menos eso. No es un piso: el peor día real fue ${n2(p.peorDia, 1)}%.</td></tr>
      <tr><td><b>Caída máxima</b></td><td>Lo que habrías perdido comprando en el peor momento y vendiendo en el fondo. La pregunta útil no es si el número es alto, sino si lo aguantarías sin vender.</td></tr>
    </table></div>`;

    const prompt =
`Poné en contexto el riesgo de ${d.ticker}, medido entre ${d.desde} y ${d.hasta} sobre ${p.ruedas} ruedas, contra ${d.benchmark || "ninguna referencia"}.

MEDICIONES
Volatilidad anualizada: ${n2(p.volAnual, 1)}%${p.volBench ? ` (referencia: ${n2(p.volBench, 1)}%, o sea ${n2(p.volRelativa)}x)` : ""}
Beta: ${p.beta === null ? "no calculada" : n2(p.beta)} · correlación: ${p.correl === null ? "—" : n2(p.correl)}
Desvío bajista anualizado: ${p.desvBajista ? n2(p.desvBajista, 1) + "%" : "—"}
VaR histórico diario: 95% ${n2(p.var95, 1)}% · 99% ${n2(p.var99, 1)}%
Peor día ${n2(p.peorDia, 1)}% · peor semana ${n2(p.peorSemana, 1)}% · peor mes ${n2(p.peorMes, 1)}%
Caída máxima ${n2(p.maxDrawdown, 1)}% · ${p.ruedasHastaRecuperar === null ? "todavía no recuperó el máximo anterior" : `tardó ${p.ruedasHastaRecuperar} ruedas en recuperarlo`}
Ruedas con movimiento mayor a ±3%: ${n2(p.diasMas3, 1)}% · mayor a ±5%: ${n2(p.diasMas5, 1)}%

Devolvé:

1. QUÉ TIPO DE ACTIVO ES, EN RIESGO
   Traducí estos números a lenguaje llano. ¿Es un activo tranquilo, movido o violento, comparado con el mercado?

2. QUÉ SIGNIFICA EN PLATA
   Con una posición hipotética de 1.000 dólares: cuánto se movió en un día malo típico, en el peor día del período, y en la peor racha. Aclarar que son cifras del pasado.

3. QUÉ TENDRÍA QUE SOPORTAR ALGUIEN QUE LO TUVIERA
   La caída máxima del período, cuánto duró, y qué se necesita para no vender en el fondo.

4. QUÉ NO MIDEN ESTOS NÚMEROS
   Riesgos que no aparecen en la serie de precios: concentración de clientes, regulación, un competidor, iliquidez, eventos de cola.

5. LAS PREGUNTAS QUE TENDRÍA QUE RESPONDERSE LA PERSONA
   Tres preguntas sobre su propia situación —horizonte, tolerancia real a la pérdida, qué parte de su capital sería esto— que importan más que cualquiera de estas cifras.

Reglas estrictas: NO recomiendes comprar, vender ni mantener. No digas si "conviene" ni si es "buena inversión". No sugieras un tamaño de posición. Describí el riesgo medido y dejá la decisión a la persona.`;

    dossier(box, "Prompt de perfil de riesgo", prompt, `<div class="grid">${cuadro}</div>${lectura}`);
  } catch (e) {
    box.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
});


/* ------------------------------------------------------------- criterios */

$("goCriterios").addEventListener("click", async () => {
  const box = $("outCriterios");
  const t = $("ticker").value.trim(), b = $("bench").value.trim() || "SPY";
  const h = +$("cHoriz").value;
  box.innerHTML = `<div class="msg">Midiendo…</div>`;
  try {
    const d = await api(`/api/riesgo?t=${encodeURIComponent(t)}&b=${encodeURIComponent(b)}`);
    const p = d.perfil;
    const v = (p.ventanas || []).find((x) => x.dias === h) || {};

    const umbral = {
      vol: +$("cVol").value, dd: +$("cDD").value, pos: +$("cPos").value,
      beta: +$("cBeta").value, saltos: +$("cSaltos").value
    };

    const criterios = [
      { t: `Volatilidad anual por debajo de ${umbral.vol}%`, val: p.volAnual, ok: p.volAnual <= umbral.vol, txt: `${n2(p.volAnual, 1)}%` },
      { t: `Caída máxima histórica menor a ${umbral.dd}%`, val: Math.abs(p.maxDrawdown), ok: Math.abs(p.maxDrawdown) <= umbral.dd, txt: `${n2(p.maxDrawdown, 1)}%` },
      { t: `Al menos ${umbral.pos}% de las ventanas de ${h} ruedas terminaron en verde`, val: v.pctPositivas, ok: (v.pctPositivas ?? 0) >= umbral.pos, txt: v.pctPositivas === undefined ? "sin datos" : `${n2(v.pctPositivas, 1)}%` },
      { t: `Beta por debajo de ${umbral.beta}`, val: p.beta, ok: p.beta === null ? null : p.beta <= umbral.beta, txt: p.beta === null ? "sin referencia" : n2(p.beta) },
      { t: `Menos de ${umbral.saltos}% de ruedas con saltos de ±5%`, val: p.diasMas5, ok: p.diasMas5 <= umbral.saltos, txt: `${n2(p.diasMas5, 1)}%` }
    ];
    const evaluables = criterios.filter((c) => c.ok !== null);
    const cumple = evaluables.filter((c) => c.ok).length;

    const lista = criterios.map((c) =>
      `<div class="crit"><b class="${c.ok === null ? "" : c.ok ? "ok" : "no"}">${c.ok === null ? "–" : c.ok ? "✓" : "✗"}</b>
        <span>${esc(c.t)}<br><span style="color:var(--faint);font-family:var(--mono);font-size:12px">medido: ${esc(c.txt)}</span></span></div>`).join("");

    const tabla = `<div class="card"><h3>Frecuencia histórica por ventana de tenencia</h3>
      <table><tr><th>Ruedas</th><th class="n">Muestras</th><th class="n">En verde</th><th class="n">Mediana</th><th class="n">Peor 10%</th><th class="n">Mejor 10%</th><th class="n">Expectativa</th></tr>
      ${(p.ventanas || []).filter((x) => x.muestras > 20).map((x) =>
        `<tr${x.dias === h ? ' style="background:var(--panel2)"' : ""}><td>${x.dias}</td><td class="n">${x.muestras}</td>
          <td class="n ${x.pctPositivas >= 50 ? "up" : "down"}">${n2(x.pctPositivas, 1)}%</td>
          <td class="n ${cls(x.mediana)}">${sign(x.mediana, 1)}</td>
          <td class="n down">${n2(x.p10, 1)}%</td><td class="n up">+${n2(x.p90, 1)}%</td>
          <td class="n ${cls(x.expectativa)}">${sign(x.expectativa, 2)}</td></tr>`).join("")}
      </table>
      <p class="sub" style="margin:12px 0 0"><b>Leer con cuidado:</b> "en verde" es con qué frecuencia una ventana de esas ruedas terminó arriba <em>en este período medido</em>. No es la probabilidad de que te pase a vos: el pasado no reparte el futuro, y un período alcista infla todas estas cifras.</p></div>`;

    const cabecera = `<div class="card">
      <div class="veredicto">${cumple} de ${evaluables.length} criterios tuyos se cumplen</div>
      <p class="sub" style="margin:0 0 12px">${esc(d.ticker)} · ${esc(d.desde)} a ${esc(d.hasta)} · referencia ${esc(d.benchmark || "—")}</p>
      ${lista}</div>`;

    const prompt =
`Evaluá ${d.ticker} contra los criterios que definió la persona, sobre datos de ${d.desde} a ${d.hasta}.

CRITERIOS Y MEDICIONES
${criterios.map((c) => `${c.ok === null ? "–" : c.ok ? "CUMPLE" : "NO CUMPLE"} · ${c.t} · medido: ${c.txt}`).join("\n")}
Resultado: ${cumple} de ${evaluables.length}

FRECUENCIA HISTÓRICA (ventana de ${h} ruedas)
Ventanas medidas: ${v.muestras} · terminaron en verde: ${n2(v.pctPositivas, 1)}%
Mediana ${sign(v.mediana, 1)} · peor 10% ${n2(v.p10, 1)}% · mejor 10% +${n2(v.p90, 1)}%
Ganancia media cuando ganó ${sign(v.mediaGana, 1)} · pérdida media cuando perdió ${n2(v.mediaPierde, 1)}%
Expectativa histórica por ventana: ${sign(v.expectativa, 2)}

Devolvé:

1. QUÉ DICEN ESTOS NÚMEROS Y QUÉ NO
   Traducilos. Y decí explícitamente qué NO se puede concluir de ellos.

2. EL CRITERIO QUE MÁS PESA
   De los que no se cumplen, cuál es el más serio y por qué. Si se cumplen todos, cuál es el más frágil ante un cambio de contexto.

3. EL SESGO DEL PERÍODO MEDIDO
   ¿El tramo medido fue alcista, bajista o mixto? ¿Cuánto de la "frecuencia en verde" es mérito del activo y cuánto del mercado de esos años?

4. LO QUE NINGÚN CRITERIO NUMÉRICO CAPTURA
   Riesgos que no viven en la serie de precios.

5. CÓMO AJUSTARÍA LOS CRITERIOS
   Si los umbrales elegidos son laxos o exigentes para este tipo de activo, decilo y proponé una alternativa razonada.

Reglas estrictas: NO digas si conviene invertir, ni si comprar, vender o mantener. No sugieras tamaño de posición. La regla la puso la persona; tu trabajo es decir qué tan buena es la regla y qué se le escapa.`;

    dossier(box, "Prompt de evaluación por criterios", prompt, cabecera + tabla);
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
    status(`${state.price.ticker} · ${state.price.stats.date} · ${state.price.source || ""}`);
    state.rival = null;
    state.rivalError = r ? null : "No cargaste un segundo ticker en el campo de la derecha.";
    if (r) {
      try { state.rival = await api(`/api/price?t=${encodeURIComponent(r)}`); }
      catch (e) { state.rivalError = e.message; }
    }
    renderFoso();
  } catch (e) {
    status(e.message, true);
    $("stats").innerHTML = `<div class="msg err" style="grid-column:1/-1">${esc(e.message)}</div>`;
  } finally {
    $("load").disabled = false;
  }
}

(async () => {
  try {
    IA = await api("/api/estado");
    $("iaEstado").textContent = IA.ia ? `IA: ${IA.proveedor}` : "IA: sin clave";
    $("iaEstado").style.color = IA.ia ? "var(--up)" : "";
    $("iaEstado").title = IA.ia
      ? "La clave se lee del .env local y nunca sale de esta máquina"
      : "Poné GEMINI_API_KEY (gratis) o ANTHROPIC_API_KEY en el .env para analizar sin copiar y pegar";
  } catch { /* el estado de la IA no es crítico */ }
})();

$("load").addEventListener("click", load);
$("ticker").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
$("rival").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
load();
