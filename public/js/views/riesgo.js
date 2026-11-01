import { esc, num, pct, pctS, veces, cls, kpi, cargando, errorHtml, api, tarjeta, fecha, pref, setPref, qs } from "../util.js";
import { graficoLineas } from "../charts.js";
import { dossier } from "../dossier.js";

export const referenciaPorDefecto = (t) => (String(t).endsWith(".BA") ? "^MERV" : pref("riesgo.bench", "SPY"));

export default {
  id: "riesgo",
  titulo: "Perfil de riesgo",
  icono: "◬",
  requiereTicker: true,
  descripcion: "Cuánto se movió el activo y con qué violencia, medido contra una referencia. <b>Todo describe el pasado:</b> estas cifras acotan expectativas, no predicen.",

  async render(el, ctx) {
    el.innerHTML = `
      <section class="card"><div class="fila" style="margin:0">
        <label>Referencia <input class="tk" data-bench value="${esc(referenciaPorDefecto(ctx.ticker))}" aria-label="Referencia"></label>
        <div class="segmentos" data-rango>${[["1y", "1 año"], ["2y", "2 años"], ["5y", "5 años"]].map(([k, t]) => `<button data-v="${k}" aria-pressed="${k === pref("riesgo.rango", "2y")}">${t}</button>`).join("")}</div>
        <button class="btn primario" data-medir>Medir</button>
      </div></section>
      <div data-out></div><div data-iv></div><div data-ia></div>`;
    let rango = pref("riesgo.rango", "2y");
    const medir = async () => {
      const b = el.querySelector("[data-bench]").value.trim().toUpperCase() || "SPY";
      if (!ctx.ticker.endsWith(".BA")) setPref("riesgo.bench", b);
      const out = el.querySelector("[data-out]");
      out.innerHTML = cargando("Midiendo…");
      el.querySelector("[data-ia]").innerHTML = "";
      try {
        const d = await ctx.memo(`riesgo:${b}:${rango}`, () => api(`/api/riesgo?${qs({ t: ctx.ticker, b, rango, usd: ctx.usdCcl ? "ccl" : "" })}`));
        pintar(el, d);
      } catch (e) { out.innerHTML = errorHtml(e); }
    };
    el.querySelector("[data-medir]").addEventListener("click", medir);
    el.querySelector("[data-bench]").addEventListener("keydown", (e) => { if (e.key === "Enter") medir(); });
    el.querySelector("[data-rango]").addEventListener("click", (e) => {
      const btn = e.target.closest("button"); if (!btn) return;
      rango = btn.dataset.v; setPref("riesgo.rango", rango);
      el.querySelectorAll("[data-rango] button").forEach((x) => x.setAttribute("aria-pressed", String(x === btn)));
      medir();
    });

    /* Volatilidad implícita: solo acciones de EE.UU. con opciones. */
    if (!/[.^=]|-USD/.test(ctx.ticker)) {
      ctx.memo("iv", () => api(`/api/iv?t=${encodeURIComponent(ctx.ticker)}`)).then((v) => {
        el.querySelector("[data-iv]").innerHTML = tarjeta("Volatilidad implícita de las opciones", `
          <div class="tabla-scroll"><table><thead><tr><th>Plazo</th><th class="n">Implícita</th><th class="n">Percentil IV</th><th class="n">Histórica</th><th class="n">Percentil HV</th><th class="n">IV / HV</th></tr></thead><tbody>
          ${v.plazos.map((p) => `<tr><td>${esc(p.plazo)}</td><td class="n"><b>${pct(p.iv)}</b></td><td class="n ${p.ivPercentil > 80 ? "warn" : ""}">${num(p.ivPercentil, 0)}</td><td class="n">${pct(p.hv)}</td><td class="n">${num(p.hvPercentil, 0)}</td><td class="n">${veces(p.ivHv, 2)}</td></tr>`).join("")}
          </tbody></table></div>
          <p class="nota">La volatilidad implícita es cuánto movimiento está pagando hoy el mercado de opciones; el percentil la compara con su propia historia (el "IV rank" de las plataformas pagas). IV/HV mayor a 1: las opciones descuentan más movimiento que el reciente. ${esc(v.fuente)}.</p>`);
      }).catch(() => {});
    }
    await medir();
  }
};

function pintar(el, d) {
  const p = d.perfil;
  const out = el.querySelector("[data-out]");
  out.innerHTML = `
    <p class="nota" style="margin:0 0 10px">${esc(d.ticker)} (${esc(d.moneda)}) · ${fecha(d.desde)} a ${fecha(d.hasta)} · ${p.ruedas} ruedas · referencia ${esc(d.benchmark || "ninguna")}</p>
    <div class="grupo-titulo">Retorno y eficiencia</div>
    <div class="kpis compactos">
      ${kpi("Retorno del período", pctS(p.retornoTotal, 1), p.retornoBench !== null ? `${d.benchmark}: ${pctS(p.retornoBench, 1)}` : "", cls(p.retornoTotal))}
      ${kpi("Anualizado (CAGR)", pctS(p.cagr, 1), "", cls(p.cagr))}
      ${kpi("Sharpe", num(p.sharpe, 2), "sin tasa libre de riesgo", "", "Retorno anualizado sobre volatilidad. Arriba de 1 es bueno; usa tasa 0.")}
      ${kpi("Sortino", num(p.sortino, 2), "solo castiga caídas")}
      ${kpi("Calmar", num(p.calmar, 2), "CAGR / caída máxima")}
    </div>
    <div class="grupo-titulo">Volatilidad y sensibilidad</div>
    <div class="kpis compactos">
      ${kpi("Volatilidad anual", pct(p.volAnual), p.volBench ? `${d.benchmark}: ${pct(p.volBench)}` : "sin referencia", p.volAnual > 45 ? "warn" : "")}
      ${kpi("Veces la referencia", veces(p.volRelativa, 2), "cuánto más se mueve", p.volRelativa > 1.5 ? "warn" : "")}
      ${kpi("Beta", num(p.beta, 2), `correlación ${num(p.correl, 2)}`)}
      ${kpi("Semidesvío", pct(p.desvBajista), "volatilidad de las caídas")}
      ${kpi("Días de ±3%", pct(p.diasMas3), "de las ruedas")}
      ${kpi("Días de ±5%", pct(p.diasMas5), "de las ruedas")}
    </div>
    <div class="grupo-titulo">Pérdidas</div>
    <div class="kpis compactos">
      ${kpi("Peor día", pct(p.peorDia), `mejor: ${pctS(p.mejorDia, 1)}`, "down")}
      ${kpi("Peor semana", pct(p.peorSemana), "5 ruedas seguidas", "down")}
      ${kpi("Peor mes", pct(p.peorMes), "21 ruedas seguidas", "down")}
      ${kpi("VaR 95% diario", pct(p.var95), "1 de cada 20 días cae más", "warn")}
      ${kpi("CVaR 95%", pct(p.cvar95), "caída promedio de esos días", "warn")}
      ${kpi("VaR 99% diario", pct(p.var99), "1 de cada 100 días", "warn")}
      ${kpi("Caída máxima", pct(p.maxDrawdown), p.ruedasHastaRecuperar === null ? "todavía no recuperó" : `recuperó en ${p.ruedasHastaRecuperar} ruedas`, "down")}
    </div>
    <div class="grid2 bloque">
      ${tarjeta("Caídas desde máximos", `<div data-sub></div><p class="nota">Cuánto estaba por debajo de su máximo previo cada día. Peor tramo: ${fecha(p.ddPico)} a ${fecha(p.ddFondo)}.</p>`)}
      ${tarjeta("Volatilidad móvil de 63 ruedas", `<div data-vol></div><p class="nota">Anualizada. Muestra si el activo está en una fase tranquila o agitada respecto de su propia historia.</p>`)}
    </div>
    ${tarjeta("Cómo se lee", `<table>
      <tr><td><b>Volatilidad</b></td><td>Cuánto oscila el precio en un año. 15–20% es un índice tranquilo; arriba de 45% es un activo que se mueve fuerte todos los días.</td></tr>
      <tr><td><b>Beta</b></td><td>Cuánto se mueve cuando ${esc(d.benchmark || "la referencia")} se mueve 1%. Beta 1,5 amplifica subas <em>y</em> bajas. Con correlación baja, la beta dice poco.</td></tr>
      <tr><td><b>VaR y CVaR</b></td><td>En el 5% de los peores días, la caída fue al menos el VaR, y en promedio el CVaR. No es un piso: el peor día real fue ${pct(p.peorDia)}.</td></tr>
      <tr><td><b>Caída máxima</b></td><td>Lo que habrías perdido comprando en el peor momento y vendiendo en el fondo. La pregunta útil no es si es alta, sino si la aguantarías sin vender.</td></tr>
    </table>`)}`;
  graficoLineas(out.querySelector("[data-sub]"), [{ nombre: "Caída desde el máximo", datos: p.subagua, color: "var(--down)", area: true }], { alto: 190, fmtY: (v) => `${num(v, 0)}%`, fmtTip: (v) => pct(v) });
  graficoLineas(out.querySelector("[data-vol]"), [{ nombre: "Volatilidad 63r", datos: p.volMovil, color: "var(--c2)" }], { alto: 190, fmtY: (v) => `${num(v, 0)}%`, fmtTip: (v) => pct(v), desdeCero: true });

  const prompt =
`Poné en contexto el riesgo de ${d.ticker} (${d.moneda}), medido entre ${fecha(d.desde)} y ${fecha(d.hasta)} sobre ${p.ruedas} ruedas, contra ${d.benchmark || "ninguna referencia"}.

MEDICIONES
Retorno del período ${pctS(p.retornoTotal, 1)}${p.retornoBench !== null ? ` (referencia ${pctS(p.retornoBench, 1)})` : ""} · CAGR ${pctS(p.cagr, 1)} · Sharpe ${num(p.sharpe, 2)} · Sortino ${num(p.sortino, 2)}
Volatilidad anualizada ${pct(p.volAnual)}${p.volBench ? ` (referencia ${pct(p.volBench)}, o sea ${veces(p.volRelativa, 2)})` : ""}
Beta ${num(p.beta, 2)} · correlación ${num(p.correl, 2)} · semidesvío ${pct(p.desvBajista)}
VaR diario 95% ${pct(p.var95)} · CVaR 95% ${pct(p.cvar95)} · VaR 99% ${pct(p.var99)}
Peor día ${pct(p.peorDia)} · peor semana ${pct(p.peorSemana)} · peor mes ${pct(p.peorMes)}
Caída máxima ${pct(p.maxDrawdown)} (${fecha(p.ddPico)} a ${fecha(p.ddFondo)}) · ${p.ruedasHastaRecuperar === null ? "todavía no recuperó el máximo anterior" : `tardó ${p.ruedasHastaRecuperar} ruedas en recuperarlo`}
Ruedas con movimiento mayor a ±3%: ${pct(p.diasMas3)} · mayor a ±5%: ${pct(p.diasMas5)}

Devolvé:

1. QUÉ TIPO DE ACTIVO ES, EN RIESGO
   Traducí estos números a lenguaje llano frente a la referencia.

2. ¿EL RETORNO PAGÓ EL RIESGO?
   Interpretá Sharpe, Sortino y retorno contra la referencia. Aclaralo como dato del pasado.

3. QUÉ SIGNIFICA EN PLATA
   Con una posición hipotética de 1.000 dólares: día malo típico (VaR), promedio de los días malos (CVaR), peor día y peor racha.

4. QUÉ TENDRÍA QUE SOPORTAR QUIEN LO TUVIERA
   La caída máxima, cuánto duró, y qué hace falta para no vender en el fondo.

5. QUÉ NO MIDEN ESTOS NÚMEROS
   Riesgos que no aparecen en la serie de precios: concentración de clientes, regulación, iliquidez, eventos de cola, riesgo cambiario.

Reglas estrictas: NO recomiendes comprar, vender ni mantener. No sugieras tamaño de posición. Describí el riesgo medido y dejá la decisión a la persona.`;
  dossier(el.querySelector("[data-ia]"), { titulo: "Perfil de riesgo", prompt });
}
