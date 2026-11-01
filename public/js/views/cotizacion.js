import { esc, num, pct, pctS, precio, grande, veces, fecha, cls, kpi, cargando, api, qs, pref, setPref, tarjeta } from "../util.js";
import { graficoPrecio } from "../charts.js";
import { dossier } from "../dossier.js";
import { bloquePrecio, REGLAS } from "./comun.js";

const RANGOS = [["1M", 21, "2y"], ["3M", 63, "2y"], ["6M", 126, "2y"], ["1A", 252, "2y"], ["2A", 504, "2y"], ["5A", 1260, "5y"], ["10A", 2520, "10y"]];

export default {
  id: "cotizacion",
  titulo: "Cotización y técnico",
  icono: "◔",
  requiereTicker: true,
  descripcion: "Precio, medias, osciladores, volatilidad y volumen. El gráfico admite velas, Bollinger, RSI y comparación contra otro activo (en % desde el inicio del rango).",

  async render(el, ctx) {
    el.innerHTML = cargando("Bajando la serie de precios…");
    const p = await ctx.precio();
    const s = p.stats;
    const cfg = { rango: "6M", tipo: "linea", sma: [50, 200], bb: false, rsi: false, ...pref("grafico", {}) };

    el.innerHTML = `
      <section class="card">
        <div class="controles-grafico">
          <div class="segmentos" data-rango>${RANGOS.map(([r]) => `<button data-v="${r}" aria-pressed="${r === cfg.rango}">${r}</button>`).join("")}</div>
          <div class="segmentos" data-tipo><button data-v="linea" aria-pressed="${cfg.tipo === "linea"}">Línea</button><button data-v="velas" aria-pressed="${cfg.tipo === "velas"}">Velas</button></div>
          ${[20, 50, 200].map((n) => `<label class="chk"><input type="checkbox" data-sma="${n}" ${cfg.sma.includes(n) ? "checked" : ""}>SMA ${n}</label>`).join("")}
          <label class="chk"><input type="checkbox" data-bb ${cfg.bb ? "checked" : ""}>Bollinger</label>
          <label class="chk"><input type="checkbox" data-rsi ${cfg.rsi ? "checked" : ""}>RSI</label>
          <span class="espacio"></span>
          <input class="tk" data-comp placeholder="Comparar con…" aria-label="Comparar con otro ticker" title="Escribí un ticker y Enter: ambas series se muestran en % desde el inicio del rango">
        </div>
        <div data-grafico></div>
        <div class="leyenda" data-leyenda></div>
      </section>

      <div class="grupo-titulo">Rendimiento</div>
      <div class="kpis compactos">
        ${kpi("1 día", pctS(s.ret1), "", cls(s.ret1))}${kpi("5 días", pctS(s.ret5), "", cls(s.ret5))}${kpi("1 mes", pctS(s.ret21), "", cls(s.ret21))}
        ${kpi("3 meses", pctS(s.ret63), "", cls(s.ret63))}${kpi("6 meses", pctS(s.ret126), "", cls(s.ret126))}${kpi("En el año", pctS(s.retYtd), "", cls(s.retYtd))}${kpi("1 año", pctS(s.ret252), "", cls(s.ret252))}
      </div>
      <div class="grupo-titulo">Tendencia y momento</div>
      <div class="kpis compactos">
        ${kpi("vs SMA 20", pctS(s.vsSma20, 1), precio(s.sma20), cls(s.vsSma20))}${kpi("vs SMA 50", pctS(s.vsSma50, 1), precio(s.sma50), cls(s.vsSma50))}${kpi("vs SMA 200", pctS(s.vsSma200, 1), precio(s.sma200), cls(s.vsSma200))}
        ${kpi("RSI 14", num(s.rsi14, 0), s.rsi14 >= 70 ? "sobrecompra" : s.rsi14 <= 30 ? "sobreventa" : "neutral", s.rsi14 >= 70 || s.rsi14 <= 30 ? "warn" : "")}
        ${kpi("MACD − señal", num(s.macdHist, 3), s.macdHist > 0 ? "impulso positivo" : "impulso negativo", cls(s.macdHist))}
        ${kpi("Bollinger %B", num(s.bbPctB, 2), `ancho ${pct(s.bbAncho)}`, s.bbPctB > 1 || s.bbPctB < 0 ? "warn" : "", "0 = banda inferior, 1 = banda superior")}
        ${kpi("Cruce 50/200", s.cruce ? (s.cruce.tipo === "dorado" ? "dorado" : "muerte") : "—", s.cruce ? `${fecha(s.cruce.fecha)} · hace ${s.cruce.ruedas} r.` : "sin cruce en el período", s.cruce ? (s.cruce.tipo === "dorado" ? "up" : "down") : "")}
      </div>
      <div class="grupo-titulo">Volatilidad y rango</div>
      <div class="kpis compactos">
        ${kpi("Vol. 21 ruedas", pct(s.vol21), "anualizada", s.vol21 > 60 ? "warn" : "")}${kpi("Vol. 63 ruedas", pct(s.vol63), "anualizada")}${kpi("Vol. 1 año", pct(s.vol252), "anualizada")}
        ${kpi("ATR 14", precio(s.atr14), `${pct(s.atrPct)} del precio`, "", "Rango verdadero promedio: útil para dimensionar un stop")}
        ${kpi("Drawdown 1 año", pct(s.maxDrawdown), "peor caída desde un máximo", "down")}
        ${kpi("Máx. 52 sem.", precio(s.high52), pctS(s.fromHigh), cls(s.fromHigh))}${kpi("Mín. 52 sem.", precio(s.low52), pctS(s.fromLow), cls(s.fromLow))}
        ${kpi("Posición en rango", pct(s.posRango52, 0), "0 = mínimo, 100 = máximo")}
        ${kpi("Volumen relativo", veces(s.relVol, 2), `prom. 21r ${grande(s.avgVol21)}`, s.relVol > 1.5 ? "warn" : "")}
        ${p.rentaDividendo ? kpi("Dividendo 12m", pct(p.rentaDividendo, 2), `${precio(p.dividendos12m)} por acción`) : ""}
      </div>

      <div class="grid2">
        ${tarjeta("Lectura de los indicadores", `<ul class="lectura">${(p.lectura || []).map((l) => `<li class="${l.tono}">${esc(l.texto)}</li>`).join("") || "<li>Sin señales destacadas.</li>"}</ul>
          <p class="nota">Descripción automática de los números de arriba. <b>No es una señal de compra o venta</b>: los indicadores técnicos describen el precio pasado.</p>`)}
        ${tarjeta("Datos de la serie", `<table>
          <tr><td>Fuente</td><td class="n">${esc(p.source)}</td></tr>
          <tr><td>Bolsa / instrumento</td><td class="n">${esc([p.bolsa, p.instrumento].filter(Boolean).join(" · ") || "—")}</td></tr>
          <tr><td>Moneda</td><td class="n">${esc(p.moneda)}</td></tr>
          <tr><td>Ruedas cargadas</td><td class="n">${p.candles.length} (${fecha(p.candles[0].d)} a ${fecha(s.date)})</td></tr>
          ${p.splits?.length ? `<tr><td>Splits en el período</td><td class="n">${p.splits.map((x) => `${fecha(x.d)} (${num(x.factor, Number.isInteger(x.factor) ? 0 : 2)}:1)`).join(" · ")}</td></tr>` : ""}
          <tr><td>Último cambio</td><td class="n ${cls(s.cambio1)}">${num(s.cambio1, 2)}</td></tr>
        </table>`)}
      </div>
      <div data-ia></div>`;

    const graf = el.querySelector("[data-grafico]");
    let comparar = null;
    const series = new Map([["2y", p]]);

    const dibujar = async () => {
      const [, ruedas, rango] = RANGOS.find((r) => r[0] === cfg.rango) || RANGOS[2];
      let px = series.get(rango);
      if (!px) {
        graf.innerHTML = cargando(`Bajando ${cfg.rango} de historia…`);
        try { px = await ctx.precio(rango); series.set(rango, px); }
        catch (e) { graf.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
      }
      let comp = null;
      if (comparar) {
        try { comp = await api(`/api/price?${qs({ t: comparar, rango })}`); }
        catch (e) { comp = null; el.querySelector("[data-leyenda]").innerHTML = `<span class="down">${esc(e.message)}</span>`; }
      }
      graficoPrecio(graf, px.candles, {
        ruedas: Math.min(ruedas, px.candles.length), tipo: cfg.tipo, sma: cfg.sma, bb: cfg.bb, rsi: cfg.rsi,
        comparar: comp ? { nombre: comp.ticker, candles: comp.candles } : null, nombre: px.ticker
      });
      el.querySelector("[data-leyenda]").innerHTML = [
        comp ? `<span><i style="background:var(--accent)"></i>${esc(px.ticker)}</span><span><i style="background:var(--c5)"></i>${esc(comp.ticker)}</span>` : "",
        ...cfg.sma.map((n) => `<span><i style="background:var(${n === 20 ? "--c3" : n === 50 ? "--c2" : "--c4"})"></i>SMA ${n}</span>`),
        cfg.bb ? `<span><i style="background:var(--accent);opacity:.5"></i>Bollinger 20, 2σ</span>` : ""
      ].join("");
    };
    const guardar = () => setPref("grafico", cfg);

    el.querySelector("[data-rango]").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      cfg.rango = b.dataset.v; guardar();
      el.querySelectorAll("[data-rango] button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      dibujar();
    });
    el.querySelector("[data-tipo]").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      cfg.tipo = b.dataset.v; guardar();
      el.querySelectorAll("[data-tipo] button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      dibujar();
    });
    el.querySelectorAll("[data-sma]").forEach((c) => c.addEventListener("change", () => {
      cfg.sma = [...el.querySelectorAll("[data-sma]:checked")].map((x) => Number(x.dataset.sma)); guardar(); dibujar();
    }));
    el.querySelector("[data-bb]").addEventListener("change", (e) => { cfg.bb = e.target.checked; guardar(); dibujar(); });
    el.querySelector("[data-rsi]").addEventListener("change", (e) => { cfg.rsi = e.target.checked; guardar(); dibujar(); });
    el.querySelector("[data-comp]").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      comparar = e.target.value.trim().toUpperCase() || null;
      dibujar();
    });
    await dibujar();

    const prompt =
`Hacé una lectura técnica y de momento de ${p.ticker}, como la haría un analista escéptico. No describas la empresa.

DATOS DE PRECIO
${bloquePrecio(p)}

LECTURA AUTOMÁTICA DE LOS INDICADORES
${(p.lectura || []).map((l) => `- ${l.texto}`).join("\n") || "- sin señales destacadas"}

Devolvé:

1. TENDENCIA EN TRES PLAZOS
   Corto (días), medio (semanas) y largo (meses), cada uno con la cifra que lo sostiene. Señalá si se contradicen.

2. NIVELES QUE IMPORTAN
   Precios de referencia que surgen de los datos (medias, máximos y mínimos de 52 semanas, bandas) y por qué cada uno es relevante. No inventes niveles que no estén en los datos.

3. QUÉ TAN ESTIRADO ESTÁ EL MOVIMIENTO
   Usá RSI, %B, distancia a las medias y volatilidad. Distinguí "estirado" de "agotado".

4. ESCENARIOS
   Uno de continuidad y uno de reversión, cada uno con el dato observable que lo confirmaría y el que lo invalidaría.

5. LO QUE EL ANÁLISIS TÉCNICO NO VE
   Qué evento (balance, macro, regulación) podría volver irrelevante todo lo anterior en este horizonte.

${REGLAS}`;
    dossier(el.querySelector("[data-ia]"), { titulo: "Lectura técnica", prompt });
  }
};
