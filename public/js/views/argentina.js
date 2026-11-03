import { esc, enlace, num, pct, pctS, precio, grande, cls, cargando, errorHtml, api, tarjeta, kpi, fecha, fechaHora, subtabs, enlazarSubtabs, tablaOrdenable, pref, setPref } from "../util.js";
import { sparkline, graficoLineas, graficoBarras } from "../charts.js";
import { dossier } from "../dossier.js";
import { medidasBono, precioDesdeTir } from "../finanzas.js";

const CASAS = [["blue", "Blue"], ["bolsa", "MEP"], ["contadoconliqui", "CCL"], ["oficial", "Oficial"], ["mayorista", "Mayorista"], ["cripto", "Cripto"]];

export default {
  id: "argentina",
  titulo: "Argentina",
  icono: "◈",
  descripcion: "Dólares y brecha, riesgo país, inflación y expectativas del REM, bonos soberanos en dólares con TIR, duration y paridad, tasas en pesos, letras y bonos CER con sus curvas, y los paneles de BYMA. Fuentes gratuitas: DolarApi, ArgentinaDatos, data912 y BCRA.",

  async render(el, ctx) {
    const activa = pref("ar.tab", "macro");
    el.innerHTML = `${subtabs("ar", [["macro", "Dólar y macro"], ["bonos", "Bonos en dólares"], ["tasas", "Tasas y renta fija en pesos"], ["byma", "Panel BYMA"]], activa)}<div data-tab></div>`;
    const cont = el.querySelector("[data-tab]");
    const abrir = (k) => {
      setPref("ar.tab", k);
      cont.innerHTML = "";
      const div = document.createElement("div");
      cont.appendChild(div);
      ({ macro, bonos, tasas, byma })[k](div, ctx);
    };
    enlazarSubtabs(el, "ar", abrir);
    abrir(activa);
  }
};

/* ------------------------------------------------------- dólar y macro */

async function macro(el) {
  el.innerHTML = `
    <div data-dolares>${cargando("Cotizaciones del dólar…")}</div>
    <div class="grid2"><div data-hist></div><div data-riesgo>${cargando("Riesgo país…")}</div></div>
    <div class="grid2"><div data-inflacion>${cargando("Inflación…")}</div><div data-rem>${cargando("Expectativas del REM…")}</div></div>
    <div data-bcra></div>
    <div data-ia></div>`;
  const R = {};

  const dol = api("/api/ar/dolares").then((d) => {
    R.dolares = d;
    const de = (c) => d.filas.find((x) => x.casa === c);
    const principales = ["oficial", "bolsa", "contadoconliqui", "blue"].map(de).filter(Boolean);
    el.querySelector("[data-dolares]").innerHTML = `
      <div class="kpis estirar">${principales.map((x) => kpi(x.casa === "bolsa" ? "MEP" : x.casa === "contadoconliqui" ? "CCL" : x.nombre, `$ ${num(x.venta, 2)}`,
        x.casa === "oficial" ? `día ${pctS(x.var1d, 1)} · año ${pctS(x.varAnio, 0)}` : `brecha ${pctS(x.brechaOficial, 1)} · día ${pctS(x.var1d, 1)}`, "", `Actualizado ${fechaHora(x.fecha)}`)).join("")}
        ${kpi("Canje MEP → CCL", pctS(d.canje, 2), "costo de girar dólares al exterior", "", "CCL sobre MEP menos 1")}
      </div>
      ${tarjeta("Cotizaciones del dólar", `<div class="tabla-scroll"><table><thead><tr><th>Tipo</th><th class="n">Compra</th><th class="n">Venta</th><th class="n">Spread</th><th class="n">Brecha</th><th class="n">Día</th><th class="n">30 días</th><th class="n">En el año</th><th class="n">90 días</th><th>Actualizado</th></tr></thead><tbody>
        ${d.filas.map((x) => `<tr><td><b>${esc(x.nombre)}</b></td><td class="n">${num(x.compra, 2)}</td><td class="n"><b>${num(x.venta, 2)}</b></td><td class="n">${pct(x.spread, 1)}</td>
          <td class="n">${x.brechaOficial === null ? "—" : pctS(x.brechaOficial, 1)}</td><td class="n ${cls(x.var1d)}">${pctS(x.var1d, 1)}</td><td class="n ${cls(x.var30d)}">${pctS(x.var30d, 1)}</td>
          <td class="n ${cls(x.varAnio)}">${pctS(x.varAnio, 1)}</td><td class="n">${sparkline(x.spark, { w: 90, h: 22 })}</td><td class="faint" style="font-size:12px">${esc(fechaHora(x.fecha))}</td></tr>`).join("")}
      </tbody></table></div><p class="nota">${esc(d.fuente)}. Brecha contra el oficial minorista; variaciones sobre el precio de venta.</p>`)}`;
  }).catch((e) => { el.querySelector("[data-dolares]").innerHTML = errorHtml(e); });

  /* Historia del dólar elegido. */
  const hist = el.querySelector("[data-hist]");
  let casa = pref("ar.casa", "blue"), dias = 365;
  const pintarHist = async () => {
    hist.innerHTML = tarjeta("Historia del dólar", `<div data-g>${cargando("")}</div>`, {
      acciones: `<select data-casa aria-label="Tipo de dólar">${CASAS.map(([k, t]) => `<option value="${k}"${k === casa ? " selected" : ""}>${t}</option>`).join("")}</select>
        <div class="segmentos" data-dias>${[[90, "3M"], [365, "1A"], [1095, "3A"], [1825, "5A"]].map(([d, t]) => `<button data-v="${d}" aria-pressed="${d === dias}">${t}</button>`).join("")}</div>`
    });
    hist.querySelector("[data-casa]").addEventListener("change", (e) => { casa = e.target.value; setPref("ar.casa", casa); pintarHist(); });
    hist.querySelector("[data-dias]").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { dias = Number(b.dataset.v); pintarHist(); } });
    try {
      const d = await api(`/api/ar/dolar-historia?casa=${casa}&dias=${dias}`);
      graficoLineas(hist.querySelector("[data-g]"), [{ nombre: `Dólar ${CASAS.find((c) => c[0] === casa)[1]} (venta)`, datos: d.serie, color: "var(--c1)", area: true }], { alto: 300, fmtY: (v) => `$ ${num(v, 0)}` });
    } catch (e) { hist.querySelector("[data-g]").innerHTML = errorHtml(e); }
  };
  pintarHist();

  const rp = api("/api/ar/riesgo").then((d) => {
    R.riesgo = d;
    const c = el.querySelector("[data-riesgo]");
    c.innerHTML = tarjeta("Riesgo país", `<div class="kpis compactos">
        ${kpi("Último", `${num(d.valor, 0)} pb`, fecha(d.fecha))}
        ${kpi("1 día", d.cambio1d === null ? "—" : `${d.cambio1d > 0 ? "+" : ""}${num(d.cambio1d, 0)}`, "pb", d.cambio1d > 0 ? "down" : d.cambio1d < 0 ? "up" : "")}
        ${kpi("30 días", d.cambio30d === null ? "—" : `${d.cambio30d > 0 ? "+" : ""}${num(d.cambio30d, 0)}`, "pb", d.cambio30d > 0 ? "down" : "up")}
        ${kpi("Rango 1 año", `${num(d.min1a, 0)}–${num(d.max1a, 0)}`, "pb")}
      </div><div data-g></div><p class="nota">${esc(d.fuente)}. Sube cuando el mercado pide más tasa para prestarle a la Argentina: por eso, en verde las bajas.</p>`);
    graficoLineas(c.querySelector("[data-g]"), [{ nombre: "Riesgo país", datos: d.serie, color: "var(--c5)", area: true }], { alto: 170, fmtY: (v) => `${num(v, 0)} pb` });
  }).catch((e) => { el.querySelector("[data-riesgo]").innerHTML = tarjeta("Riesgo país", errorHtml(e)); });

  const inf = api("/api/ar/inflacion").then((d) => {
    R.inflacion = d;
    const c = el.querySelector("[data-inflacion]");
    c.innerHTML = tarjeta("Inflación (IPC INDEC)", `<div class="kpis compactos">
        ${kpi("Último mes", pct(d.ultimo.valor, 1), fecha(d.ultimo.fecha).slice(3))}
        ${kpi("Interanual", pct(d.interanual.valor, 1), fecha(d.interanual.fecha).slice(3))}
        ${kpi(`Acumulada ${d.anio}`, pct(d.acumuladoAnio, 1), "en el año")}
      </div><div data-g></div><p class="nota">${esc(d.fuente)}. Barras: variación mensual de los últimos 24 meses.</p>`);
    graficoBarras(c.querySelector("[data-g]"), d.mensual.slice(-24).map((x) => ({ etiqueta: x.d.slice(2, 7).split("-").reverse().join("/"), titulo: fecha(x.d).slice(3), v: x.v, color: "var(--c2)" })), { alto: 170, fmt: (v) => `${num(v, 1)}%` });
  }).catch((e) => { el.querySelector("[data-inflacion]").innerHTML = tarjeta("Inflación", errorHtml(e)); });

  const remP = api("/api/ar/rem").then((d) => {
    R.rem = d;
    const bloque = (titulo, lista, fmt) => lista.length ? `<div><div class="grupo-titulo" style="margin-top:6px">${esc(titulo)} <span class="faint" style="text-transform:none;letter-spacing:0">· ${esc(lista[0].unidad)}</span></div>
      <table><tbody>${lista.slice(0, 5).map((x) => `<tr title="${esc(x.referencia || "")} · ${x.participantes ?? "—"} participantes"><td>${esc(x.periodo)}</td><td class="n"><b>${fmt(x.mediana)}</b></td><td class="n faint">${fmt(x.p10)}–${fmt(x.p90)}</td></tr>`).join("")}</tbody></table></div>` : "";
    el.querySelector("[data-rem]").innerHTML = tarjeta(`Expectativas del mercado (REM ${esc(d.informe || "")})`, `<div class="mini-tablas">
        ${bloque("Inflación", d.inflacion, (v) => num(v, 1))}${bloque("Tipo de cambio", d.tipoCambio, (v) => num(v, 0))}${bloque("Tasa TAMAR", d.tasa, (v) => num(v, 1))}${bloque("PBI real", d.pbi, (v) => num(v, 1))}
      </div><p class="nota">${esc(d.fuente)}: mediana de los analistas encuestados por el BCRA; en gris, el rango entre los percentiles 10 y 90. ${d.publicacion ? `<a href="${enlace(d.publicacion)}" target="_blank" rel="noopener">Informe completo</a>.` : ""}</p>`);
  }).catch((e) => { el.querySelector("[data-rem]").innerHTML = tarjeta("REM", errorHtml(e)); });

  api("/api/ar/bcra").then((d) => {
    const c = el.querySelector("[data-bcra]");
    c.innerHTML = tarjeta("Variables principales del BCRA", `<div data-t></div><p class="nota">${esc(d.fuente)}.</p>`);
    tablaOrdenable(c.querySelector("[data-t]"), {
      columnas: [{ k: "descripcion", t: "Variable" }, { k: "valor", t: "Valor", n: true, fmt: (v) => num(v, Math.abs(v) < 100 ? 2 : 0) }, { k: "unidad", t: "Unidad" }, { k: "fecha", t: "Fecha", n: true, fmt: fecha }],
      filas: d.filas, nombreCsv: "bcra-variables", filtro: d.filas.length > 12
    });
  }).catch((e) => {
    el.querySelector("[data-bcra]").innerHTML = tarjeta("Variables principales del BCRA", `<div class="msg">La API del BCRA no respondió (${esc(e.message)}). Suele pasar por un problema de certificado del lado del BCRA; el resto de los datos de esta vista no dependen de ella.</div>`);
  });

  await Promise.allSettled([dol, rp, inf, remP]);
  const prompt =
`Armá el brief macro de Argentina para un analista de mercado, con las cifras de hoy.

DÓLARES
${R.dolares ? R.dolares.filas.map((x) => `- ${x.nombre}: venta $ ${num(x.venta, 2)} · brecha ${pctS(x.brechaOficial, 1)} · día ${pctS(x.var1d, 1)} · 30 días ${pctS(x.var30d, 1)} · año ${pctS(x.varAnio, 1)}`).join("\n") + `\n- Canje MEP→CCL: ${pctS(R.dolares.canje, 2)}` : "(no disponible)"}

RIESGO PAÍS: ${R.riesgo ? `${num(R.riesgo.valor, 0)} pb al ${fecha(R.riesgo.fecha)} · 30 días ${num(R.riesgo.cambio30d, 0)} pb · 1 año ${num(R.riesgo.cambio1a, 0)} pb · rango 1 año ${num(R.riesgo.min1a, 0)}–${num(R.riesgo.max1a, 0)}` : "no disponible"}

INFLACIÓN: ${R.inflacion ? `último mes ${pct(R.inflacion.ultimo.valor, 1)} (${fecha(R.inflacion.ultimo.fecha)}) · interanual ${pct(R.inflacion.interanual.valor, 1)} · acumulada ${R.inflacion.anio} ${pct(R.inflacion.acumuladoAnio, 1)} · últimos 6 meses: ${R.inflacion.mensual.slice(-6).map((x) => pct(x.v, 1)).join(", ")}` : "no disponible"}

EXPECTATIVAS REM (mediana)
${R.rem ? [["Inflación", R.rem.inflacion], ["Tipo de cambio", R.rem.tipoCambio], ["TAMAR", R.rem.tasa], ["PBI", R.rem.pbi]].map(([t, l]) => `- ${t}: ${l.slice(0, 6).map((x) => `${x.periodo} ${num(x.mediana, 1)}`).join(" · ")}`).join("\n") : "(no disponible)"}

Devolvé:
1. LA FOTO: dólar, brecha, riesgo país e inflación en cinco líneas.
2. TENSIÓN CAMBIARIA: qué dicen la brecha, el canje y la trayectoria del dólar frente a lo que espera el REM para fin de año.
3. TASA REAL: comparación entre la inflación esperada y las tasas (si faltan tasas, decilo).
4. RIESGO SOBERANO: tendencia del riesgo país y qué la estaría explicando, separando hechos de supuestos.
5. LECTURA PARA ACTIVOS ARGENTINOS: qué implica este cuadro para acciones (en dólares CCL), bonos en dólares y pesos.
6. TRES DATOS A VIGILAR la próxima semana.

Reglas: sin recomendaciones de inversión; cada afirmación con su cifra; distinguí dato de expectativa.`;
  dossier(el.querySelector("[data-ia]"), { titulo: "Brief macro Argentina", prompt });
}

/* -------------------------------------------------- tasas y renta fija */

async function tasas(el) {
  el.innerHTML = `
    <div class="grid2 bloque"><div data-pf>${cargando("Tasas de plazo fijo…")}</div><div data-fci>${cargando("FCI y cauciones…")}</div></div>
    <div class="grid2 bloque"><div data-letras>${cargando("Letras…")}</div><div data-cer>${cargando("Bonos CER…")}</div></div>
    <div data-implicito>${cargando("Dólar implícito por bono…")}</div>
    <div data-ia></div>`;
  const R = {};

  const t = api("/api/ar/tasas").then((d) => {
    R.tasas = d;
    const c = el.querySelector("[data-pf]");
    c.innerHTML = tarjeta("Plazo fijo a 30 días (TNA)", `${d.depositos30 ? `<div class="kpis compactos">${kpi("Depósitos 30 días", pct(d.depositos30.tna, 2), `promedio del sistema · ${fecha(d.depositos30.fecha)}`)}${d.plazoFijo?.[0] ? kpi("Mejor tasa", pct(d.plazoFijo[0].tnaClientes, 2), d.plazoFijo[0].entidad) : ""}</div>` : ""}<div data-t></div>`);
    if (d.plazoFijo) tablaOrdenable(c.querySelector("[data-t]"), {
      columnas: [{ k: "entidad", t: "Entidad", fmt: (v, f) => (f.enlace ? `<a href="${enlace(f.enlace)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v)) }, { k: "tnaClientes", t: "TNA clientes", n: true, fmt: (v) => pct(v, 2) }, { k: "tnaNoClientes", t: "No clientes", n: true, fmt: (v) => pct(v, 2) }],
      filas: d.plazoFijo, nombreCsv: "plazo-fijo", limite: 12
    });
    const f = el.querySelector("[data-fci]");
    f.innerHTML = tarjeta("FCI de liquidez y cauciones", `
      ${d.cauciones?.length ? `<div class="grupo-titulo">Cauciones en pesos (BYMA)</div><table><thead><tr><th>Plazo</th><th class="n">TNA</th><th class="n">Rango del día</th><th class="n">Monto</th></tr></thead><tbody>
        ${d.cauciones.slice(0, 6).map((x) => `<tr><td>${x.plazo} día${x.plazo === 1 ? "" : "s"}</td><td class="n"><b>${pct(x.tna, 2)}</b></td><td class="n faint">${pct(x.min, 1)} – ${pct(x.max, 1)}</td><td class="n">${grande(x.monto)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${d.fci?.length ? `<div class="grupo-titulo" style="margin-top:14px">FCI money market (TNA implícita del último día)</div><table><thead><tr><th>Fondo</th><th class="n">TNA</th><th class="n">Patrimonio</th></tr></thead><tbody>
        ${d.fci.slice(0, 8).map((x) => `<tr><td>${esc(x.fondo)}</td><td class="n"><b>${pct(x.tna, 2)}</b></td><td class="n">$ ${grande(x.patrimonio)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${d.errores?.length ? `<p class="nota">No disponible: ${esc(d.errores.join(" · "))}</p>` : ""}
      <p class="nota">${esc(d.fuente)}. La TNA de los FCI sale de la variación de la cuotaparte entre los dos últimos días informados: es ruidosa día a día.</p>`);
  }).catch((e) => { el.querySelector("[data-pf]").innerHTML = tarjeta("Tasas", errorHtml(e)); el.querySelector("[data-fci]").innerHTML = ""; });

  const rf = api("/api/ar/rentafija").then((d) => {
    R.rf = d;
    const l = el.querySelector("[data-letras]");
    if (d.letras?.length) {
      const k = curva(d.letras, "tea");
      l.innerHTML = tarjeta("Letras del Tesoro (LECAP/BONCAP)", `<div data-g></div><div data-t></div><p class="nota">Curva: TEA según plazo (escala logarítmica). ${notaFuera(k.fuera)} Actualizado ${esc(fechaHora(d.letrasFecha))}.</p>`);
      graficoLineas(l.querySelector("[data-g]"), [{ nombre: "TEA", datos: k.dentro.map((x) => ({ x: x.dias, v: x.tea, etiqueta: x.ticker })), color: "var(--c1)", puntos: true, etiquetas: true }], { xNum: true, escalaX: "log", alto: 200, fmtY: (v) => `${num(v, 1)}%`, etiquetasX: marcasPlazo(k.dentro) });
      tablaOrdenable(l.querySelector("[data-t]"), {
        columnas: [{ k: "ticker", t: "Ticker" }, { k: "precio", t: "Precio", n: true, fmt: (v) => num(v, 2) }, { k: "tna", t: "TNA", n: true, fmt: (v) => pct(v, 2) }, { k: "tea", t: "TEA", n: true, fmt: (v) => pct(v, 2) }, { k: "tem", t: "TEM", n: true, fmt: (v) => pct(v, 2) }, { k: "dias", t: "Días", n: true }, { k: "vencimiento", t: "Vence", n: true, fmt: fecha }],
        filas: d.letras, nombreCsv: "letras", claseFila: (f) => (k.fuera.includes(f) ? "faint" : "")
      });
    } else l.innerHTML = tarjeta("Letras del Tesoro", `<div class="msg">Sin datos de letras ahora.</div>`);
    const c = el.querySelector("[data-cer]");
    if (d.cer?.length) {
      const k = curva(d.cer, "tir");
      c.innerHTML = tarjeta("Bonos ajustados por CER", `<div data-g></div><div data-t></div><p class="nota">TIR real (por encima de la inflación) según plazo, escala logarítmica. ${notaFuera(k.fuera)} Actualizado ${esc(fechaHora(d.cerFecha))}.</p>`);
      graficoLineas(c.querySelector("[data-g]"), [{ nombre: "TIR real", datos: k.dentro.map((x) => ({ x: x.dias, v: x.tir, etiqueta: x.ticker })), color: "var(--c4)", puntos: true, etiquetas: true }], { xNum: true, escalaX: "log", alto: 200, cero: true, fmtY: (v) => `${num(v, 1)}%`, etiquetasX: marcasPlazo(k.dentro) });
      tablaOrdenable(c.querySelector("[data-t]"), {
        columnas: [{ k: "ticker", t: "Ticker" }, { k: "precio", t: "Precio", n: true, fmt: (v) => num(v, 2) }, { k: "tir", t: "TIR real", n: true, fmt: (v) => pct(v, 2), cls: cls }, { k: "dias", t: "Días", n: true }, { k: "vencimiento", t: "Vence", n: true, fmt: fecha }],
        filas: d.cer, nombreCsv: "bonos-cer", claseFila: (f) => (k.fuera.includes(f) ? "faint" : "")
      });
    } else c.innerHTML = tarjeta("Bonos CER", `<div class="msg">Sin datos de bonos CER ahora.</div>`);
  }).catch((e) => { el.querySelector("[data-letras]").innerHTML = tarjeta("Renta fija", errorHtml(e)); el.querySelector("[data-cer]").innerHTML = ""; });

  const imp = api("/api/ar/implicito").then((d) => {
    R.implicito = d;
    const c = el.querySelector("[data-implicito]");
    const tabla = (lista) => `<table><thead><tr><th>Bono</th><th class="n">Compra</th><th class="n">Venta</th><th class="n">Medio</th><th class="n">Volumen USD</th></tr></thead><tbody>
      ${lista.slice(0, 10).map((x) => `<tr><td>${esc(x.ticker)}</td><td class="n">${num(x.compra, 2)}</td><td class="n">${num(x.venta, 2)}</td><td class="n"><b>${num(x.medio || x.cierre, 2)}</b></td><td class="n">${grande(x.volumenUsd)}</td></tr>`).join("")}</tbody></table>`;
    c.innerHTML = `<div class="grid2 bloque">${tarjeta("Dólar MEP implícito por bono", tabla(d.mep))}${tarjeta("Dólar CCL implícito por bono", tabla(d.ccl))}</div><p class="nota">${esc(d.fuente)}. Precio del bono en pesos dividido por su precio en dólares (especie D para MEP, C para CCL).</p>`;
  }).catch((e) => { el.querySelector("[data-implicito]").innerHTML = tarjeta("Dólar implícito", errorHtml(e)); });

  await Promise.allSettled([t, rf, imp]);
  const prompt =
`Analizá la curva de tasas en pesos de Argentina con estos datos.

TASAS DE CORTO
${R.tasas?.cauciones?.length ? `Caución 1 día: ${pct(R.tasas.cauciones[0].tna, 2)} TNA` : "Caución: sin dato"}
${R.tasas?.depositos30 ? `Depósitos a 30 días (promedio): ${pct(R.tasas.depositos30.tna, 2)} TNA` : ""}
${R.tasas?.plazoFijo?.length ? `Plazo fijo: mejor ${pct(R.tasas.plazoFijo[0].tnaClientes, 2)} (${R.tasas.plazoFijo[0].entidad}), mediana de bancos ${pct(R.tasas.plazoFijo[Math.floor(R.tasas.plazoFijo.length / 2)].tnaClientes, 2)}` : ""}
${R.tasas?.fci?.length ? `FCI money market: entre ${pct(R.tasas.fci.at(-1).tna, 1)} y ${pct(R.tasas.fci[0].tna, 1)} TNA` : ""}

LETRAS (TEA por plazo)
${R.rf?.letras?.map((x) => `- ${x.ticker}: ${x.dias} días · TNA ${pct(x.tna, 2)} · TEA ${pct(x.tea, 2)} · TEM ${pct(x.tem, 2)}`).join("\n") || "(sin datos)"}

BONOS CER (TIR real)
${R.rf?.cer?.map((x) => `- ${x.ticker}: ${x.dias} días · TIR ${pct(x.tir, 2)}`).join("\n") || "(sin datos)"}

Devolvé:
1. FORMA DE LA CURVA: pendiente de la curva de letras y qué tasa de corto descuenta a futuro.
2. INFLACIÓN IMPLÍCITA (BREAKEVEN): compará tasas fijas y CER de plazos similares y deducí la inflación que descuenta el mercado. Mostrá la cuenta.
3. TASA REAL: con la inflación implícita, ¿las tasas fijas son positivas o negativas en términos reales?
4. ANOMALÍAS: puntos fuera de la curva y posibles razones (liquidez, vencimiento particular).
5. RIESGOS: qué evento cambiaría más esta curva.

Reglas: sin recomendaciones; mostrá los cálculos; si falta un dato para una cuenta, decilo.`;
  dossier(el.querySelector("[data-ia]"), { titulo: "Curva de pesos", prompt });
}

/* ----------------------------------------------------------- panel BYMA */

async function byma(el, ctx) {
  const PANELES = [["lider", "Merval líder"], ["acciones", "Panel general"], ["cedears", "CEDEARs"], ["bonos", "Bonos"], ["ons", "Obligaciones negociables"], ["letras", "Letras"], ["adrs", "ADRs en EE.UU."]];
  let activo = pref("ar.panel", "lider");
  el.innerHTML = `<div class="fila"><div class="segmentos" data-panel>${PANELES.map(([k, t]) => `<button data-v="${k}" aria-pressed="${k === activo}">${t}</button>`).join("")}</div></div><div data-p></div>`;
  const cont = el.querySelector("[data-p]");
  const cargar = async () => {
    cont.innerHTML = cargando("Bajando el panel de BYMA…");
    try {
      const tipo = activo === "lider" ? "acciones" : activo;
      const d = await api(`/api/ar/panel?tipo=${tipo}`);
      const filas = activo === "lider" ? d.filas.filter((f) => f.lider) : d.filas;
      const alza = filas.filter((f) => f.variacion > 0).length, baja = filas.filter((f) => f.variacion < 0).length;
      cont.innerHTML = `<div class="kpis compactos">${kpi("Instrumentos", String(filas.length))}${kpi("Suben", String(alza), "", "up")}${kpi("Bajan", String(baja), "", "down")}${kpi("Mediana del día", pctS(mediana(filas.map((f) => f.variacion)), 2), "", cls(mediana(filas.map((f) => f.variacion))))}</div>
        ${activo !== "adrs" && activo !== "bonos" && activo !== "ons" && activo !== "letras" ? `<div class="grid2 bloque">${tarjeta("Mayores subas", `<div data-sube></div>`)}${tarjeta("Mayores bajas", `<div data-baja></div>`)}</div>` : ""}
        ${tarjeta(PANELES.find((p) => p[0] === activo)[1], `<div data-t></div><p class="nota">${esc(d.fuente)}. ${["lider", "acciones", "cedears"].includes(activo) ? "Tocá una fila para abrir el activo (se carga como TICKER.BA)." : ""}</p>`)}`;
      const ord = [...filas].filter((f) => f.variacion !== null && f.volumen > 0).sort((a, b) => b.variacion - a.variacion);
      if (cont.querySelector("[data-sube]")) {
        graficoBarras(cont.querySelector("[data-sube]"), ord.slice(0, 8).map((f) => ({ etiqueta: f.ticker, v: f.variacion })), { horizontal: true, fmt: (v) => pctS(v, 2), alClick: (it) => ctx.cargarTicker(`${it.etiqueta}.BA`, "cotizacion") });
        graficoBarras(cont.querySelector("[data-baja]"), ord.slice(-8).reverse().map((f) => ({ etiqueta: f.ticker, v: f.variacion })), { horizontal: true, fmt: (v) => pctS(v, 2), alClick: (it) => ctx.cargarTicker(`${it.etiqueta}.BA`, "cotizacion") });
      }
      const clicable = ["lider", "acciones", "cedears", "adrs"].includes(activo);
      tablaOrdenable(cont.querySelector("[data-t]"), {
        columnas: [
          { k: "ticker", t: "Ticker", fmt: (v) => `<b>${esc(v)}</b>` }, { k: "ultimo", t: "Último", n: true, fmt: precio },
          { k: "variacion", t: "Var. %", n: true, fmt: (v) => pctS(v, 2), cls: cls },
          { k: "compra", t: "Compra", n: true, fmt: precio }, { k: "venta", t: "Venta", n: true, fmt: precio },
          { k: "volumen", t: "Volumen", n: true, fmt: grande }, { k: "operaciones", t: "Operaciones", n: true, fmt: (v) => num(v, 0) }
        ],
        filas, filtro: true, nombreCsv: `byma-${activo}`,
        alClick: clicable ? (f) => ctx.cargarTicker(activo === "adrs" ? f.ticker : `${f.ticker}.BA`, "cotizacion") : null
      });
    } catch (e) { cont.innerHTML = errorHtml(e); }
  };
  el.querySelector("[data-panel]").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    activo = b.dataset.v; setPref("ar.panel", activo);
    el.querySelectorAll("[data-panel] button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    cargar();
  });
  cargar();
}

/* Puntos que entran en la curva: se dejan afuera los vencimientos de menos
   de 20 días (la tasa anualizada de un bono que vence mañana explota con
   cualquier centavo) y las tasas atípicas, típicamente instrumentos que no
   son de tasa fija (duales, ajustables) mezclados en el mismo listado. El
   criterio es robusto: distancia a la mediana medida en desvíos absolutos. */
function curva(lista, campo) {
  const candidatos = lista.filter((x) => x.dias >= 20 && Number.isFinite(x[campo]));
  const med = mediana(candidatos.map((x) => x[campo]));
  const mad = mediana(candidatos.map((x) => Math.abs(x[campo] - med)));
  const limite = Math.max(8, 5 * (mad || 0));
  const dentro = candidatos.filter((x) => Math.abs(x[campo] - med) <= limite);
  return { dentro, fuera: lista.filter((x) => !dentro.includes(x)) };
}
const notaFuera = (fuera) => (fuera.length ? `Fuera del gráfico (en gris en la tabla): ${fuera.map((x) => esc(x.ticker)).join(", ")}, por vencer en menos de 20 días o tener una tasa atípica para la curva.` : "");
function marcasPlazo(pts) {
  if (!pts.length) return [];
  const min = Math.min(...pts.map((x) => x.dias)), max = Math.max(...pts.map((x) => x.dias));
  return [[30, "1 m"], [90, "3 m"], [180, "6 m"], [365, "1 a"], [730, "2 a"], [1825, "5 a"], [3650, "10 a"]]
    .filter(([d]) => d >= min * 0.8 && d <= max * 1.2).map(([x, t]) => ({ x, t }));
}

function mediana(v) {
  const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ----------------------------------------------------- bonos en dólares */

/* Análisis de los soberanos en dólares al estilo de las plataformas pagas de
   renta fija: TIR, duration modificada, convexidad, PVBP, paridad, valor
   técnico e interés corrido, la curva por legislación, la ficha de cada bono
   con su cronograma y su TIR histórica, una calculadora precio ↔ TIR y el
   arbitraje entre dos bonos. */
async function bonos(el, ctx) {
  el.innerHTML = cargando("Calculando TIR, duration y paridad de los bonos en dólares…");
  let d;
  try { d = await api("/api/ar/bonos"); } catch (e) { el.innerHTML = errorHtml(e); return; }
  const validas = d.filas.filter((f) => f.tir !== null && f.tir !== undefined);
  const familias = (ley) => validas.filter((f) => f.ley === ley).sort((a, b) => a.md - b.md).map((f) => ({ x: f.md, v: f.tir, etiqueta: f.ticker }));
  el.innerHTML = `
    <div class="kpis compactos">
      ${kpi("Fecha de liquidación", fecha(d.fechaLiq), "contado T+1")}
      ${d.spreads.length ? kpi("Prima por ley local", `${num(d.spreads.reduce((s, x) => s + x.puntosBasicos, 0) / d.spreads.length, 0)} pb`, "promedio AL − GD") : ""}
      ${validas.length ? kpi("TIR promedio", pct(validas.reduce((s, f) => s + f.tir, 0) / validas.length, 2), `${validas.length} bonos`) : ""}
    </div>
    ${tarjeta("Soberanos en dólares", `<div data-t></div><p class="nota">Tocá un bono para ver su ficha. Precios en dólares por cada 100 nominales originales (especie D, dólar MEP). TIR efectiva anual, base actual/365, liquidación T+1. Paridad = precio / valor técnico.</p>`)}
    <div class="grid2">
      ${tarjeta("Curva de rendimientos: TIR según duration modificada", `<div data-curva></div><div class="leyenda"><span><i style="background:var(--c1)"></i>Ley Nueva York (GD)</span><span><i style="background:var(--c2)"></i>Ley argentina (AL, AE)</span></div>`)}
      ${tarjeta("Diferencia por legislación", d.spreads.length ? `<table><thead><tr><th>Par</th><th class="n">TIR local − NY</th><th class="n">Precio local / NY</th></tr></thead><tbody>
        ${d.spreads.map((x) => `<tr><td><b>${esc(x.local)}</b> / ${esc(x.ny)}</td><td class="n ${x.puntosBasicos > 0 ? "warn" : ""}">${num(x.puntosBasicos, 0)} pb</td><td class="n">${num(x.ratioPrecio * 100, 2)}%</td></tr>`).join("")}</tbody></table>
        <p class="nota">Cuánto más rinde el bono de ley argentina que su par de ley de Nueva York con los mismos flujos: es la prima que pide el mercado por la legislación local.</p>` : `<p class="vacio">Sin pares con cotización.</p>`)}
    </div>
    <div data-ficha></div>
    <div data-arb></div>
    <div data-ia></div>`;

  tablaOrdenable(el.querySelector("[data-t]"), {
    columnas: [
      { k: "ticker", t: "Bono", fmt: (v, f) => `<b>${esc(v)}</b><span class="sub">ley ${esc(f.ley === "Argentina" ? "local" : "NY")} · vence ${fecha(f.vence)}</span>` },
      { k: "precio", t: "Precio US$", n: true, fmt: (v, f) => (f.error ? `<span class="faint">${esc(f.error)}</span>` : `${num(v, 2)}<span class="sub">${esc(f.especie || "")}</span>`) },
      { k: "variacion", t: "Día", n: true, fmt: (v) => pctS(v, 2), cls },
      { k: "tir", t: "TIR", n: true, fmt: (v) => pct(v, 2) },
      { k: "md", t: "MD", n: true, fmt: (v) => num(v, 2) },
      { k: "convexidad", t: "Convex.", n: true, fmt: (v) => num(v, 1) },
      { k: "paridad", t: "Paridad", n: true, fmt: (v) => pct(v, 1) },
      { k: "vr", t: "V. residual", n: true, fmt: (v) => num(v, 2) },
      { k: "ic", t: "Int. corrido", n: true, fmt: (v) => num(v, 3) },
      { k: "vt", t: "V. técnico", n: true, fmt: (v) => num(v, 2) },
      { k: "pvbp", t: "PVBP", n: true, fmt: (v) => num(v, 4) },
      { k: "cuponVigente", t: "Cupón", n: true, fmt: (v) => pct(v, 3) },
      { k: "proximoPago", t: "Próximo pago", n: true, fmt: (v) => (v ? `${fecha(v.fecha)}<span class="sub">${num(v.total, 3)} c/100</span>` : "—"), csv: (v) => v?.fecha || "" }
    ],
    filas: d.filas, nombreCsv: "bonos-soberanos-usd",
    alClick: (f) => ficha(el, f.ticker, true)
  });

  graficoLineas(el.querySelector("[data-curva]"), [
    { nombre: "Ley NY", datos: familias("Nueva York"), color: "var(--c1)", puntos: true, etiquetas: true },
    { nombre: "Ley local", datos: familias("Argentina"), color: "var(--c2)", puntos: true, etiquetas: true }
  ], { xNum: true, alto: 230, fmtY: (v) => `${num(v, 1)}%`, fmtTip: (v) => pct(v, 2), etiquetasX: [1, 2, 3, 4, 5, 6, 7].filter((x) => validas.some((f) => f.md >= x - 0.5) && validas.some((f) => f.md <= x + 0.5)).map((x) => ({ x, t: `MD ${x}` })) });

  arbitraje(el, d);
  if (validas.length) ficha(el, (validas.find((f) => f.ticker === "GD30") || validas[0]).ticker);

  const prompt =
`Analizá la curva de bonos soberanos argentinos en dólares con estos datos (liquidación ${fecha(d.fechaLiq)}).

${validas.map((f) => `- ${f.ticker} (ley ${f.ley === "Argentina" ? "local" : "NY"}, vence ${fecha(f.vence)}): precio ${num(f.precio, 2)} · TIR ${pct(f.tir, 2)} · MD ${num(f.md, 2)} · paridad ${pct(f.paridad, 1)} · valor residual ${num(f.vr, 2)}`).join("\n")}

Diferencia por legislación: ${d.spreads.map((x) => `${x.local}/${x.ny} ${num(x.puntosBasicos, 0)} pb`).join(" · ") || "sin datos"}

Devolvé:
1. FORMA DE LA CURVA: pendiente, tramo que rinde más por unidad de duration y qué dice eso del riesgo de default que descuenta el mercado.
2. LEY LOCAL CONTRA NUEVA YORK: si la prima es estable, cuándo se amplía y qué la explicaría.
3. PARIDADES: qué bonos cotizan más lejos de su valor técnico y por qué podría ser (cupón bajo, vida larga, recuperación esperada).
4. SENSIBILIDAD: qué pasaría con los precios ante una suba o baja de 100 pb de TIR, usando MD y convexidad.
5. RIESGOS que no se ven en estos números.

Reglas: no recomiendes comprar ni vender; mostrá las cuentas.`;
  dossier(el.querySelector("[data-ia]"), { titulo: "Curva soberana en dólares", prompt });
}

async function ficha(el, ticker, desplazar = false) {
  const cont = el.querySelector("[data-ficha]");
  cont.innerHTML = tarjeta(`Ficha de ${ticker}`, cargando("Cronograma y TIR histórica…"));
  let b;
  try { b = await api(`/api/ar/bono?t=${encodeURIComponent(ticker)}`); }
  catch (e) { cont.innerHTML = tarjeta(`Ficha de ${ticker}`, errorHtml(e)); return; }
  const futuros = b.cronograma.filter((f) => !f.pagado);
  cont.innerHTML = tarjeta(`Ficha de ${b.ticker} · ley ${b.ley === "Argentina" ? "argentina" : "de Nueva York"}`, `
    <div class="kpis compactos">
      ${kpi("Precio", num(b.precio, 2), b.especie || "")}${kpi("TIR", pct(b.tir, 2))}${kpi("Duration", num(b.duration, 2), "años (Macaulay)")}${kpi("Duration modificada", num(b.md, 2), `±1% TIR ≈ ∓${pct(b.md, 1)} precio`)}
      ${kpi("Convexidad", num(b.convexidad, 1))}${kpi("Paridad", pct(b.paridad, 1))}${kpi("Valor técnico", num(b.vt, 3), `residual ${num(b.vr, 2)} + corrido ${num(b.ic, 3)}`)}${kpi("Vida restante", `${num(futuros.length ? (Date.parse(b.vence) - Date.now()) / 864e5 / 365 : 0, 1)} años`, `vence ${fecha(b.vence)}`)}
    </div>
    <div class="grid2" style="margin:0">
      <div>
        <div class="grupo-titulo">Calculadora</div>
        <div class="calc-grid">
          <label class="campo"><span>Precio (US$ por 100)</span><input data-calc-precio type="number" step="any" value="${b.precio ? b.precio.toFixed(2) : ""}"></label>
          <label class="campo"><span>TIR (%)</span><input data-calc-tir type="number" step="any" value="${b.tir ? b.tir.toFixed(2) : ""}"></label>
        </div>
        <p class="nota" data-calc-res>Cambiá el precio para ver la TIR, o la TIR para ver el precio.</p>
        <div class="grupo-titulo" style="margin-top:12px">TIR y paridad en el último año</div>
        <div data-hist></div>
        ${b.aviso ? `<p class="nota">${esc(b.aviso)}</p>` : ""}
      </div>
      <div>
        <div class="grupo-titulo">Flujos de fondos por cada 100 nominales</div>
        <div class="tabla-scroll" style="max-height:420px;overflow-y:auto"><table><thead><tr><th>Fecha</th><th class="n">Cupón</th><th class="n">Tasa</th><th class="n">Amortización</th><th class="n">Total</th><th class="n">Residual</th></tr></thead><tbody>
          ${b.cronograma.map((f) => `<tr class="${f.pagado ? "faint" : ""}"><td>${fecha(f.fecha)}</td><td class="n">${num(f.cupon, 4)}</td><td class="n">${pct(f.tasa, 3)}</td><td class="n">${num(f.amortizacion, 3)}</td><td class="n"><b>${num(f.total, 4)}</b></td><td class="n">${num(f.residual, 2)}</td></tr>`).join("")}
        </tbody></table></div>
        <p class="nota">En gris, los pagos ya hechos. Total a cobrar desde hoy: ${num(futuros.reduce((s, f) => s + f.total, 0), 2)} por cada 100 nominales.</p>
      </div>
    </div>`);
  const flujos = b.cronograma.map((f) => ({ fecha: f.fecha, total: f.total }));
  const ip = cont.querySelector("[data-calc-precio]"), it = cont.querySelector("[data-calc-tir]"), out = cont.querySelector("[data-calc-res]");
  ip.addEventListener("input", () => {
    const m = medidasBono(flujos, Number(ip.value), b.fechaLiq);
    if (!m) { out.textContent = "Precio fuera de rango."; return; }
    it.value = m.tir.toFixed(2);
    out.innerHTML = `Con precio ${num(Number(ip.value), 2)}: TIR <b>${pct(m.tir, 2)}</b>, MD ${num(m.md, 2)}, paridad ${pct((Number(ip.value) / b.vt) * 100, 1)}.`;
  });
  it.addEventListener("input", () => {
    const p = precioDesdeTir(flujos, Number(it.value), b.fechaLiq);
    ip.value = p.toFixed(2);
    out.innerHTML = `Para una TIR de ${pct(Number(it.value), 2)} el precio sería <b>${num(p, 2)}</b> (paridad ${pct((p / b.vt) * 100, 1)}; ${pctS((p / b.precio - 1) * 100, 1)} contra el precio actual).`;
  });
  if (b.historia.length) {
    graficoLineas(cont.querySelector("[data-hist]"), [
      { nombre: "TIR", datos: b.historia.map((x) => ({ d: x.d, v: x.tir })), color: "var(--c1)" }
    ], { alto: 170, fmtY: (v) => `${num(v, 1)}%`, fmtTip: (v) => pct(v, 2) });
  } else cont.querySelector("[data-hist]").innerHTML = `<p class="vacio">Sin historia de precios en dólares.</p>`;
  if (desplazar) cont.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Arbitraje: dos bonos frente a frente. */
function arbitraje(el, d) {
  const cont = el.querySelector("[data-arb]");
  const validas = d.filas.filter((f) => f.tir !== null && f.tir !== undefined);
  if (validas.length < 2) return;
  const opciones = (sel) => validas.map((f) => `<option value="${f.ticker}"${f.ticker === sel ? " selected" : ""}>${f.ticker}</option>`).join("");
  let a = pref("ar.arbA", "AL30"), b = pref("ar.arbB", "GD30");
  if (!validas.some((f) => f.ticker === a)) a = validas[0].ticker;
  if (!validas.some((f) => f.ticker === b)) b = validas[1].ticker;
  const pintar = () => {
    const A = validas.find((f) => f.ticker === a), B = validas.find((f) => f.ticker === b);
    const filas = [["Precio", (x) => num(x.precio, 2)], ["TIR", (x) => pct(x.tir, 2)], ["Duration modificada", (x) => num(x.md, 2)], ["Convexidad", (x) => num(x.convexidad, 1)], ["Paridad", (x) => pct(x.paridad, 1)], ["Valor técnico", (x) => num(x.vt, 2)], ["Cupón vigente", (x) => pct(x.cuponVigente, 3)], ["Vencimiento", (x) => fecha(x.vence)]];
    cont.innerHTML = tarjeta("Arbitraje entre dos bonos", `<div class="fila"><select data-a>${opciones(a)}</select> contra <select data-b>${opciones(b)}</select></div>
      <div class="grid2" style="margin:0"><table><thead><tr><th></th><th class="n">${esc(a)}</th><th class="n">${esc(b)}</th></tr></thead><tbody>${filas.map(([t, f]) => `<tr><td>${t}</td><td class="n">${f(A)}</td><td class="n">${f(B)}</td></tr>`).join("")}</tbody></table>
      <div class="kpis compactos" style="margin:0">${kpi("Diferencia de TIR", `${num((A.tir - B.tir) * 100, 0)} pb`, `${a} − ${b}`, cls(A.tir - B.tir))}${kpi("Diferencia de paridad", pctS(A.paridad - B.paridad, 1))}${kpi("Ratio de precios", num(A.precio / B.precio, 4), `${a} / ${b}`)}${kpi("TIR por año de duration", Math.abs(A.md - B.md) < 0.25 ? "—" : `${num((A.tir - B.tir) / (A.md - B.md), 2)} pp`, Math.abs(A.md - B.md) < 0.25 ? "misma duration" : "pendiente entre los dos")}</div></div>
      <p class="nota">Si los dos tienen los mismos flujos (por ejemplo AL30 y GD30), la diferencia de TIR es puramente por legislación y liquidez.</p>`);
    cont.querySelector("[data-a]").addEventListener("change", (e) => { a = e.target.value; setPref("ar.arbA", a); pintar(); });
    cont.querySelector("[data-b]").addEventListener("change", (e) => { b = e.target.value; setPref("ar.arbB", b); pintar(); });
  };
  pintar();
}
