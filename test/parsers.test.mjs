import test from "node:test";
import assert from "node:assert/strict";
import { resolver, normalizar, parseStooq } from "../lib/precios.mjs";
import { parseFred } from "../lib/mercado.mjs";
import { parseRss, scoreHeadline } from "../lib/noticias.mjs";
import { classifyRisks, puntos, anuales, trimestres } from "../lib/sec.mjs";

test("resolver: índices, BYMA, globales y clases de acciones", () => {
  assert.equal(resolver("S&P 500").yahoo, "^GSPC");
  assert.equal(resolver("s y p 500").etf, "SPY");
  assert.equal(resolver("^GSPC").yahoo, "^GSPC");
  assert.equal(resolver("merval").yahoo, "^MERV");
  assert.equal(resolver("ggal.ba").tipo, "ar");
  assert.equal(resolver("BCBA:GGAL").yahoo, "GGAL.BA");
  assert.equal(resolver("BTC-USD").tipo, "global");
  assert.equal(resolver("EURUSD=X").tipo, "global");
  assert.equal(resolver("DX-Y.NYB").yahoo, "DX-Y.NYB");
  assert.equal(resolver("VALE3.SA").tipo, "global");
  assert.equal(resolver("BRK.B").yahoo, "BRK-B");
  /* Tickers reales que antes se confundían con alias de índices. */
  assert.equal(resolver("ES").tipo, "us");
  assert.equal(resolver("DOW").tipo, "us");
  assert.throws(() => resolver(""));
  assert.throws(() => resolver("no es un ticker!"));
  assert.equal(normalizar("  nvda ").crudo, "NVDA");
});

test("Stooq: parsea CSV y rechaza desafíos HTML", () => {
  const rows = parseStooq("Date,Open,High,Low,Close,Volume\n2024-01-02,1,2,0.5,1.5,100\n2024-01-03,1.5,2,1,1.8,120\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].c, 1.8);
  assert.throws(() => parseStooq("<html>challenge</html>"));
});

test("FRED: encabezado nuevo y viejo, y valores faltantes", () => {
  const a = parseFred("observation_date,DGS10\n2024-01-02,3.95\n2024-01-03,.\n2024-01-04,4.01\n");
  assert.deepEqual(a.map((x) => x.v), [3.95, 4.01]);
  const b = parseFred("DATE,DFF\n2024-01-02,5.33\n");
  assert.equal(b[0].v, 5.33);
  assert.throws(() => parseFred("<html>"));
});

test("RSS y léxico en español e inglés", () => {
  const xml = `<rss><channel><item><title><![CDATA[Las acciones suben con fuerza - Diario]]></title><link>https://x/1</link><pubDate>Mon, 03 Nov 2026 10:00:00 GMT</pubDate><source url="x">Diario</source></item></channel></rss>`;
  const [i] = parseRss(xml);
  assert.equal(i.title, "Las acciones suben con fuerza");
  assert.equal(i.source, "Diario");
  assert.ok(i.score > 0);
  assert.ok(scoreHeadline("El Merval se desploma y el riesgo país sube") < 1);
  assert.ok(scoreHeadline("Shares plunge after earnings miss") < 0);
  assert.ok(scoreHeadline("Stock beats estimates, rallies to record") > 0);
  assert.equal(scoreHeadline("El mercado opera sin cambios"), 0);
});

test("clasificación de riesgos: une títulos con su desarrollo", () => {
  const relleno = "Lorem ipsum dolor sit amet ".repeat(12);
  const texto = `We depend on a single supplier.\n\nWe rely on a sole source supplier in Taiwan for wafer fabrication. ${relleno}\n\nOur stock price may be volatile.\n\nGeneral economic conditions, market volatility and interest rate changes may affect us. ${relleno}`;
  const r = classifyRisks(texto);
  assert.equal(r.length, 2);
  assert.equal(r[0].heading, "We depend on a single supplier.");
  assert.equal(r[0].kind, "especifico");
  assert.ok(r[0].temas.includes("Proveedores"));
  assert.equal(r[1].kind, "generico");
});

test("XBRL: trimestres discretos, acumulados y cuarto trimestre derivado", () => {
  const f = (start, end, val, filed = "2025-02-01") => ({ start, end, val, filed, form: "10-Q" });
  const facts = {
    NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
      f("2024-01-01", "2024-03-31", 10), f("2024-01-01", "2024-06-30", 25), f("2024-01-01", "2024-09-30", 45), f("2024-01-01", "2024-12-31", 70)
    ] } }
  };
  const pts = puntos(facts, ["NetCashProvidedByUsedInOperatingActivities"]);
  assert.equal(pts.moneda, "USD");
  const q = trimestres(pts);
  assert.deepEqual([...q.values()].map((x) => x.val), [10, 15, 20, 25]);
  assert.ok(q.get("2024-12-31").derivado);
  assert.equal(anuales(pts).get("2024-12-31").val, 70);
  assert.equal(trimestres(pts, { derivar: false }).size, 1);
});

test("XBRL: gana la etiqueta preferida y se guarda la primera publicación", () => {
  const facts = {
    Revenues: { units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 99, filed: "2025-02-01" }] } },
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
      { start: "2024-01-01", end: "2024-12-31", val: 100, filed: "2025-02-01" },
      { start: "2024-01-01", end: "2024-12-31", val: 101, filed: "2026-02-01" }
    ] } }
  };
  const pts = puntos(facts, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"]);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].val, 101, "valor reexpresado más reciente");
  assert.equal(pts[0].primerFiled, "2025-02-01", "primera fecha en que fue público");
});
