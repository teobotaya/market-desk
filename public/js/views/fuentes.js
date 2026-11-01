import { esc, enlace, cargando, errorHtml, api, tarjeta, fechaHora } from "../util.js";

const FUENTES = [
  ["Yahoo Finance", "Precios (acciones de EE.UU. y BYMA, índices, monedas, futuros, cripto), buscador y consenso de analistas", "sin clave"],
  ["Nasdaq", "Precios de respaldo y calendario de balances", "sin clave"],
  ["Stooq", "Precios de respaldo", "sin clave"],
  ["SEC EDGAR", "Estados financieros XBRL, 10-K/20-F, presentaciones e insiders (formulario 4)", "sin clave"],
  ["FRED", "Tasas del Tesoro, spreads, inflación implícita (Reserva Federal de St. Louis)", "sin clave"],
  ["CNN Fear & Greed", "Índice de miedo y codicia", "sin clave"],
  ["Google News", "Titulares en español e inglés", "sin clave"],
  ["DolarApi", "Dólar oficial, blue, MEP, CCL, mayorista, cripto y tarjeta en vivo", "sin clave"],
  ["ArgentinaDatos", "Historia del dólar, riesgo país, inflación, REM, plazo fijo, cauciones, FCI, letras y bonos CER", "sin clave"],
  ["data912", "Paneles de BYMA, dólar implícito por bono, historia de bonos y volatilidad implícita de opciones", "sin clave"],
  ["BCRA", "Variables monetarias oficiales (API v4)", "sin clave"],
  ["Finnhub", "Recomendaciones, sorpresas, pares y métricas (respaldo de Yahoo)", "clave gratuita opcional: FINNHUB_API_KEY"]
];

export default {
  id: "fuentes",
  titulo: "Fuentes y claves",
  icono: "⚙",
  descripcion: "Qué fuente alimenta cada dato, su último acierto o error, y cómo sumar claves gratuitas de IA. Las claves se leen del archivo .env de tu máquina y nunca salen de ella salvo hacia el proveedor elegido.",

  async render(el) {
    el.innerHTML = cargando("Consultando el estado del servidor…");
    let e;
    try { e = await api("/api/estado"); } catch (err) { el.innerHTML = errorHtml(err); return; }
    const salud = new Map(e.fuentes.map((f) => [f.fuente, f]));
    const estadoDe = (n) => {
      const f = salud.get(n) || [...salud.values()].find((x) => x.fuente.startsWith(n));
      if (!f) return `<span class="faint">sin uso todavía</span>`;
      const okReciente = f.ultimoOk && (!f.ultimoError || f.ultimoOk > f.ultimoError);
      return okReciente
        ? `<span class="etiqueta ok">ok</span><span class="sub">${f.ok} aciertos · último ${esc(fechaHora(f.ultimoOk))}</span>`
        : `<span class="etiqueta crit">error</span><span class="sub">${esc(f.detalle || "")} · ${esc(fechaHora(f.ultimoError))}</span>`;
    };
    el.innerHTML = `
      ${tarjeta("Análisis con IA", `<div class="tabla-scroll"><table><thead><tr><th>Proveedor</th><th>Costo</th><th>Estado</th><th>Modelo</th><th>Conseguir clave</th></tr></thead><tbody>
        ${e.ia.proveedores.map((p) => `<tr><td><b>${esc(p.nombre)}</b>${p.id === e.ia.proveedor ? ` <span class="etiqueta ok">por defecto</span>` : ""}</td><td>${p.gratis ? "gratis con límites" : "de pago"}</td>
          <td>${p.configurado ? `<span class="etiqueta ok">configurado</span>` : `<span class="faint">sin clave</span>`}</td><td class="n" style="text-align:left">${esc(p.modelo || "se elige solo")}</td>
          <td><a href="${enlace(p.web)}" target="_blank" rel="noopener">${esc(p.web.replace(/^https?:\/\//, ""))}</a></td></tr>`).join("")}
        </tbody></table></div>
        <p class="nota">Para activar uno, copiá <code>.env.example</code> como <code>.env</code> en la carpeta del proyecto, pegá la clave en la línea correspondiente (por ejemplo <code>GROQ_API_KEY=gsk_...</code>) y reiniciá con <code>npm start</code>. Con varias claves, elegís el proveedor en cada análisis; <code>IA_PROVEEDOR</code> fija el de defecto. Ollama corre modelos en tu propia máquina: definí <code>OLLAMA_MODEL</code>.</p>
        <p class="nota"><b>Ojo con los planes gratuitos:</b> varios proveedores pueden usar lo que les mandás para mejorar sus modelos. No pegues información confidencial de clientes.</p>
        ${e.archivosClaves?.length ? `<p class="nota">Archivos de claves leídos: ${e.archivosClaves.map((a) => `<code>${esc(a)}</code>`).join(", ")}.</p>` : ""}`)}
      ${tarjeta("Fuentes de datos", `<div class="tabla-scroll"><table><thead><tr><th>Fuente</th><th>Qué aporta</th><th>Acceso</th><th>Estado en esta sesión</th></tr></thead><tbody>
        ${FUENTES.map(([n, que, acc]) => `<tr><td><b>${esc(n)}</b></td><td>${esc(que)}</td><td class="faint">${esc(n === "Finnhub" && e.finnhub ? "clave configurada" : acc)}</td><td>${estadoDe(n)}</td></tr>`).join("")}
        </tbody></table></div>
        <p class="nota">Si una fuente da error de red o 403 en todas las consultas, probablemente tu red o un firewall la bloquea. Market Desk ${esc(e.version)} · escuchando en ${esc(e.host)}.</p>`)}
      ${tarjeta("Atajos", `<table>
        <tr><td><code>/</code></td><td>Ir al buscador</td></tr>
        <tr><td><code>↑ ↓ Enter</code></td><td>Elegir un resultado del buscador</td></tr>
        <tr><td>Tickers</td><td><code>NVDA</code> (EE.UU.) · <code>GGAL.BA</code> (BYMA en pesos) · <code>^MERV</code>, <code>^GSPC</code> (índices) · <code>BTC-USD</code> · <code>EURUSD=X</code> · <code>GC=F</code> (futuros) · <code>VALE3.SA</code> (otras bolsas)</td></tr>
        <tr><td>Enlaces</td><td>La dirección del navegador guarda la vista y el ticker (<code>#/fundamentales?t=MSFT</code>): se puede guardar en favoritos.</td></tr>
      </table>`)}`;
  }
};
