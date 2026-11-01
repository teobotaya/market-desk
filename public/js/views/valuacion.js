import { esc, num, pct, pctS, precio, grande, veces, cls, kpi, cargando, errorHtml, api, tarjeta, fecha, pref, setPref, qs, tablaOrdenable } from "../util.js";
import { barraRango, graficoLineas } from "../charts.js";
import { dossier } from "../dossier.js";

export default {
  id: "valuacion",
  titulo: "Valuación y comparables",
  icono: "⚖",
  requiereTicker: true,
  descripcion: "El PER en tres lecturas: el de hoy, el rango en el que cotizó la propia empresa (con el beneficio que se conocía cada día) y el de sus pares, más una tabla de comparables con P/V, EV/EBITDA, márgenes y crecimiento. Los pares los elegís vos.",

  async render(el, ctx) {
    const guardados = pref(`pares.${ctx.ticker}`, "");
    el.innerHTML = `
      <section class="card">
        <div class="fila" style="margin:0">
          <label>Pares <input data-pares style="width:320px;text-transform:uppercase;font-family:var(--mono)" value="${esc(guardados)}" placeholder="AMD, AVGO, INTC…" aria-label="Pares separados por coma"></label>
          <button class="btn" data-sugerir title="Sugerencias de Yahoo (y Finnhub si tenés clave)">Sugerir pares</button>
          <button class="btn primario" data-calc>Calcular</button>
          <span class="nota" data-estado style="margin:0"></span>
        </div>
      </section>
      <div data-out></div><div data-ia></div>`;
    const inp = el.querySelector("[data-pares]");
    const estado = el.querySelector("[data-estado]");

    const sugerir = async () => {
      estado.textContent = "Buscando pares…";
      try {
        const r = await api(`/api/pares?t=${encodeURIComponent(ctx.ticker)}`);
        if (r.pares.length) { inp.value = r.pares.slice(0, 6).join(", "); estado.textContent = `Sugeridos por ${r.fuente}: revisalos, son un punto de partida.`; }
        else estado.textContent = "No hubo sugerencias: escribilos a mano.";
      } catch (e) { estado.textContent = `Sin sugerencias (${e.message}).`; }
    };
    el.querySelector("[data-sugerir]").addEventListener("click", sugerir);

    const calcular = async () => {
      const pares = inp.value.trim();
      setPref(`pares.${ctx.ticker}`, pares);
      const out = el.querySelector("[data-out]");
      out.innerHTML = cargando("Reconstruyendo el PER histórico y bajando cada par de la SEC (la primera vez tarda)…");
      el.querySelector("[data-ia]").innerHTML = "";
      try {
        const d = await api(`/api/per?${qs({ t: ctx.ticker, pares })}`);
        pintar(el, d, ctx);
      } catch (e) { out.innerHTML = errorHtml(e); }
    };
    el.querySelector("[data-calc]").addEventListener("click", calcular);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") calcular(); });

    if (!guardados) await sugerir();
    await calcular();
  }
};

function pintar(el, d, ctx) {
  const h = d.historico;
  const banda = h.percentilActual >= 80 ? ["down", "en la parte alta de su propio rango"]
    : h.percentilActual <= 20 ? ["up", "en la parte baja de su propio rango"] : ["warn", "en la zona media de su propio rango"];
  const out = el.querySelector("[data-out]");
  const conPer = d.pares.filter((p) => p.per > 0);
  out.innerHTML = `
    ${d.aviso ? `<div class="msg">${esc(d.aviso)}</div>` : ""}
    <div class="kpis compactos">
      ${kpi("PER actual", veces(d.actual), `BPA ${num(d.eps, 2)} · ${esc(d.baseEps)}`)}
      ${kpi("Mediana propia", veces(h.mediana), `${fecha(h.desde)} a ${fecha(h.hasta)}`)}
      ${kpi("vs su mediana", pctS(d.vsPropioMediana, 0), banda[1], cls(d.vsPropioMediana))}
      ${kpi("Percentil histórico", num(h.percentilActual, 0), "de 100 · más alto = más caro que su historia", banda[0])}
      ${kpi("Mediana de pares", veces(d.medianaPares), `${conPer.length} comparables con beneficio`)}
      ${kpi("vs pares", pctS(d.vsPares, 0), "prima o descuento", cls(d.vsPares))}
    </div>
    <div class="grid2 bloque">
      ${tarjeta("PER histórico", `<div data-g></div><p class="nota">PER de cada rueda con el beneficio de 12 meses que ya estaba publicado ese día (sin mirar el futuro). Banda: percentiles 25 a 75. ${h.ruedas} ruedas.</p>`)}
      ${tarjeta("Dónde cotiza hoy dentro de su rango", `${barraRango(h.min, h.max, d.actual, [{ v: h.p25, t: "p25" }, { v: h.mediana, t: "mediana", eje: true }, { v: h.p75, t: "p75" }], { fmt: (v) => veces(v) })}
        <p class="nota" style="margin-top:14px"><b>Barato respecto de su historia no significa barato:</b> si el negocio se deterioró, un PER bajo puede estar bien puesto. Y al revés, un PER alto puede reflejar un negocio que mejoró.</p>`)}
    </div>
    ${tarjeta("Comparables", `<div data-comps></div><p class="nota">Valores de los últimos 12 meses (o del último ejercicio si la empresa no publica trimestres). Los pares los elegís vos, a propósito: un "PER del sector" promediado a ciegas mezcla negocios que no se parecen.</p>`)}`;

  graficoLineas(out.querySelector("[data-g]"), [{ nombre: "PER", datos: h.serie.map((x) => ({ d: x.d, v: x.per })), color: "var(--c1)" }], {
    alto: 220, fmtY: (v) => veces(v), bandas: [{ desde: h.p25, hasta: h.p75, color: "var(--accent)", opacidad: 0.1 }],
    lineasY: [{ v: h.mediana, etiqueta: `mediana ${veces(h.mediana)}`, color: "var(--faint)" }]
  });

  const propia = { ticker: d.ticker, empresa: d.empresa, per: d.actual, destacada: true };
  const tabla = tablaOrdenable(out.querySelector("[data-comps]"), {
    claseFila: (f) => (f.destacada ? "destacada" : ""),
    columnas: [
      { k: "ticker", t: "Ticker", fmt: (v, f) => `<b>${esc(v)}</b>${f.error ? `<span class="sub">${esc(f.error)}</span>` : `<span class="sub">${esc(f.empresa || "")}</span>`}` },
      { k: "capitalizacion", t: "Capitaliz.", n: true, fmt: grande },
      { k: "per", t: "PER", n: true, fmt: (v) => veces(v) },
      { k: "precioVentas", t: "P/V", n: true, fmt: (v) => veces(v, 2) },
      { k: "evEbitda", t: "EV/EBITDA", n: true, fmt: (v) => veces(v) },
      { k: "rentabilidadFcf", t: "Rent. FCF", n: true, fmt: (v) => pct(v) },
      { k: "crecimiento", t: "Crec. ingr.", n: true, fmt: (v) => pctS(v, 1), cls },
      { k: "margenBruto", t: "Mg. bruto", n: true, fmt: (v) => pct(v) },
      { k: "margenOperativo", t: "Mg. oper.", n: true, fmt: (v) => pct(v) },
      { k: "roic", t: "ROIC", n: true, fmt: (v) => pct(v) },
      { k: "deudaNetaEbitda", t: "DN/EBITDA", n: true, fmt: (v) => veces(v, 2) }
    ],
    filas: [propia, ...d.pares],
    nombreCsv: `comparables-${d.ticker}`,
    alClick: (f) => !f.destacada && !f.error && ctx.cargarTicker(f.ticker, "fundamentales")
  });
  /* La fila propia se completa con sus fundamentales si ya están en memoria. */
  ctx.memo("fund", () => api(`/api/fundamentales?t=${encodeURIComponent(ctx.ticker)}`)).then((f) => {
    Object.assign(propia, {
      capitalizacion: f.valuacion?.capitalizacion, precioVentas: f.valuacion?.precioVentas, evEbitda: f.valuacion?.evEbitda,
      rentabilidadFcf: f.valuacion?.rentabilidadFcf, crecimiento: f.ttm.crecimiento, margenBruto: f.ttm.margenBruto,
      margenOperativo: f.ttm.margenOperativo, roic: f.ttm.roic, deudaNetaEbitda: f.ttm.deudaNetaEbitda
    });
    tabla.redibujar();
  }).catch(() => {});

  const m = d.medianas || {};
  const prompt =
`Interpretá la valuación de ${d.empresa} (${d.ticker}) cruzando sus tres referencias de PER y la tabla de comparables.

PER ACTUAL: ${veces(d.actual)} — precio ${precio(d.precio)} del ${fecha(d.fecha)}, beneficio por acción ${num(d.eps, 2)} (${d.baseEps}, hasta ${fecha(d.ejercicio)}).

CONTRA SU PROPIA HISTORIA (${fecha(h.desde)} a ${fecha(h.hasta)}, ${h.ruedas} ruedas)
Mínimo ${veces(h.min)} · p25 ${veces(h.p25)} · mediana ${veces(h.mediana)} · p75 ${veces(h.p75)} · máximo ${veces(h.max)}
Hoy está en el percentil ${num(h.percentilActual, 0)} y ${pctS(d.vsPropioMediana, 0)} respecto de su mediana.

COMPARABLES (12 meses)
${d.pares.map((p) => (p.error ? `- ${p.ticker}: sin datos (${p.error})` : `- ${p.ticker}: PER ${veces(p.per)} · P/V ${veces(p.precioVentas, 2)} · EV/EBITDA ${veces(p.evEbitda)} · crec. ${pctS(p.crecimiento, 1)} · mg. op. ${pct(p.margenOperativo)} · ROIC ${pct(p.roic)}`)).join("\n") || "(sin pares)"}
Medianas de pares: PER ${veces(m.per)} · P/V ${veces(m.precioVentas, 2)} · EV/EBITDA ${veces(m.evEbitda)} · mg. op. ${pct(m.margenOperativo)} · crec. ${pctS(m.crecimiento, 1)}
La empresa cotiza ${pctS(d.vsPares, 0)} respecto de la mediana de PER de sus pares.

Devolvé:

1. QUÉ ESTÁ DESCONTANDO EL PRECIO
   Qué crecimiento de beneficios haría falta para justificar el PER actual. Mostrá el razonamiento con números.

2. LAS TRES LECTURAS, POR SEPARADO
   Contra su historia, contra sus pares y en términos absolutos. Si se contradicen, decí cuál pesa más y por qué.

3. ¿LA PRIMA O EL DESCUENTO SE EXPLICA?
   Cruzá el múltiplo con crecimiento, márgenes y ROIC de cada par. Una prima con mejores márgenes y más crecimiento no es lo mismo que una prima sin fundamento.

4. LA TRAMPA DE CADA COMPARACIÓN
   Por qué el rango histórico puede engañar (cambio de negocio, de tasas) y por qué los pares pueden engañar (no comparables, ciclos distintos).

5. EL PER NO ES SUFICIENTE
   Qué otras métricas habría que mirar antes de concluir en este caso concreto.

Reglas: no digas si comprar, vender o mantener. No des precio objetivo. No digas "está barata" sin aclarar respecto de qué.`;
  dossier(el.querySelector("[data-ia]"), { titulo: "Valuación por múltiplos", prompt });
}
