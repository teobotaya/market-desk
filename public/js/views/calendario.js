import { esc, grande, fecha, cargando, errorHtml, api, tarjeta, qs, pref, setPref } from "../util.js";
import { widgetTradingView } from "./tradingview.js";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export default {
  id: "calendario",
  titulo: "Calendario",
  icono: "◷",
  descripcion: "Balances de los próximos días hábiles: por defecto, las empresas de más de 10 mil M de dólares y las de tu watchlist (★). El buscador recorre todas las que presentan, grandes o chicas. Abajo, el calendario económico mundial.",

  async render(el, ctx) {
    const dias = pref("cal.dias", 7);
    el.innerHTML = `<section class="card"><div class="fila" style="margin:0">
        <input type="search" data-q placeholder="Buscar empresa o ticker…" aria-label="Buscar empresa o ticker" style="width:300px">
        <select data-dias aria-label="Días hábiles">${[5, 7, 10, 15].map((d) => `<option value="${d}"${d === dias ? " selected" : ""}>${d} días hábiles</option>`).join("")}</select>
        <span class="nota" data-cuenta style="margin:0"></span>
      </div></section>
      <div data-bal>${cargando("Calendario de balances (Nasdaq)…")}</div>
      ${tarjeta("Calendario económico", `<div class="tv" data-tv></div><p class="nota">Widget gratuito de TradingView: datos macro de Argentina, EE.UU., Brasil, Europa, China, Japón y Reino Unido, con previsión y dato anterior. Se carga desde tradingview.com.</p>`)}`;
    widgetTradingView(el.querySelector("[data-tv]"), "events", {
      colorTheme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
      isTransparent: true, width: "100%", height: "100%", locale: "es", importanceFilter: "0,1", countryFilter: "ar,us,br,eu,cn,jp,gb"
    });

    let datos = null;
    const pintar = () => {
      const q = el.querySelector("[data-q]").value.trim().toLowerCase();
      const coincide = (r) => r.ticker.toLowerCase().includes(q) || String(r.empresa).toLowerCase().includes(q);
      let mostradas = 0;
      const filas = datos.dias.map((dia) => {
        const f = new Date(`${dia.fecha}T12:00:00`);
        const lista = q ? dia.filas.filter(coincide) : dia.filas.filter((r) => r.destacada);
        if (q && !lista.length) return "";
        mostradas += lista.length;
        const titulo = `<tr><td colspan="7" class="grupo-titulo" style="padding-top:14px">${DIAS[f.getDay()]} ${fecha(dia.fecha)} <span class="faint" style="text-transform:none;letter-spacing:0">· ${dia.filas.length} empresas presentan</span></td></tr>`;
        if (dia.error) return `${titulo}<tr><td colspan="7" class="down">${esc(dia.error)}</td></tr>`;
        if (!lista.length) return `${titulo}<tr><td colspan="7" class="faint">Sin balances de empresas grandes. Usá el buscador para ver las demás.</td></tr>`;
        return titulo + lista.slice(0, q ? 60 : 25).map((r) => `<tr class="clic" data-t="${esc(r.ticker)}"><td><b>${r.enWatchlist ? "★ " : ""}${esc(r.ticker)}</b></td><td>${esc(r.empresa)}</td><td>${esc(r.momento)}</td>
          <td class="n">${grande(r.capitalizacion)}</td><td class="n">${esc(r.bpaEstimado || "—")}</td><td class="n">${esc(r.bpaAnioAnterior || "—")}</td><td class="n">${esc(r.estimaciones || "—")}</td></tr>`).join("");
      }).join("");
      el.querySelector("[data-cuenta]").textContent = q ? `${mostradas} resultado${mostradas === 1 ? "" : "s"} para "${q}" entre ${datos.total} empresas` : `${mostradas} destacadas de ${datos.total} empresas que presentan`;
      el.querySelector("[data-bal]").innerHTML = tarjeta("Balances de los próximos días", filas ? `<div class="tabla-scroll"><table>
        <thead><tr><th>Ticker</th><th>Empresa</th><th>Momento</th><th class="n">Capitalización</th><th class="n">BPA estimado</th><th class="n">BPA año anterior</th><th class="n">Estimaciones</th></tr></thead>
        <tbody>${filas}</tbody></table></div>` : `<p class="vacio">Ninguna empresa que presente balance en estos días coincide con "${esc(q)}".</p>`, { sub: `${esc(datos.fuente)} · tocá una fila para ver sus fundamentales y el consenso` });
      el.querySelectorAll("[data-bal] tr[data-t]").forEach((tr) => tr.addEventListener("click", () => ctx.cargarTicker(tr.dataset.t, "fundamentales")));
    };
    const cargar = async () => {
      const d = Number(el.querySelector("[data-dias]").value);
      setPref("cal.dias", d);
      el.querySelector("[data-bal]").innerHTML = cargando(`Calendario de balances de ${d} días hábiles (Nasdaq)…`);
      try {
        const watch = ctx.watchlist().filter((t) => !/[\^=]/.test(t));
        datos = await api(`/api/mercado/calendario?${qs({ dias: d, t: watch.join(",") })}`);
        pintar();
      } catch (e) { el.querySelector("[data-bal]").innerHTML = tarjeta("Balances", errorHtml(e)); }
    };
    let timer = null;
    el.querySelector("[data-q]").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => datos && pintar(), 150); });
    el.querySelector("[data-dias]").addEventListener("change", cargar);
    await cargar();
  }
};
