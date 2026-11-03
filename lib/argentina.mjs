import { cached, getJSON, HttpError } from "./http.mjs";
import { stats } from "./indicadores.mjs";

/* Fuentes argentinas, todas gratuitas y sin clave:
   - DolarApi: cotizaciones del dólar en vivo (oficial, blue, MEP, CCL, cripto...).
   - ArgentinaDatos: historia del dólar, riesgo país, inflación, REM del BCRA,
     tasas de plazo fijo, cauciones, FCI, letras y bonos CER con TIR calculada.
   - data912: paneles de BYMA (acciones, CEDEARs, bonos, ONs) y MEP/CCL
     implícitos por bono.
   - BCRA: variables monetarias oficiales (API v4). */

const AD = "https://api.argentinadatos.com/v1";
const DOLARAPI = "https://dolarapi.com/v1";
const D912 = "https://data912.com";

const aPct = (x) => (x === null || x === undefined ? null : Math.abs(x) < 1.5 ? x * 100 : x);
const variacion = (a, b) => (a && b ? (a / b - 1) * 100 : null);

/* ----------------------------------------------------------------- dólar */

export async function historiaDolar(casa) {
  if (!/^[a-z]+$/.test(casa)) throw new HttpError("casa de cambio inválida", 400);
  return cached(`ar:hist:${casa}`, 60 * 60e3, async () => {
    const h = await getJSON(`${AD}/cotizaciones/dolares/${casa}`);
    return h.filter((x) => x.venta > 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  });
}

/* Valor de la serie en (o antes de) una fecha dada. */
function valorAl(hist, fecha) {
  let v = null;
  for (const x of hist) { if (x.fecha > fecha) break; v = x.venta; }
  return v;
}

export async function dolares() {
  return cached("ar:dolares", 60e3, async () => {
    const lista = await getJSON(`${DOLARAPI}/dolares`);
    const oficial = lista.find((d) => d.casa === "oficial");
    const mayorista = lista.find((d) => d.casa === "mayorista");
    const hoy = new Date();
    const fechaAtras = (n) => new Date(hoy - n * 864e5).toISOString().slice(0, 10);
    const inicioAnio = `${hoy.getFullYear() - 1}-12-31`;

    const filas = await Promise.all(lista.map(async (d) => {
      let hist = null;
      try { hist = await historiaDolar(d.casa); } catch { /* sin historia, igual mostramos el precio */ }
      const prev = hist ? [...hist].reverse().find((x) => x.fecha < (d.fechaActualizacion || "").slice(0, 10)) : null;
      return {
        casa: d.casa, nombre: d.nombre, compra: d.compra, venta: d.venta, fecha: d.fechaActualizacion,
        spread: d.compra && d.venta ? (d.venta / d.compra - 1) * 100 : null,
        brechaOficial: oficial?.venta && d.casa !== "oficial" ? variacion(d.venta, oficial.venta) : null,
        brechaMayorista: mayorista?.venta && d.casa !== "mayorista" ? variacion(d.venta, mayorista.venta) : null,
        var1d: prev ? variacion(d.venta, prev.venta) : null,
        var30d: hist ? variacion(d.venta, valorAl(hist, fechaAtras(30))) : null,
        varAnio: hist ? variacion(d.venta, valorAl(hist, inicioAnio)) : null,
        spark: hist ? hist.slice(-90).map((x) => x.venta) : null
      };
    }));
    const mep = filas.find((x) => x.casa === "bolsa"), ccl = filas.find((x) => x.casa === "contadoconliqui");
    return {
      filas,
      canje: mep?.venta && ccl?.venta ? variacion(ccl.venta, mep.venta) : null,
      fuente: "DolarApi · historia: ArgentinaDatos"
    };
  });
}

/* ------------------------------------------------------- riesgo e inflación */

export async function riesgoPais() {
  return cached("ar:riesgo", 30 * 60e3, async () => {
    const h = (await getJSON(`${AD}/finanzas/indices/riesgo-pais`)).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const ult = h.at(-1);
    const atras = (dias) => {
      const f = new Date(new Date(ult.fecha) - dias * 864e5).toISOString().slice(0, 10);
      return [...h].reverse().find((x) => x.fecha <= f)?.valor ?? null;
    };
    const anio = h.filter((x) => x.fecha >= new Date(new Date(ult.fecha) - 365 * 864e5).toISOString().slice(0, 10));
    return {
      valor: ult.valor, fecha: ult.fecha,
      cambio1d: h.length > 1 ? ult.valor - h.at(-2).valor : null,
      cambio30d: atras(30) !== null ? ult.valor - atras(30) : null,
      cambio1a: atras(365) !== null ? ult.valor - atras(365) : null,
      min1a: Math.min(...anio.map((x) => x.valor)), max1a: Math.max(...anio.map((x) => x.valor)),
      serie: h.filter((x) => x.fecha >= new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10)).map((x) => ({ d: x.fecha, v: x.valor })),
      fuente: "ArgentinaDatos (EMBI de JP Morgan, en puntos básicos)"
    };
  });
}

/* Inflación mensual completa del INDEC ({ fecha, valor } en %), de la más vieja a la última. */
export async function inflacionMensual() {
  return cached("ar:inflacionMensual", 6 * 3600e3, async () => {
    const m = await getJSON(`${AD}/finanzas/indices/inflacion`);
    return [...m].sort((a, b) => a.fecha.localeCompare(b.fecha));
  });
}

export async function inflacion() {
  return cached("ar:inflacion", 6 * 3600e3, async () => {
    const [mensual, interanual] = await Promise.all([
      inflacionMensual().then((m) => [...m]),
      getJSON(`${AD}/finanzas/indices/inflacionInteranual`)
    ]);
    interanual.sort((a, b) => a.fecha.localeCompare(b.fecha));
    const ult = mensual.at(-1);
    const anio = ult.fecha.slice(0, 4);
    const acumAnio = (mensual.filter((x) => x.fecha.startsWith(anio)).reduce((a, x) => a * (1 + x.valor / 100), 1) - 1) * 100;
    return {
      ultimo: ult, interanual: interanual.at(-1),
      acumuladoAnio: acumAnio, anio,
      mensual: mensual.slice(-36).map((x) => ({ d: x.fecha, v: x.valor })),
      serieInteranual: interanual.slice(-36).map((x) => ({ d: x.fecha, v: x.valor })),
      fuente: "INDEC vía ArgentinaDatos"
    };
  });
}

/* Relevamiento de Expectativas de Mercado del BCRA: lo que esperan los
   analistas que responden la encuesta (mediana). */
export async function rem() {
  return cached("ar:rem", 6 * 3600e3, async () => {
    const d = (await getJSON(`${AD}/finanzas/rem/ultimo`)).filter((x) => x.muestra === "todos");
    /* El BCRA publica los meses abreviados en inglés ("Dec-26"). */
    const MESES = { Jan: "ene", Feb: "feb", Mar: "mar", Apr: "abr", May: "may", Jun: "jun", Jul: "jul", Aug: "ago", Sep: "sep", Oct: "oct", Nov: "nov", Dec: "dic" };
    const periodo = (p) => String(p || "").replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/, (m) => MESES[m]);
    const de = (re) => d.filter((x) => re.test(x.indicador)).map((x) => ({
      periodo: periodo(x.periodo), tipo: x.periodoTipo, referencia: x.referencia, unidad: x.unidad,
      mediana: x.mediana, p10: x.percentil10, p90: x.percentil90, participantes: x.participantes
    }));
    return {
      informe: d[0]?.informe || null,
      publicacion: d[0]?.publicacionUrl || null,
      inflacion: de(/IPC nivel general/i),
      inflacionNucleo: de(/IPC núcleo/i),
      tipoCambio: de(/Tipo de cambio nominal/i),
      tasa: de(/Tasa de interés/i),
      pbi: de(/PIB a precios constantes/i),
      desocupacion: de(/Desocupación/i),
      fuente: "BCRA REM vía ArgentinaDatos"
    };
  });
}

/* ----------------------------------------------------------------- tasas */

export async function tasas() {
  return cached("ar:tasas", 30 * 60e3, async () => {
    const [pf, dep, cau, fciU, fciP] = await Promise.allSettled([
      getJSON(`${AD}/finanzas/tasas/plazoFijo`),
      getJSON(`${AD}/finanzas/tasas/depositos30Dias`),
      getJSON(`${AD}/finanzas/cauciones/ars`),
      getJSON(`${AD}/finanzas/fci/mercadoDinero/ultimo`),
      getJSON(`${AD}/finanzas/fci/mercadoDinero/penultimo`)
    ]);
    const out = { fuente: "ArgentinaDatos (BCRA, BYMA y CNV)", errores: [] };

    if (pf.status === "fulfilled") {
      out.plazoFijo = pf.value
        .map((b) => ({ entidad: b.entidad, tnaClientes: aPct(b.tnaClientes), tnaNoClientes: aPct(b.tnaNoClientes) || null, enlace: b.enlace }))
        .filter((b) => b.tnaClientes > 0)
        .sort((a, b) => b.tnaClientes - a.tnaClientes);
    } else out.errores.push(`plazo fijo: ${pf.reason?.message}`);

    if (dep.status === "fulfilled" && dep.value.length) {
      const u = dep.value.sort((a, b) => a.fecha.localeCompare(b.fecha)).at(-1);
      out.depositos30 = { fecha: u.fecha, tna: aPct(u.valor) };
    }

    if (cau.status === "fulfilled" && Array.isArray(cau.value)) {
      out.cauciones = cau.value.map((c) => ({ plazo: c.plazo, tna: aPct(c.tasaActual), min: aPct(c.tasaMinDia), max: aPct(c.tasaMaxDia), monto: c.montoContado, fecha: c.fechaOperacion }))
        .sort((a, b) => a.plazo - b.plazo);
    } else if (cau.status === "rejected") out.errores.push(`cauciones: ${cau.reason?.message}`);

    /* Rendimiento de los FCI de liquidez inmediata: variación de la cuotaparte
       entre los dos últimos días informados, anualizada. Solo fondos grandes
       en pesos, para no mostrar rendimientos de fondos sin patrimonio. */
    if (fciU.status === "fulfilled" && fciP.status === "fulfilled") {
      const previo = new Map(fciP.value.map((f) => [f.fondo, f]));
      const fechaMax = fciU.value.reduce((m, f) => (f.fecha > m ? f.fecha : m), "");
      out.fci = fciU.value
        .filter((f) => f.fecha === fechaMax && f.patrimonio > 5e9 && !/d[oó]lar|usd/i.test(f.fondo))
        .map((f) => {
          const p = previo.get(f.fondo);
          if (!p || !p.vcp || p.fecha >= f.fecha) return null;
          const d = (new Date(f.fecha) - new Date(p.fecha)) / 864e5;
          return { fondo: f.fondo, tna: ((f.vcp / p.vcp - 1) * 365 / d) * 100, patrimonio: f.patrimonio, fecha: f.fecha };
        })
        .filter((f) => f && f.tna > 0 && f.tna < 200)
        .sort((a, b) => b.tna - a.tna)
        .slice(0, 12);
    } else out.errores.push("FCI: no disponible");

    return out;
  });
}

/* -------------------------------------------------------- bonos y letras */

const diasHasta = (f) => Math.round((new Date(f) - new Date()) / 864e5);

export async function rentaFija() {
  return cached("ar:rf", 15 * 60e3, async () => {
    const [let_, cer] = await Promise.allSettled([getJSON(`${AD}/finanzas/letras`), getJSON(`${AD}/finanzas/bonos-cer`)]);
    return {
      letras: let_.status === "fulfilled" ? (let_.value.letras || []).map((l) => ({
        ticker: l.ticker, precio: l.precioArs, tna: l.tnaPorcentaje, tea: l.teaPorcentaje, tem: l.temPorcentaje,
        vencimiento: l.fechaVencimiento, dias: l.diasAlVencimiento ?? diasHasta(l.fechaVencimiento),
        variacion: l.variacionPorcentaje, volumen: l.volumenEfectivoArs
      })).sort((a, b) => a.dias - b.dias) : null,
      letrasFecha: let_.status === "fulfilled" ? let_.value.fechaActualizacion : null,
      cer: cer.status === "fulfilled" ? (cer.value.bonos || []).map((b) => ({
        ticker: b.ticker, precio: b.precioArs, tir: b.tirPorcentaje, vencimiento: b.fechaVencimiento,
        dias: diasHasta(b.fechaVencimiento), volumen: b.volumen
      })).sort((a, b) => a.dias - b.dias) : null,
      cerFecha: cer.status === "fulfilled" ? cer.value.fechaActualizacion : null,
      errores: [let_, cer].filter((x) => x.status === "rejected").map((x) => x.reason?.message),
      fuente: "ArgentinaDatos (precios de BYMA, tasas calculadas)"
    };
  });
}

/* --------------------------------------------------------- paneles BYMA */

/* Componentes del S&P Merval (panel líder). Cambian con las revisiones
   trimestrales; si falta alguno, igual aparece en el panel general. */
const MERVAL = new Set(["ALUA", "BBAR", "BMA", "BYMA", "CEPU", "COME", "CRES", "CVH", "EDN", "GGAL", "IRSA", "LOMA", "METR", "PAMP", "SUPV", "TECO2", "TGNO4", "TGSU2", "TRAN", "TXAR", "VALO", "YPFD", "MIRG"]);

const PANELES = {
  acciones: "arg_stocks", cedears: "arg_cedears", bonos: "arg_bonds", letras: "arg_notes", ons: "arg_corp", adrs: "usa_adrs"
};

export async function panel(tipo) {
  const ruta = PANELES[tipo];
  if (!ruta) throw new HttpError(`panel desconocido: ${tipo}`, 400);
  return cached(`ar:panel:${tipo}`, 60e3, async () => {
    const j = await getJSON(`${D912}/live/${ruta}`);
    const filas = (Array.isArray(j) ? j : []).filter((x) => x.symbol).map((x) => ({
      ticker: x.symbol, ultimo: x.c, variacion: x.pct_change, volumen: x.v, operaciones: x.q_op,
      compra: x.px_bid, venta: x.px_ask, cantCompra: x.q_bid, cantVenta: x.q_ask,
      lider: tipo === "acciones" ? MERVAL.has(x.symbol) : undefined
    })).sort((a, b) => (b.volumen || 0) - (a.volumen || 0));
    return { tipo, filas, fuente: "data912 (BYMA, con demora)" };
  });
}

/* Dólar implícito en cada bono: precio en pesos sobre precio en dólares. */
export async function dolarImplicito() {
  return cached("ar:implicito", 60e3, async () => {
    const [mep, ccl] = await Promise.allSettled([getJSON(`${D912}/live/mep`), getJSON(`${D912}/live/ccl`)]);
    const mapa = (r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []).map((x) => ({
      ticker: x.ticker, compra: x.bid, venta: x.ask, cierre: x.close, medio: x.mark, volumenUsd: x.v_usd, volumenArs: x.v_ars, panel: x.panel
    })).filter((x) => x.medio || x.cierre).sort((a, b) => (b.volumenUsd || 0) - (a.volumenUsd || 0));
    const m = mapa(mep), c = mapa(ccl);
    const ref = (lista, t) => lista.find((x) => x.ticker === t) || null;
    return {
      mep: m.slice(0, 20), ccl: c.slice(0, 20),
      mepAl30: ref(m, "AL30"), cclAl30: ref(c, "AL30"), mepGd30: ref(m, "GD30"), cclGd30: ref(c, "GD30"),
      fuente: "data912 (implícitos por bono, con demora)"
    };
  });
}

/* -------------------------------------------------------------- BCRA */

/* La API v4 del BCRA. Si responde con error de certificado es porque su
   servidor no envía la cadena completa: los datos principales también los
   publica ArgentinaDatos y el resto de la vista sigue funcionando. */
export async function variablesBcra() {
  return cached("ar:bcra", 60 * 60e3, async () => {
    const j = await getJSON("https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias?limit=3000", { timeout: 15000 });
    const filas = (j.results || [])
      .filter((x) => /principales/i.test(x.categoria || "") && x.ultValorInformado !== undefined)
      .map((x) => ({ id: x.idVariable, descripcion: x.descripcion, fecha: x.ultFechaInformada, valor: x.ultValorInformado, unidad: x.unidadExpresion || "" }));
    return { filas, fuente: "BCRA · API de estadísticas v4.0" };
  });
}

/* -------------------------------------------- precios en dólares (CCL) */

/* Convierte una serie en pesos a dólares contado con liquidación, día por
   día: es la forma habitual de medir en Argentina si una acción ganó o solo
   acompañó a la devaluación. */
export async function convertirACcl(px) {
  const hist = await historiaDolar("contadoconliqui");
  let j = 0, ccl = null;
  const velas = [];
  for (const c of px.candles) {
    while (j < hist.length && hist[j].fecha <= c.d) { ccl = hist[j].venta; j++; }
    if (!ccl) continue;
    velas.push({ ...c, o: c.o / ccl, h: c.h / ccl, l: c.l / ccl, c: c.c / ccl });
  }
  if (velas.length < 30) throw new HttpError("No hay suficiente historia del CCL para convertir esta serie", 422);
  return {
    ...px,
    candles: velas,
    stats: stats(velas),
    moneda: "USD CCL",
    cclUltimo: ccl,
    note: [px.note, `Precios en pesos divididos por el dólar contado con liquidación de cada día (último: $ ${ccl.toLocaleString("es-AR")}).`].filter(Boolean).join(" ")
  };
}
