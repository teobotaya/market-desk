import { esc, num, pct, pctS, precio, grande, cls, kpi, cargando, errorHtml, api, tarjeta, fecha, tablaOrdenable, vacio } from "../util.js";
import { graficoLineas, graficoBarras } from "../charts.js";
import { dossier } from "../dossier.js";

const PERFIL = { conservador: "Conservador", moderado: "Moderado", agresivo: "Agresivo" };
const HORIZONTE = { corto: "Corto plazo", medio: "Mediano plazo", largo: "Largo plazo" };
const CRITERIOS = [
  ["volMax", "Volatilidad máx. de la cartera", "% anual"],
  ["ddMax", "Caída máx. tolerada", "% desde un máximo"],
  ["pesoMax", "Peso máx. por posición", "% de la cartera"],
  ["stopLoss", "Pérdida máx. por posición", "% en dólares CCL"],
  ["volMaxPosicion", "Volatilidad máx. por posición", "% anual"],
  ["liquidezMin", "Liquidez mínima", "% en efectivo"]
];

const enviar = (metodo, ruta, cuerpo) => api(ruta, { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo ?? {}) });
const usd = (v) => (vacio(v) ? "—" : `US$ ${grande(v)}`);

export default {
  id: "clientes",
  titulo: "Clientes",
  icono: "☺",
  descripcion: "La cartera de cada cliente con su perfil de riesgo, el rendimiento en pesos y en dólares CCL, el riesgo de la cartera y alertas cuando algo se sale de sus criterios. Los datos quedan solo en tu máquina, en <code>datos/clientes.json</code>, fuera del repositorio.",

  async render(el, ctx) {
    const id = ctx.params.get("c"), modo = ctx.params.get("modo");
    if (modo === "nuevo") return formulario(el, ctx, null);
    if (id && modo === "editar") return formulario(el, ctx, await api(`/api/clientes/${id}`));
    if (id) return detalle(el, ctx, id);
    return lista(el, ctx);
  }
};

/* ------------------------------------------------------------- lista */

async function lista(el, ctx) {
  el.innerHTML = cargando("Leyendo clientes…");
  const d = await api("/api/clientes");
  const acciones = `<button class="btn primario" data-nuevo>+ Nuevo cliente</button>${d.clientes.length ? `<button class="btn" data-respaldo>Descargar respaldo</button>` : ""}`;
  if (!d.clientes.length) {
    el.innerHTML = tarjeta("Todavía no hay clientes", `<p class="vacio">Cargá el primero con su perfil y sus posiciones. Con eso la app calcula el valor de la cartera en pesos y en dólares, su riesgo y las alertas según los criterios del perfil.</p>
      <p class="nota">Se guardan en <code>${esc(d.archivo)}</code>. Esa carpeta está en el <code>.gitignore</code>: nunca se sube a GitHub.</p>`, { acciones });
  } else {
    el.innerHTML = `<div class="kpis compactos" data-resumen>${kpi("Clientes", String(d.clientes.length))}${kpi("Activos administrados", "…", "en dólares CCL")}${kpi("Alertas", "…")}</div>
      ${tarjeta("Cartera de clientes", `<div class="clientes-grid">${d.clientes.map((c) => `
        <a class="cliente-card" href="#/clientes?c=${esc(c.id)}" data-c="${esc(c.id)}">
          <div class="cliente-nombre">${esc(c.nombre)}</div>
          <div><span class="chip">${esc(PERFIL[c.perfil] || c.perfil)}</span> <span class="chip">${esc(HORIZONTE[c.horizonte] || c.horizonte)}</span></div>
          <div class="cliente-datos" data-val>${c.cantidadPosiciones} posiciones · valuando…</div>
        </a>`).join("")}</div>`, { acciones })}
      <p class="nota">Archivo: <code>${esc(d.archivo)}</code> (fuera del repositorio). Para respaldar, descargá el respaldo o copiá ese archivo.</p>`;
    /* Valuación de cada cliente, de a tres para no saturar las fuentes. */
    let total = 0, alertas = 0, hechos = 0;
    const cola = [...d.clientes];
    const trabajar = async () => {
      while (cola.length) {
        const c = cola.shift();
        const caja = el.querySelector(`[data-c="${c.id}"] [data-val]`);
        try {
          const k = await api(`/api/clientes/${c.id}/cartera`);
          total += k.totales.valorUsd || 0;
          alertas += k.alertas.length;
          if (caja) caja.innerHTML = `<b>${usd(k.totales.valorUsd)}</b> · <span class="${cls(k.totales.gananciaUsd)}">${pctS(k.totales.gananciaUsd, 1)}</span> · ${k.alertas.length ? `<span class="etiqueta crit">${k.alertas.length} alerta${k.alertas.length > 1 ? "s" : ""}</span>` : `<span class="etiqueta ok">en criterio</span>`}`;
        } catch (e) { if (caja) caja.innerHTML = `<span class="down">${esc(e.message)}</span>`; }
        hechos++;
        const r = el.querySelector("[data-resumen]");
        if (r) r.innerHTML = `${kpi("Clientes", String(d.clientes.length))}${kpi("Activos administrados", usd(total), hechos < d.clientes.length ? `valuando ${hechos} de ${d.clientes.length}` : "en dólares CCL")}${kpi("Alertas", String(alertas), "", alertas ? "warn" : "up")}`;
      }
    };
    Promise.all([trabajar(), trabajar(), trabajar()]);
  }
  el.querySelector("[data-nuevo]").addEventListener("click", () => ctx.irCon("clientes", { modo: "nuevo" }));
  el.querySelector("[data-respaldo]")?.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportado: new Date().toISOString(), clientes: d.clientes }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `clientes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}

/* -------------------------------------------------------- formulario */

async function formulario(el, ctx, c) {
  const { perfiles } = await api("/api/clientes");
  const perfil = c?.perfil || "moderado";
  const crit = c?.criterios || perfiles[perfil];
  const campo = (n, etiqueta, valor = "", tipo = "text", extra = "") => `<label class="campo"><span>${etiqueta}</span><input name="${n}" type="${tipo}" value="${esc(valor)}" ${extra}></label>`;
  el.innerHTML = `<form class="card form-cliente" novalidate>
    <header class="card-h"><div><h3>${c ? `Editar ${esc(c.nombre)}` : "Nuevo cliente"}</h3><p class="card-sub">Las posiciones se cargan después, en la ficha del cliente.</p></div></header>
    <div class="form-grid">
      ${campo("nombre", "Nombre *", c?.nombre, "text", "required maxlength=120 autocomplete=off")}
      ${campo("email", "Email", c?.email, "email", "maxlength=120")}
      ${campo("telefono", "Teléfono", c?.telefono, "tel", "maxlength=40")}
      <label class="campo"><span>Perfil de riesgo</span><select name="perfil">${Object.entries(PERFIL).map(([k, t]) => `<option value="${k}"${k === perfil ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="campo"><span>Horizonte</span><select name="horizonte">${Object.entries(HORIZONTE).map(([k, t]) => `<option value="${k}"${k === (c?.horizonte || "medio") ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      ${campo("objetivo", "Objetivo", c?.objetivo, "text", "maxlength=300 placeholder='Ej.: preservar capital en dólares'")}
      ${campo("efectivoARS", "Efectivo en pesos", c?.efectivo?.ARS ?? 0, "number", "min=0 step=any")}
      ${campo("efectivoUSD", "Efectivo en dólares", c?.efectivo?.USD ?? 0, "number", "min=0 step=any")}
    </div>
    <label class="campo"><span>Notas</span><textarea name="notas" maxlength="3000" style="min-height:80px">${esc(c?.notas || "")}</textarea></label>
    <div class="grupo-titulo" style="margin-top:14px">Criterios de riesgo <button type="button" class="btn chico" data-por-perfil>Usar los del perfil</button></div>
    <div class="kpis compactos">${CRITERIOS.map(([k, t, x]) => `<div class="kpi"><div class="k">${t}</div><input name="crit_${k}" type="number" min="0" step="any" value="${crit[k]}" style="width:100%;margin-top:4px;font-family:var(--mono)"><div class="x">${x}</div></div>`).join("")}</div>
    <div class="fila"><button class="btn primario" type="submit">${c ? "Guardar cambios" : "Crear cliente"}</button><button class="btn" type="button" data-cancelar>Cancelar</button><span class="nota" data-estado style="margin:0"></span></div>
  </form>`;
  const f = el.querySelector("form");
  const ponerPerfil = () => { const p = perfiles[f.perfil.value]; for (const [k] of CRITERIOS) f[`crit_${k}`].value = p[k]; };
  el.querySelector("[data-por-perfil]").addEventListener("click", ponerPerfil);
  if (!c) f.perfil.addEventListener("change", ponerPerfil);
  el.querySelector("[data-cancelar]").addEventListener("click", () => ctx.irCon("clientes", c ? { c: c.id } : {}));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const estado = el.querySelector("[data-estado]");
    if (!f.nombre.value.trim()) { estado.innerHTML = `<span class="down">Falta el nombre.</span>`; f.nombre.focus(); return; }
    const datos = {
      nombre: f.nombre.value, email: f.email.value, telefono: f.telefono.value, perfil: f.perfil.value, horizonte: f.horizonte.value,
      objetivo: f.objetivo.value, notas: f.notas.value,
      efectivo: { ARS: Number(f.efectivoARS.value) || 0, USD: Number(f.efectivoUSD.value) || 0 },
      criterios: Object.fromEntries(CRITERIOS.map(([k]) => [k, Number(f[`crit_${k}`].value)]))
    };
    estado.textContent = "Guardando…";
    try {
      const r = c ? await enviar("PUT", `/api/clientes/${c.id}`, datos) : await enviar("POST", "/api/clientes", datos);
      ctx.irCon("clientes", { c: r.id });
    } catch (err) { estado.innerHTML = `<span class="down">${esc(err.message)}</span>`; }
  });
  f.nombre.focus();
}

/* ----------------------------------------------------------- detalle */

async function detalle(el, ctx, id) {
  el.innerHTML = cargando("Valuando la cartera (precios, dólar CCL y riesgo)…");
  let k;
  try { k = await api(`/api/clientes/${id}/cartera`); }
  catch (e) { el.innerHTML = `${errorHtml(e)}<button class="btn" data-volver>Volver a la lista</button>`; el.querySelector("[data-volver]").addEventListener("click", () => ctx.irCon("clientes")); return; }
  const c = k.cliente, t = k.totales, r = k.riesgo;
  const guardarPosiciones = async (posiciones) => { await enviar("PUT", `/api/clientes/${id}`, { posiciones }); ctx.rerender(); };

  el.innerHTML = `
    <section class="card">
      <div class="fila" style="margin:0;align-items:flex-start">
        <div style="flex:1;min-width:240px">
          <h2 style="font-size:19px;margin:0 0 6px">${esc(c.nombre)}</h2>
          <div><span class="chip">${esc(PERFIL[c.perfil])}</span> <span class="chip">${esc(HORIZONTE[c.horizonte])}</span>${c.objetivo ? ` <span class="faint">· ${esc(c.objetivo)}</span>` : ""}</div>
          <p class="nota">${[c.email, c.telefono].filter(Boolean).map(esc).join(" · ") || "Sin datos de contacto"}${c.notas ? ` · ${esc(c.notas.slice(0, 160))}${c.notas.length > 160 ? "…" : ""}` : ""}</p>
        </div>
        <div class="card-acc"><button class="btn" data-volver>← Clientes</button><button class="btn" data-editar>Editar datos y criterios</button><button class="btn peligro" data-eliminar>Eliminar</button></div>
      </div>
    </section>
    <div class="kpis compactos">
      ${kpi("Valor de la cartera", usd(t.valorUsd), "dólares CCL")}
      ${kpi("En pesos", `$ ${grande(t.valorArs)}`, `CCL $ ${num(k.cclHoy, 2)}`)}
      ${kpi("Resultado en dólares", usd(t.resultadoUsd), pctS(t.gananciaUsd, 1), cls(t.resultadoUsd))}
      ${kpi("Liquidez", pct(t.liquidez), usd(t.efectivoUsd), t.liquidez < c.criterios.liquidezMin ? "warn" : "")}
      ${kpi("Alertas", String(k.alertas.length), k.alertas.length ? "fuera de criterio" : "todo en criterio", k.alertas.length ? "warn" : "up")}
    </div>
    ${tarjeta(k.alertas.length ? "Alertas" : "Sin alertas", k.alertas.length
      ? `<ul class="lectura">${k.alertas.map((a) => `<li class="${a.nivel === "alta" ? "down" : "warn"}">${esc(a.texto)}</li>`).join("")}</ul>`
      : `<p class="vacio" style="margin:0">La cartera está dentro de todos los criterios del cliente.</p>`)}
    ${tarjeta("Posiciones", `<div data-pos></div>
      <form class="form-pos" data-agregar novalidate>
        <input name="ticker" class="tk" placeholder="Ticker" aria-label="Ticker" required>
        <input name="cantidad" type="number" min="0" step="any" placeholder="Cantidad" aria-label="Cantidad" required>
        <input name="precioCompra" type="number" min="0" step="any" placeholder="Precio de compra" aria-label="Precio de compra" required>
        <input name="fechaCompra" type="date" aria-label="Fecha de compra" value="${new Date().toISOString().slice(0, 10)}">
        <button class="btn" type="button" data-precio-hoy title="Completa con el último precio">Precio de hoy</button>
        <button class="btn primario" type="submit">Agregar posición</button>
        <span class="nota" data-estado style="margin:0"></span>
      </form>
      <p class="nota">El precio de compra va en la moneda en que cotiza el activo (pesos para BYMA, dólares para el exterior). El resultado en dólares usa el CCL del día de compra; el valor actual, el CCL de hoy.</p>`)}
    <div class="grid2">
      ${tarjeta("Composición", `<div data-comp></div><div class="grid2" style="margin:12px 0 0">${["porTipo", "porMoneda"].map((g) => `<table><thead><tr><th>${g === "porTipo" ? "Tipo" : "Moneda"}</th><th class="n">Peso</th></tr></thead><tbody>${k.composicion[g].map((x) => `<tr><td>${esc(x.nombre)}</td><td class="n">${pct(x.peso)}</td></tr>`).join("")}</tbody></table>`).join("")}</div>`)}
      ${tarjeta("Riesgo de la cartera actual", r ? `<div class="kpis compactos" style="margin:0">
          ${kpi("Volatilidad", pct(r.vol), `máx. ${pct(c.criterios.volMax, 0)}`, r.vol > c.criterios.volMax ? "down" : "up")}
          ${kpi("Caída máx. 1 año", pct(r.caidaMax), `tolera ${pct(c.criterios.ddMax, 0)}`, Math.abs(r.caidaMax) > c.criterios.ddMax ? "down" : "up")}
          ${kpi("VaR 95% diario", pct(r.var95), "1 de cada 20 días", "warn")}
          ${kpi("CVaR 95%", pct(r.cvar95), "promedio de esos días", "warn")}
          ${kpi("Sharpe", num(r.sharpe, 2), "sin tasa libre")}
          ${kpi("Retorno 1 año", pctS(r.retorno, 1), "con la cartera de hoy", cls(r.retorno))}
        </div><div data-serie style="margin-top:12px"></div>
        <p class="nota">Cómo se habría movido la cartera de hoy (mismas cantidades) entre ${fecha(r.desde)} y ${fecha(r.hasta)}, en dólares CCL. Mide riesgo, no el resultado real del cliente.</p>` : `<p class="vacio">Hace falta al menos una posición con historia de precios para medir el riesgo.</p>`)}
    </div>
    ${tarjeta("Criterios del cliente", `<div class="kpis compactos" style="margin:0">${CRITERIOS.map(([key, titulo, x]) => kpi(titulo, pct(c.criterios[key], 0), x)).join("")}</div>`)}
    <div data-ia></div>`;

  el.querySelector("[data-volver]").addEventListener("click", () => ctx.irCon("clientes"));
  el.querySelector("[data-editar]").addEventListener("click", () => ctx.irCon("clientes", { c: id, modo: "editar" }));
  el.querySelector("[data-eliminar]").addEventListener("click", async () => {
    if (!confirm(`¿Eliminar a ${c.nombre} y toda su cartera? No se puede deshacer.`)) return;
    try { await enviar("DELETE", `/api/clientes/${id}`); ctx.irCon("clientes"); } catch (e) { alert(e.message); }
  });

  tablaOrdenable(el.querySelector("[data-pos]"), {
    columnas: [
      { k: "ticker", t: "Activo", fmt: (v, p) => `<b>${esc(v)}</b><span class="sub">${esc(p.error ? "sin precio" : p.nombre || p.tipo)}</span>` },
      { k: "cantidad", t: "Cantidad", n: true, fmt: (v) => num(v, v % 1 ? 4 : 0) },
      { k: "precioCompra", t: "Compra", n: true, fmt: (v, p) => `${precio(v)}<span class="sub">${fecha(p.fechaCompra)}</span>` },
      { k: "precioActual", t: "Actual", n: true, fmt: (v, p) => `${precio(v)}<span class="sub">${esc(p.moneda || "")} · ${pctS(p.dia, 1)} hoy</span>` },
      { k: "valorUsd", t: "Valor US$", n: true, fmt: grande },
      { k: "peso", t: "Peso", n: true, fmt: (v) => pct(v), cls: (v) => (v > c.criterios.pesoMax ? "warn" : "") },
      { k: "gananciaArs", t: "Resultado $", n: true, fmt: (v) => pctS(v, 1), cls },
      { k: "gananciaUsd", t: "Resultado US$", n: true, fmt: (v) => pctS(v, 1), cls: (v) => (v < -c.criterios.stopLoss ? "down" : cls(v)) },
      { k: "vol", t: "Vol. 1a", n: true, fmt: (v) => pct(v), cls: (v) => (v > c.criterios.volMaxPosicion ? "warn" : "") },
      { k: "id", t: "", fmt: (v) => `<button class="btn chico" data-quitar="${esc(v)}" title="Quitar posición">Quitar</button>` }
    ],
    filas: k.posiciones,
    nombreCsv: `cartera-${c.nombre.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    alClick: (p) => ctx.cargarTicker(p.ticker, "cotizacion")
  });
  el.querySelector("[data-pos]").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-quitar]");
    if (!b) return;
    e.stopPropagation();
    const p = c.posiciones.find((x) => x.id === b.dataset.quitar);
    if (!p || !confirm(`¿Quitar ${p.cantidad} ${p.ticker} de la cartera?`)) return;
    try { await guardarPosiciones(c.posiciones.filter((x) => x.id !== p.id)); } catch (err) { alert(err.message); }
  });

  const f = el.querySelector("[data-agregar]");
  const estado = f.querySelector("[data-estado]");
  f.querySelector("[data-precio-hoy]").addEventListener("click", async () => {
    const t = f.ticker.value.trim();
    if (!t) { estado.innerHTML = `<span class="down">Escribí el ticker primero.</span>`; return; }
    estado.textContent = "Buscando precio…";
    try { const px = await api(`/api/price?t=${encodeURIComponent(t)}&rango=1y`); f.precioCompra.value = px.stats.last.toFixed(4); estado.textContent = `${px.ticker} · ${px.moneda}`; }
    catch (e) { estado.innerHTML = `<span class="down">${esc(e.message)}</span>`; }
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nueva = { ticker: f.ticker.value.trim(), cantidad: Number(f.cantidad.value), precioCompra: Number(f.precioCompra.value), fechaCompra: f.fechaCompra.value };
    if (!nueva.ticker || !(nueva.cantidad > 0) || !(nueva.precioCompra >= 0) || f.precioCompra.value === "") { estado.innerHTML = `<span class="down">Completá ticker, cantidad y precio.</span>`; return; }
    estado.textContent = "Guardando…";
    try { await guardarPosiciones([...c.posiciones, nueva]); } catch (err) { estado.innerHTML = `<span class="down">${esc(err.message)}</span>`; }
  });

  const validas = k.posiciones.filter((p) => !p.error && p.peso !== null).sort((a, b) => b.peso - a.peso);
  if (validas.length) graficoBarras(el.querySelector("[data-comp]"), validas.map((p) => ({ etiqueta: p.ticker, v: p.peso, color: p.peso > c.criterios.pesoMax ? "var(--warn)" : "var(--c1)" })), { horizontal: true, fmt: (v) => pct(v), alClick: (it) => ctx.cargarTicker(it.etiqueta, "cotizacion") });
  else el.querySelector("[data-comp]").innerHTML = `<p class="vacio">Sin posiciones valuadas.</p>`;
  if (r) graficoLineas(el.querySelector("[data-serie]"), [{ nombre: "Valor en US$", datos: k.serie, color: "var(--c1)", area: true }], { alto: 180, fmtY: (v) => grande(v) });

  /* El prompt no lleva nombre ni contacto: a un proveedor de IA no le hace
     falta saber quién es el cliente para revisar la cartera. */
  const prompt =
`Revisá la cartera de un cliente de un asesor financiero (datos anonimizados).

PERFIL: ${PERFIL[c.perfil]} · horizonte ${HORIZONTE[c.horizonte].toLowerCase()}${c.objetivo ? ` · objetivo: ${c.objetivo}` : ""}
CRITERIOS: ${CRITERIOS.map(([key, titulo]) => `${titulo.toLowerCase()} ${pct(c.criterios[key], 0)}`).join(" · ")}

CARTERA (valor total ${usd(t.valorUsd)} en dólares CCL, liquidez ${pct(t.liquidez)}, resultado ${pctS(t.gananciaUsd, 1)} en dólares)
${k.posiciones.map((p) => (p.error ? `- ${p.ticker}: sin precio` : `- ${p.ticker} (${p.tipo}, ${p.moneda}): peso ${pct(p.peso)} · resultado ${pctS(p.gananciaUsd, 1)} en US$ y ${pctS(p.gananciaArs, 1)} en pesos · volatilidad ${pct(p.vol)}`)).join("\n")}

RIESGO DE LA CARTERA ACTUAL (último año): ${r ? `volatilidad ${pct(r.vol)} · caída máxima ${pct(r.caidaMax)} · VaR 95% ${pct(r.var95)} · Sharpe ${num(r.sharpe, 2)}` : "sin datos"}

ALERTAS
${k.alertas.map((a) => `- ${a.texto}`).join("\n") || "- ninguna"}

Devolvé:
1. ¿LA CARTERA ES COHERENTE CON EL PERFIL? Con cifras, dónde sí y dónde no.
2. CONCENTRACIÓN: por activo, por moneda y por tipo de riesgo (país, sector, tasa).
3. LAS ALERTAS, EN ORDEN DE IMPORTANCIA: qué implica cada una para este cliente.
4. RIESGOS QUE LOS NÚMEROS NO MUESTRAN: correlaciones en una crisis, liquidez de los instrumentos, riesgo cambiario o regulatorio.
5. PREGUNTAS PARA LA PRÓXIMA REUNIÓN: tres preguntas al cliente que ayudarían a decidir si hay que ajustar algo.

Reglas: no recomiendes comprar ni vender instrumentos puntuales; describí desvíos y riesgos para que el asesor decida. Cada afirmación con su cifra.`;
  dossier(el.querySelector("[data-ia]"), { titulo: "Revisión de cartera", prompt, nota: "sin datos personales" });
}
