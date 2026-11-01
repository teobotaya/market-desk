import { esc, num, pct, pctS, cls, cargando, errorHtml, api, tarjeta, fecha, pref, setPref, qs } from "../util.js";
import { dossier } from "../dossier.js";
import { referenciaPorDefecto } from "./riesgo.js";

const DEF = { vol: 50, dd: 35, pos: 55, beta: 2, saltos: 5, horiz: 21, sharpe: 0.5 };

export default {
  id: "criterios",
  titulo: "Mis criterios",
  icono: "☑",
  requiereTicker: true,
  descripcion: "Vos definís los umbrales y quedan guardados; la app mide y dice cuáles se cumplen. <b>La regla es tuya, la aritmética es de la app y la decisión también es tuya.</b> Todo se calcula sobre lo que ya pasó.",

  async render(el, ctx) {
    const u = { ...DEF, ...pref("criterios", {}) };
    const campo = (id, k, x, paso) => `<div class="kpi"><div class="k">${esc(k)}</div><input data-u="${id}" type="number" value="${u[id]}" step="${paso}" style="width:100%;margin-top:4px;font-family:var(--mono)"><div class="x">${esc(x)}</div></div>`;
    el.innerHTML = `
      <div class="kpis">
        ${campo("vol", "Volatilidad anual máx.", "% anualizado", 5)}
        ${campo("dd", "Caída máxima tolerada", "% desde un máximo", 5)}
        ${campo("pos", "Mín. ventanas positivas", "% al horizonte elegido", 5)}
        ${campo("beta", "Beta máxima", "vs la referencia", 0.1)}
        ${campo("saltos", "Máx. días de ±5%", "% de las ruedas", 1)}
        ${campo("sharpe", "Sharpe mínimo", "retorno / volatilidad", 0.1)}
        <div class="kpi"><div class="k">Horizonte</div><select data-u="horiz" style="width:100%;margin-top:4px">${[5, 10, 21, 63].map((n) => `<option value="${n}"${n === u.horiz ? " selected" : ""}>${n} ruedas</option>`).join("")}</select><div class="x">cuánto pensás mantenerlo</div></div>
      </div>
      <div class="fila"><button class="btn primario" data-eval>Evaluar ${esc(ctx.ticker)}</button><span class="nota" style="margin:0">Referencia: ${esc(referenciaPorDefecto(ctx.ticker))} (se cambia en Perfil de riesgo) · últimos 2 años.</span></div>
      <div data-out></div><div data-ia></div>`;

    const evaluar = async () => {
      el.querySelectorAll("[data-u]").forEach((i) => { u[i.dataset.u] = Number(i.value); });
      setPref("criterios", u);
      const out = el.querySelector("[data-out]");
      out.innerHTML = cargando("Midiendo…");
      el.querySelector("[data-ia]").innerHTML = "";
      try {
        const b = referenciaPorDefecto(ctx.ticker);
        const d = await ctx.memo(`riesgo:${b}:2y`, () => api(`/api/riesgo?${qs({ t: ctx.ticker, b, rango: "2y", usd: ctx.usdCcl ? "ccl" : "" })}`));
        pintar(el, d, u);
      } catch (e) { out.innerHTML = errorHtml(e); }
    };
    el.querySelector("[data-eval]").addEventListener("click", evaluar);
    await evaluar();
  }
};

function pintar(el, d, u) {
  const p = d.perfil, h = u.horiz;
  const v = (p.ventanas || []).find((x) => x.dias === h) || {};
  const criterios = [
    { t: `Volatilidad anual por debajo de ${num(u.vol, 0)}%`, ok: p.volAnual <= u.vol, txt: pct(p.volAnual) },
    { t: `Caída máxima menor a ${num(u.dd, 0)}%`, ok: Math.abs(p.maxDrawdown) <= u.dd, txt: pct(p.maxDrawdown) },
    { t: `Al menos ${num(u.pos, 0)}% de las ventanas de ${h} ruedas terminaron en verde`, ok: v.pctPositivas === undefined ? null : v.pctPositivas >= u.pos, txt: v.pctPositivas === undefined ? "sin datos" : pct(v.pctPositivas) },
    { t: `Beta por debajo de ${num(u.beta, 1)}`, ok: p.beta === null ? null : p.beta <= u.beta, txt: p.beta === null ? "sin referencia" : num(p.beta, 2) },
    { t: `Menos de ${num(u.saltos, 0)}% de ruedas con saltos de ±5%`, ok: p.diasMas5 <= u.saltos, txt: pct(p.diasMas5) },
    { t: `Sharpe de al menos ${num(u.sharpe, 1)}`, ok: p.sharpe === null ? null : p.sharpe >= u.sharpe, txt: num(p.sharpe, 2) }
  ];
  const evaluables = criterios.filter((c) => c.ok !== null);
  const cumple = evaluables.filter((c) => c.ok).length;
  const out = el.querySelector("[data-out]");
  out.innerHTML = `<div class="grid2 bloque">
    ${tarjeta("Resultado", `<div class="veredicto ${cumple === evaluables.length ? "up" : cumple === 0 ? "down" : "warn"}">${cumple} de ${evaluables.length} criterios se cumplen</div>
      <p class="nota" style="margin:0 0 8px">${esc(d.ticker)} · ${fecha(d.desde)} a ${fecha(d.hasta)} · referencia ${esc(d.benchmark || "—")}</p>
      ${criterios.map((c) => `<div class="crit"><b class="${c.ok === null ? "" : c.ok ? "ok" : "no"}">${c.ok === null ? "–" : c.ok ? "✓" : "✗"}</b><span>${esc(c.t)}<br><span class="faint" style="font-family:var(--mono);font-size:12px">medido: ${esc(c.txt)}</span></span></div>`).join("")}`)}
    ${tarjeta("Frecuencia histórica por ventana de tenencia", `<div class="tabla-scroll"><table><thead><tr><th>Ruedas</th><th class="n">Muestras</th><th class="n">En verde</th><th class="n">Mediana</th><th class="n">Peor 10%</th><th class="n">Mejor 10%</th><th class="n">Expectativa</th></tr></thead><tbody>
      ${(p.ventanas || []).filter((x) => x.muestras > 20).map((x) => `<tr class="${x.dias === h ? "destacada" : ""}"><td>${x.dias}</td><td class="n">${x.muestras}</td>
        <td class="n ${x.pctPositivas >= 50 ? "up" : "down"}">${pct(x.pctPositivas)}</td><td class="n ${cls(x.mediana)}">${pctS(x.mediana, 1)}</td>
        <td class="n down">${pct(x.p10)}</td><td class="n up">${pctS(x.p90, 1)}</td><td class="n ${cls(x.expectativa)}">${pctS(x.expectativa, 2)}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="nota"><b>Leer con cuidado:</b> "en verde" es con qué frecuencia una ventana terminó arriba <em>en este período</em>. No es la probabilidad de que te pase a vos: un período alcista infla todas estas cifras. Las ventanas se superponen, así que no son independientes.</p>`)}
  </div>`;

  const prompt =
`Evaluá ${d.ticker} contra los criterios que definió la persona, sobre datos de ${fecha(d.desde)} a ${fecha(d.hasta)}.

CRITERIOS Y MEDICIONES
${criterios.map((c) => `${c.ok === null ? "–" : c.ok ? "CUMPLE" : "NO CUMPLE"} · ${c.t} · medido: ${c.txt}`).join("\n")}
Resultado: ${cumple} de ${evaluables.length}

FRECUENCIA HISTÓRICA (ventana de ${h} ruedas)
Ventanas medidas: ${v.muestras ?? "—"} · terminaron en verde: ${pct(v.pctPositivas)}
Mediana ${pctS(v.mediana, 1)} · peor 10% ${pct(v.p10)} · mejor 10% ${pctS(v.p90, 1)}
Ganancia media cuando ganó ${pctS(v.mediaGana, 1)} · pérdida media cuando perdió ${pct(v.mediaPierde)}
Expectativa histórica por ventana: ${pctS(v.expectativa, 2)}
Retorno total del período ${pctS(p.retornoTotal, 1)}${p.retornoBench !== null ? ` vs referencia ${pctS(p.retornoBench, 1)}` : ""}

Devolvé:
1. QUÉ DICEN ESTOS NÚMEROS Y QUÉ NO: traducilos y decí explícitamente qué NO se puede concluir.
2. EL CRITERIO QUE MÁS PESA: de los que no se cumplen, el más serio; si se cumplen todos, el más frágil ante un cambio de contexto.
3. EL SESGO DEL PERÍODO: ¿el tramo fue alcista, bajista o mixto? ¿Cuánto de la "frecuencia en verde" es mérito del activo y cuánto del mercado?
4. LO QUE NINGÚN CRITERIO NUMÉRICO CAPTURA.
5. CÓMO AJUSTARÍA LOS CRITERIOS: si los umbrales son laxos o exigentes para este tipo de activo, con una alternativa razonada.

Reglas estrictas: NO digas si conviene invertir, ni si comprar, vender o mantener. No sugieras tamaño de posición. Tu trabajo es decir qué tan buena es la regla y qué se le escapa.`;
  dossier(el.querySelector("[data-ia]"), { titulo: "Evaluación por criterios", prompt });
}
