import { cached, getJSON, HttpError } from "./http.mjs";
import { panel, dolares, rentaFija, rem, inflacionMensual } from "./argentina.mjs";
import { bonosDolar } from "./bonos.mjs";
import { price } from "./precios.mjs";
import { TASA_FIJA, DOLAR_NUEVOS, ONS, CEDEARS, ACTUALIZADO } from "./instrumentos.mjs";
import { medidasBono, liquidacion, diasEntre } from "../public/js/finanzas.js";

/* Renta fija en pesos y en dólares calculada en la app: los precios salen de
   data912 (BYMA) y los flujos, de las condiciones de emisión. ArgentinaDatos
   queda como respaldo y control: desde 2026 arma sus tasas leyendo páginas
   de terceros y a veces trae valores imposibles (TEM negativas, TIR de 58%
   en un bono que vence en días), que acá se marcan y no entran en las curvas. */

const BCRA = "https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias";
const precioDe = (f) => (f?.ultimo > 0 ? f.ultimo : f?.compra > 0 && f?.venta > 0 ? (f.compra + f.venta) / 2 : null);

/* Serie diaria del BCRA (API v4: results[0].detalle). */
export async function serieBcra(id, dias = 400) {
  return cached(`bcra:${id}:${dias}`, 3 * 3600e3, async () => {
    const hasta = new Date().toISOString().slice(0, 10);
    const desde = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
    const j = await getJSON(`${BCRA}/${id}?desde=${desde}&hasta=${hasta}&limit=3000`, { timeout: 15000 });
    const det = j?.results?.[0]?.detalle || [];
    return det.map((x) => ({ fecha: String(x.fecha).slice(0, 10), valor: Number(x.valor) })).filter((x) => Number.isFinite(x.valor)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  });
}

/* ------------------------------------------------------ tasa fija (pesos) */

/* LECAP y BONCAP: con un único pago, la tasa sale directo del cociente.
   TEM = (pago/precio)^(30/d) − 1 · TEA = (pago/precio)^(365/d) − 1 ·
   TNA = (pago/precio − 1) × 365/d, con d = días desde la liquidación T+1. */
export function tasasLetra(precio, pagoFinal, fechaLiq, vence) {
  const d = diasEntre(fechaLiq, vence);
  if (!(precio > 0) || !(d > 0)) return null;
  const k = pagoFinal / precio;
  return { dias: d, tem: (k ** (30 / d) - 1) * 100, tea: (k ** (365 / d) - 1) * 100, tna: ((k - 1) * 365) / d * 100, directa: (k - 1) * 100 };
}

/* Una tasa es dudosa si está fuera de lo posible para una letra en pesos o
   si al instrumento le quedan tan pocos días que cualquier tick la distorsiona. */
const dudosa = (tem, dias) => tem === null || tem === undefined || !Number.isFinite(tem) || tem < -0.5 || tem > 8 || dias < 5;

export async function tasaFija() {
  return cached("rf:fija", 60e3, async () => {
    const fechaLiq = liquidacion();
    const [notas, bonos, ad] = await Promise.allSettled([panel("letras"), panel("bonos"), rentaFija()]);
    const filasPanel = [...(notas.status === "fulfilled" ? notas.value.filas : []), ...(bonos.status === "fulfilled" ? bonos.value.filas : [])];
    const vistos = new Set(), filas = [];
    for (const [ticker, def] of Object.entries(TASA_FIJA)) {
      if (def.vence <= fechaLiq) continue;
      const px = filasPanel.find((f) => f.ticker === ticker);
      const p = precioDe(px);
      const t = p ? tasasLetra(p, def.pagoFinal, fechaLiq, def.vence) : null;
      vistos.add(ticker);
      filas.push({ ticker, tipo: ticker.startsWith("S") ? "LECAP" : "BONCAP", vence: def.vence, pagoFinal: def.pagoFinal, precio: p, variacion: px?.variacion ?? null, volumen: px?.volumen ?? null, ...(t || { dias: diasEntre(fechaLiq, def.vence) }), fuente: "propia" });
    }
    /* Lo que no está en la tabla propia, con las tasas de ArgentinaDatos. */
    for (const l of (ad.status === "fulfilled" ? ad.value.letras : null) || []) {
      if (vistos.has(l.ticker) || !l.vencimiento || l.vencimiento <= fechaLiq) continue;
      filas.push({ ticker: l.ticker, tipo: /^S/.test(l.ticker) ? "LECAP" : /^T/.test(l.ticker) ? "BONCAP" : "Letra", vence: l.vencimiento, precio: l.precio, tem: l.tem, tea: l.tea, tna: l.tna, dias: l.dias, variacion: l.variacion, volumen: l.volumen, fuente: "ArgentinaDatos" });
    }
    for (const f of filas) f.dudosa = dudosa(f.tem, f.dias);
    filas.sort((a, b) => a.dias - b.dias);
    return {
      fechaLiq, filas,
      curva: filas.filter((f) => !f.dudosa && f.tem !== null),
      errores: [notas, bonos].filter((x) => x.status === "rejected").map((x) => x.reason?.message),
      fuente: `Precios de data912 (BYMA, con demora); pagos finales de las condiciones de emisión (tabla al ${ACTUALIZADO}); el resto, ArgentinaDatos`
    };
  });
}

/* ------------------------------------------------- bonos y ONs en dólares */

const flujosDe = (lista) => lista.map(([fecha, total]) => ({ fecha, total }));

/* Interpolación lineal de la curva soberana (TIR contra duration
   modificada), plana fuera del rango. */
export function interpolar(puntos, x, ejeX = "md", ejeY = "tir") {
  const p = puntos.filter((q) => Number.isFinite(q[ejeX]) && Number.isFinite(q[ejeY])).sort((a, b) => a[ejeX] - b[ejeX]);
  if (!p.length) return null;
  if (x <= p[0][ejeX]) return p[0][ejeY];
  if (x >= p.at(-1)[ejeX]) return p.at(-1)[ejeY];
  const i = p.findIndex((q) => q[ejeX] >= x);
  const a = p[i - 1], b = p[i];
  return a[ejeY] + ((b[ejeY] - a[ejeY]) * (x - a[ejeX])) / (b[ejeX] - a[ejeX] || 1);
}

function analizarFlujos(lista, precio, fechaLiq) {
  const flujos = flujosDe(lista);
  const m = medidasBono(flujos, precio, fechaLiq);
  const prox = flujos.find((f) => f.fecha > fechaLiq) || null;
  return { tir: m?.tir ?? null, duration: m?.duration ?? null, md: m?.md ?? null, convexidad: m?.convexidad ?? null, pvbp: m?.pvbp ?? null, proximoPago: prox, flujosRestantes: flujos.filter((f) => f.fecha > fechaLiq).length };
}

/* Obligaciones negociables en dólares MEP: TIR, duration y spread contra
   la curva de Globales (ley Nueva York) a la misma duration. */
export async function obligaciones() {
  return cached("rf:ons", 60e3, async () => {
    const fechaLiq = liquidacion();
    const [corp, sob] = await Promise.allSettled([panel("ons"), bonosDolar()]);
    if (corp.status === "rejected") throw corp.reason;
    const curva = sob.status === "fulfilled" ? sob.value.filas.filter((f) => f.ley === "Nueva York" && f.tir !== null) : [];
    const filas = [];
    for (const [ticker, def] of Object.entries(ONS)) {
      if (def.vence <= fechaLiq) continue;
      const px = corp.value.filas.find((f) => f.ticker === ticker);
      const p = precioDe(px);
      const a = p ? analizarFlujos(def.flujos, p, fechaLiq) : {};
      const ref = a.md ? interpolar(curva, a.md) : null;
      filas.push({
        ticker, emisor: def.emisor, vence: def.vence, precio: p, variacion: px?.variacion ?? null, volumen: px?.volumen ?? null, ...a,
        spread: a.tir !== null && a.tir !== undefined && ref !== null ? (a.tir - ref) * 100 : null,
        dudosa: a.tir === null || a.tir === undefined || a.tir < -5 || a.tir > 40
      });
    }
    filas.sort((a, b) => (a.md ?? 99) - (b.md ?? 99));
    return { fechaLiq, filas, curvaSoberana: curva.map((f) => ({ ticker: f.ticker, md: f.md, tir: f.tir })), fuente: `Precios de data912 (especie D, dólar MEP); flujos de las condiciones de emisión (tabla al ${ACTUALIZADO})` };
  });
}

/* Bonares 2027–2029 y BOPREAL: soberanos en dólares fuera del canje 2020. */
export async function dolarNuevos() {
  return cached("rf:dnuevos", 60e3, async () => {
    const fechaLiq = liquidacion();
    const p = await panel("bonos");
    const filas = Object.entries(DOLAR_NUEVOS).filter(([, d]) => d.vence > fechaLiq).map(([t, d]) => {
      const px = p.filas.find((f) => f.ticker === `${t}D`) || null;
      const pr = precioDe(px);
      return { ticker: t, nombre: d.nombre, ley: d.ley, vence: d.vence, precio: pr, especie: px ? `${t}D` : null, variacion: px?.variacion ?? null, ...(pr ? analizarFlujos(d.flujos, pr, fechaLiq) : {}) };
    });
    return { fechaLiq, filas, fuente: "Precios de data912 (especie D); flujos de las condiciones de emisión" };
  });
}

/* --------------------------------------------------------- breakevens */

/* Inflación implícita: lo que rinde la tasa fija contra lo que rinde un
   bono CER de plazo parecido. (1+TEA)/(1+TIR real) − 1 es la inflación anual
   que iguala a los dos; si la inflación termina por encima, gana el CER.
   La TIR real se interpola en la curva CER por días al vencimiento. */
/* Bonos que no son CER puros y no van en la curva real: duales CER/TAMAR
   (TXM…), Discount y Par (DICP, PARP, DIP0, PAP0) y Cuasipar. */
export const NO_CER_PURO = /^(TXM|DIC|DIP|PAR|PAP|CUA)/;

export function inflacionImplicita(fija, cer) {
  const curva = cer.filter((c) => Number.isFinite(c.tir) && c.dias >= 30 && Math.abs(c.tir) <= 20 && !NO_CER_PURO.test(c.ticker || "")).map((c) => ({ dias: c.dias, tir: c.tir }));
  if (curva.length < 2) return [];
  return fija.filter((f) => !f.dudosa && f.tea !== null && f.dias > 20).map((f) => {
    const real = interpolar(curva, f.dias, "dias", "tir");
    const anual = ((1 + f.tea / 100) / (1 + real / 100) - 1) * 100;
    return { ticker: f.ticker, vence: f.vence, dias: f.dias, tem: f.tem, tea: f.tea, tirReal: real, anual, mensual: ((1 + anual / 100) ** (1 / 12) - 1) * 100 };
  });
}

/* Techo de la banda proyectado: desde enero de 2026 el techo sube cada mes
   lo que dio la inflación de dos meses antes. Se proyecta con el último dato
   del INDEC y después con la mediana del REM para cada mes. */
export function proyectarTecho(techoHoy, hoy, fecha, inflacionPorMes) {
  if (!techoHoy) return null;
  const dias = diasEntre(hoy, fecha);
  if (dias <= 0) return techoHoy;
  let t = techoHoy, cursor = hoy;
  while (cursor < fecha) {
    const sig = new Date(`${cursor}T00:00:00Z`); sig.setUTCMonth(sig.getUTCMonth() + 1);
    const fin = sig.toISOString().slice(0, 10) < fecha ? sig.toISOString().slice(0, 10) : fecha;
    const mes = new Date(`${cursor}T00:00:00Z`); mes.setUTCMonth(mes.getUTCMonth() - 2);
    const inf = inflacionPorMes(mes.toISOString().slice(0, 7));
    t *= (1 + inf / 100) ** (diasEntre(cursor, fin) / 30.4375);
    cursor = fin;
  }
  return t;
}

export async function breakevens() {
  return cached("rf:breakevens", 5 * 60e3, async () => {
    const [fija, ad, r, d, techo, piso, infl] = await Promise.allSettled([tasaFija(), rentaFija(), rem(), dolares(), serieBcra(1188, 60), serieBcra(1187, 60), inflacionMensual()]);
    const tf = fija.status === "fulfilled" ? fija.value : null;
    if (!tf) throw fija.reason || new HttpError("Sin tasas de tasa fija", 502);
    const cer = ad.status === "fulfilled" ? (ad.value.cer || []) : [];
    const remInf = r.status === "fulfilled" ? r.value.inflacion.filter((x) => x.tipo === "mensual" && Number.isFinite(x.mediana)) : [];
    const remPromedio = remInf.length ? remInf.slice(0, 6).reduce((s, x) => s + x.mediana, 0) / Math.min(6, remInf.length) : null;
    const implicita = inflacionImplicita(tf.filas, cer);

    /* Carry contra la banda: el dólar al que cada letra empata con haber
       comprado dólares hoy, contra el techo de la banda a su vencimiento. */
    const filasDolar = d.status === "fulfilled" ? d.value.filas : [];
    const mayorista = filasDolar.find((x) => x.casa === "mayorista")?.venta ?? null;
    const mep = filasDolar.find((x) => x.casa === "bolsa")?.venta ?? null;
    const techoHoy = techo.status === "fulfilled" ? techo.value.at(-1)?.valor ?? null : null;
    const pisoHoy = piso.status === "fulfilled" ? piso.value.at(-1)?.valor ?? null : null;
    const mensual = infl.status === "fulfilled" ? infl.value : [];
    const porMes = (ym) => mensual.find((x) => x.fecha.startsWith(ym))?.valor ?? remPromedio ?? mensual.at(-1)?.valor ?? 2;
    const hoy = tf.fechaLiq;
    const carry = mayorista ? tf.filas.filter((f) => !f.dudosa && f.tem !== null).map((f) => {
      const be = mayorista * (1 + f.tem / 100) ** (f.dias / 30);
      /* Más allá de 18 meses la proyección del techo no dice nada útil. */
      const tp = f.dias <= 550 ? proyectarTecho(techoHoy, hoy, f.vence, porMes) : null;
      return { ticker: f.ticker, vence: f.vence, dias: f.dias, tem: f.tem, dolarEquilibrio: be, techo: tp, margenTecho: tp ? (be / tp - 1) * 100 : null, subaTolerada: (be / mayorista - 1) * 100 };
    }) : [];
    return {
      fechaLiq: hoy, implicita, remPromedio, remMeses: remInf.slice(0, 12),
      carry, mayorista, mep, banda: { techo: techoHoy, piso: pisoHoy, fecha: techo.status === "fulfilled" ? techo.value.at(-1)?.fecha ?? null : null, distanciaTecho: techoHoy && mayorista ? (techoHoy / mayorista - 1) * 100 : null, distanciaPiso: pisoHoy && mayorista ? (mayorista / pisoHoy - 1) * 100 : null },
      avisos: [
        cer.length ? null : "Sin curva CER: no se puede calcular la inflación implícita.",
        techoHoy ? null : "La API del BCRA no respondió con los límites de la banda (series 1187 y 1188): el carry se muestra sin techo.",
        mayorista ? null : "Sin dólar mayorista: no se puede calcular el carry."
      ].filter(Boolean),
      fuente: "Tasa fija propia (data912) · CER de ArgentinaDatos · banda del BCRA (series 1187/1188) · inflación del INDEC y REM del BCRA"
    };
  });
}

/* ------------------------------------------------------------- CEDEARs */

/* Dólar implícito en cada CEDEAR. Con la especie D: precio en pesos sobre
   precio en dólares (MEP implícito, no necesita ratio). Con la acción en
   Nueva York: precio en pesos × ratio / precio en dólares (CCL implícito).
   Un CEDEAR con implícito por debajo del promedio está "barato" en pesos. */
export async function cedears() {
  return cached("rf:cedears", 2 * 60e3, async () => {
    const [p, d] = await Promise.allSettled([panel("cedears"), dolares()]);
    if (p.status === "rejected") throw p.reason;
    const filas = p.value.filas;
    const mepRef = d.status === "fulfilled" ? d.value.filas.find((x) => x.casa === "bolsa")?.venta ?? null : null;
    const cclRef = d.status === "fulfilled" ? d.value.filas.find((x) => x.casa === "contadoconliqui")?.venta ?? null : null;
    const base = filas.filter((f) => CEDEARS[f.ticker] && precioDe(f)).slice(0, 60);
    /* Precio en Nueva York para los 20 de más volumen (una consulta por acción). */
    const top = base.slice(0, 20);
    const us = await Promise.allSettled(top.map((f) => price(CEDEARS[f.ticker][0], { rango: "1y" })));
    const pxUs = new Map(top.map((f, i) => [f.ticker, us[i].status === "fulfilled" ? us[i].value.stats.last : null]));
    const out = base.map((f) => {
      const [usa, ratio] = CEDEARS[f.ticker];
      const ars = precioDe(f);
      const dEsp = precioDe(filas.find((x) => x.ticker === `${f.ticker}D`));
      const u = pxUs.get(f.ticker) ?? null;
      const mepImp = dEsp ? ars / dEsp : null, cclImp = u ? (ars * ratio) / u : null;
      return { ticker: f.ticker, subyacente: usa, ratio, precio: ars, variacion: f.variacion, volumen: f.volumen, precioD: dEsp, mepImplicito: mepImp, precioUsa: u, cclImplicito: cclImp, desvioMep: mepImp && mepRef ? (mepImp / mepRef - 1) * 100 : null, desvioCcl: cclImp && cclRef ? (cclImp / cclRef - 1) * 100 : null };
    });
    return { filas: out, mepRef, cclRef, fuente: "Precios de data912 (BYMA, con demora) y de Nueva York (cadena habitual de precios); ratios de conversión de BYMA" };
  });
}

/* Condiciones de cálculo que se muestran en la vista: el analista tiene
   que poder reproducir cada número. */
export const METODOLOGIA = [
  ["Liquidación", "T+1 hábil (se saltean sábados y domingos; los feriados no)."],
  ["Bonos del canje 2020", "Cupones 30/360 sobre valor residual; TIR efectiva anual base 365 desde la liquidación; precio cada 100 nominales originales."],
  ["LECAP y BONCAP", "Pago final cada 100 nominales; TEM = (pago/precio)^(30/días) − 1; TEA con 365 días; TNA lineal."],
  ["Obligaciones negociables", "Especie D (dólar MEP); TIR de los flujos restantes; spread en puntos básicos contra la curva de Globales interpolada a la misma duration modificada."],
  ["Inflación implícita", "(1 + TEA tasa fija) / (1 + TIR real CER interpolada por días) − 1."],
  ["Carry", "Dólar de equilibrio = mayorista hoy × (1 + TEM)^(días/30); techo de la banda proyectado con la inflación de dos meses antes (INDEC y luego REM)."],
  ["Datos dudosos", "TEM fuera de −0,5% a 8% o menos de 5 días al vencimiento: se muestran marcados y no entran en curvas ni breakevens."]
];
