import { esc, subtabs, enlazarSubtabs, pref, setPref } from "../util.js";

/* Widgets gratuitos de TradingView: el gráfico profesional con todos sus
   indicadores y dibujos, el resumen técnico de osciladores y medias, el mapa
   de calor del S&P 500, el screener y los estados financieros. Son productos
   de una plataforma paga que TradingView deja embeber sin costo. */

export function widgetTradingView(el, tipo, cfg) {
  el.innerHTML = `<div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div></div>`;
  const s = document.createElement("script");
  s.src = `https://s3.tradingview.com/external-embedding/embed-widget-${tipo}.js`;
  s.async = true;
  s.textContent = JSON.stringify(cfg);
  /* Si la red bloquea tradingview.com, mejor decirlo que dejar un hueco. */
  s.onerror = () => {
    el.innerHTML = `<div class="msg" style="margin:16px">No se pudo cargar el widget de TradingView. Revisá la conexión o si tu red, un bloqueador de anuncios o un firewall bloquean <code>s3.tradingview.com</code>.</div>`;
  };
  el.querySelector(".tradingview-widget-container").appendChild(s);
}

const MAPA = {
  "^GSPC": "SP:SPX", "^IXIC": "NASDAQ:IXIC", "^NDX": "NASDAQ:NDX", "^DJI": "DJ:DJI", "^RUT": "TVC:RUT", "^VIX": "TVC:VIX",
  "^MERV": "BCBA:IMV", "^BVSP": "BMFBOVESPA:IBOV", "^N225": "TVC:NI225", "^STOXX50E": "TVC:SX5E", "^HSI": "TVC:HSI", "^SOX": "NASDAQ:SOX",
  "^TNX": "TVC:US10Y", "^FVX": "TVC:US05Y", "^TYX": "TVC:US30Y", "^IRX": "TVC:US03MY", "DX-Y.NYB": "TVC:DXY",
  "CL=F": "TVC:USOIL", "BZ=F": "TVC:UKOIL", "GC=F": "TVC:GOLD", "SI=F": "TVC:SILVER", "HG=F": "COMEX:HG1!", "NG=F": "NYMEX:NG1!",
  "ZS=F": "CBOT:ZS1!", "ZC=F": "CBOT:ZC1!", "ZW=F": "CBOT:ZW1!", "BTC-USD": "BITSTAMP:BTCUSD", "ETH-USD": "BITSTAMP:ETHUSD"
};

/* Ticker de Yahoo → símbolo de TradingView. */
export function simboloTV(t) {
  const s = String(t || "").toUpperCase();
  if (MAPA[s]) return MAPA[s];
  if (s.endsWith(".BA")) return `BCBA:${s.slice(0, -3)}`;
  if (/^[A-Z]{6}=X$/.test(s)) return `FX_IDC:${s.slice(0, 6)}`;
  if (/-USD$/.test(s)) return `CRYPTO:${s.replace("-", "")}`;
  return s.replace("-", ".");
}

const tema = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export default {
  id: "tradingview",
  titulo: "TradingView",
  icono: "◭",
  requiereTicker: true,
  descripcion: "Herramientas profesionales de TradingView embebidas gratis: gráfico avanzado (con más de 100 indicadores y dibujos), resumen técnico, mapa de calor del S&P 500, screener y estados financieros. Se cargan desde tradingview.com.",

  async render(el, ctx) {
    const simbolo = simboloTV(ctx.ticker);
    const activa = pref("tv.tab", "grafico");
    el.innerHTML = `${subtabs("tv", [["grafico", "Gráfico avanzado"], ["tecnico", "Resumen técnico"], ["financieros", "Finanzas"], ["mapa", "Mapa de calor S&P 500"], ["screener", "Screener"]], activa)}
      <p class="nota" style="margin-top:-8px;margin-bottom:12px">Símbolo en TradingView: <code>${esc(simbolo)}</code>. Si no lo encuentra, cambialo desde el buscador del propio gráfico.</p>
      <div class="tv" data-w></div>`;
    const w = el.querySelector("[data-w]");
    const base = { colorTheme: tema(), isTransparent: true, locale: "es", width: "100%", height: "100%" };
    const abrir = (k) => {
      setPref("tv.tab", k);
      w.className = k === "tecnico" ? "tv bajo" : "tv";
      if (k === "grafico") widgetTradingView(w, "advanced-chart", {
        autosize: true, symbol: simbolo, interval: "D", timezone: "America/Argentina/Buenos_Aires", theme: tema(), style: "1", locale: "es",
        allow_symbol_change: true, withdateranges: true, details: true, hide_side_toolbar: false, calendar: false, support_host: "https://www.tradingview.com"
      });
      if (k === "tecnico") widgetTradingView(w, "technical-analysis", { ...base, symbol: simbolo, interval: "1D", showIntervalTabs: true, displayMode: "multiple" });
      if (k === "financieros") widgetTradingView(w, "financials", { ...base, symbol: simbolo, displayMode: "regular" });
      if (k === "mapa") widgetTradingView(w, "stock-heatmap", { ...base, dataSource: "SPX500", grouping: "sector", blockSize: "market_cap_basic", blockColor: "change", hasTopBar: true, isDataSetEnabled: true, isZoomEnabled: true, hasSymbolTooltip: true, exchanges: [] });
      if (k === "screener") widgetTradingView(w, "screener", { ...base, defaultColumn: "overview", defaultScreen: "most_capitalized", market: ctx.ticker.endsWith(".BA") ? "argentina" : "america", showToolbar: true });
    };
    enlazarSubtabs(el, "tv", abrir);
    abrir(activa);
  }
};
