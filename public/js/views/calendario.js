import { esc, grande, fecha, cargando, errorHtml, api, tarjeta, qs } from "../util.js";
import { widgetTradingView } from "./tradingview.js";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export default {
  id: "calendario",
  titulo: "Calendario",
  icono: "◷",
  descripcion: "Balances de los próximos días hábiles (empresas de más de 10 mil M de dólares y las de tu watchlist, marcadas con ★) y el calendario económico mundial.",

  async render(el, ctx) {
    el.innerHTML = `<div data-bal>${cargando("Calendario de balances (Nasdaq)…")}</div>
      ${tarjeta("Calendario económico", `<div class="tv" data-tv></div><p class="nota">Widget gratuito de TradingView: datos macro de Argentina, EE.UU., Brasil, Europa, China, Japón y Reino Unido, con previsión y dato anterior. Se carga desde tradingview.com.</p>`)}`;
    widgetTradingView(el.querySelector("[data-tv]"), "events", {
      colorTheme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
      isTransparent: true, width: "100%", height: "100%", locale: "es", importanceFilter: "0,1", countryFilter: "ar,us,br,eu,cn,jp,gb"
    });
    try {
      const watch = ctx.watchlist().filter((t) => !/[\^=]/.test(t));
      const d = await api(`/api/mercado/calendario?${qs({ dias: 7, t: watch.join(",") })}`);
      const filas = d.dias.map((dia) => {
        const f = new Date(`${dia.fecha}T12:00:00`);
        const titulo = `<tr><td colspan="7" class="grupo-titulo" style="padding-top:14px">${DIAS[f.getDay()]} ${fecha(dia.fecha)}</td></tr>`;
        if (dia.error) return `${titulo}<tr><td colspan="7" class="down">${esc(dia.error)}</td></tr>`;
        if (!dia.filas.length) return `${titulo}<tr><td colspan="7" class="faint">Sin balances de empresas grandes.</td></tr>`;
        return titulo + dia.filas.slice(0, 25).map((r) => `<tr class="clic" data-t="${esc(r.ticker)}"><td><b>${r.enWatchlist ? "★ " : ""}${esc(r.ticker)}</b></td><td>${esc(r.empresa)}</td><td>${esc(r.momento)}</td>
          <td class="n">${grande(r.capitalizacion)}</td><td class="n">${esc(r.bpaEstimado || "—")}</td><td class="n">${esc(r.bpaAnioAnterior || "—")}</td><td class="n">${esc(r.estimaciones || "—")}</td></tr>`).join("");
      }).join("");
      el.querySelector("[data-bal]").innerHTML = tarjeta("Balances de los próximos días", `<div class="tabla-scroll"><table>
        <thead><tr><th>Ticker</th><th>Empresa</th><th>Momento</th><th class="n">Capitalización</th><th class="n">BPA estimado</th><th class="n">BPA año anterior</th><th class="n">Estimaciones</th></tr></thead>
        <tbody>${filas}</tbody></table></div><p class="nota">${esc(d.fuente)}. Tocá una fila para ver sus fundamentales y el consenso.</p>`);
      el.querySelectorAll("tr[data-t]").forEach((tr) => tr.addEventListener("click", () => ctx.cargarTicker(tr.dataset.t, "fundamentales")));
    } catch (e) {
      el.querySelector("[data-bal]").innerHTML = tarjeta("Balances", errorHtml(e));
    }
  }
};
