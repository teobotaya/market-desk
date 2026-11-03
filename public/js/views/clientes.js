import { esc, num, pct, pctS, precio, grande, cls, kpi, cargando, errorHtml, api, tarjeta, fecha, tablaOrdenable, vacio } from "../util.js";
import { graficoLineas, graficoBarras } from "../charts.js";
import { dossier } from "../dossier.js";
import { PREGUNTAS, puntuar, vencimiento } from "../perfil.js";

const PERFIL = { conservador: "Conservador", moderado: "Moderado", agresivo: "Agresivo" };
const HORIZONTE = { corto: "Corto plazo", medio: "Mediano plazo", largo: "Largo plazo" };
const TIPO = { compra: "Compra", venta: "Venta", renta: "Renta cobrada" };
const CRITERIOS = [
  ["volMax", "Volatilidad máx. de la cartera", "% anual"],
  ["ddMax", "Caída máx. tolerada", "% desde un máximo"],
  ["pesoMax", "Peso máx. por posición", "% de la cartera"],
  ["stopLoss", "Pérdida máx. por posición", "% en dólares CCL"],
  ["volMaxPosicion", "Volatilidad máx. por posición", "% anual"],
  ["liquidezMin", "Liquidez mínima", "% en efectivo"],
  ["banda", "Banda de rebalanceo", "± puntos contra el objetivo"]
];
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const enviar = (metodo, ruta, cuerpo) => api(ruta, { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo ?? {}) });
const usd = (v) => (vacio(v) ? "—" : `US$ ${grande(v)}`);
const ars = (v) => (vacio(v) ? "—" : `$ ${grande(v)}`);
const hoy = () => new Date().toISOString().slice(0, 10);
const nombreArchivo = (c) => c.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

export default {
  id: "clientes",
  titulo: "Clientes",
  icono: "☺",
  descripcion: "Cartera de cada cliente armada con sus movimientos: tenencias a costo promedio, resultado realizado y no realizado, rendimiento comparable contra índices (TWR) y en dinero (TIR), agenda de cobros, riesgo y escenarios, rebalanceo contra una cartera objetivo, cuestionario de perfil del inversor de la CNV e informe imprimible. Los datos quedan solo en tu máquina, en <code>datos/clientes.json</code>, fuera del repositorio.",

  async render(el, ctx) {
    const id = ctx.params.get("c"), modo = ctx.params.get("modo");
    if (modo === "nuevo") return formulario(el, ctx, null);
    if (id && modo === "editar") return formulario(el, ctx, await api(`/api/clientes/${id}`));
    if (id && modo === "perfil") return cuestionario(el, ctx, await api(`/api/clientes/${id}`));
    if (id && modo === "informe") return informe(el, ctx, id);
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
    el.innerHTML = tarjeta("Todavía no hay clientes", `<p class="vacio">Cargá el primero con su perfil. Después registrás sus compras, ventas y rentas cobradas (a mano o importando un CSV) y la app calcula el valor de la cartera en pesos y en dólares, el rendimiento contra índices, el riesgo, la agenda de cobros y las alertas según sus criterios.</p>
      <p class="nota">Se guardan en <code>${esc(d.archivo)}</code>. Esa carpeta está en el <code>.gitignore</code>: nunca se sube a GitHub.</p>`, { acciones });
  } else {
    const vencidos = d.clientes.filter((c) => !c.perfilVence || c.perfilVence <= hoy()).length;
    el.innerHTML = `<div class="kpis compactos" data-resumen>${kpi("Clientes", String(d.clientes.length))}${kpi("Activos administrados", "…", "en dólares CCL")}${kpi("Alertas", "…")}${kpi("Perfiles a actualizar", String(vencidos), "sin cuestionario o vencido", vencidos ? "warn" : "up")}</div>
      ${tarjeta("Cartera de clientes", `<div class="clientes-grid">${d.clientes.map((c) => `
        <a class="cliente-card" href="#/clientes?c=${esc(c.id)}" data-c="${esc(c.id)}">
          <div class="cliente-nombre">${esc(c.nombre)}</div>
          <div><span class="chip">${esc(PERFIL[c.perfil] || c.perfil)}</span> <span class="chip">${esc(HORIZONTE[c.horizonte] || c.horizonte)}</span>${!c.perfilVence || c.perfilVence <= hoy() ? ` <span class="etiqueta crit">perfil ${c.perfilVence ? "vencido" : "sin cargar"}</span>` : ""}</div>
          <div class="cliente-datos" data-val>${c.cantidadMovimientos} movimientos · valuando…</div>
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
          const n = k.alertas.filter((a) => a.nivel !== "info").length;
          total += k.totales.valorUsd || 0;
          alertas += n;
          if (caja) caja.innerHTML = `<b>${usd(k.totales.valorUsd)}</b> · ${k.rendimiento ? `TWR <span class="${cls(k.rendimiento.twrUsd)}">${pctS(k.rendimiento.twrUsd, 1)}</span>` : `<span class="${cls(k.totales.gananciaUsd)}">${pctS(k.totales.gananciaUsd, 1)}</span>`} · ${n ? `<span class="etiqueta crit">${n} alerta${n > 1 ? "s" : ""}</span>` : `<span class="etiqueta ok">en criterio</span>`}`;
        } catch (e) { if (caja) caja.innerHTML = `<span class="down">${esc(e.message)}</span>`; }
        hechos++;
        const r = el.querySelector("[data-resumen]");
        if (r) r.innerHTML = `${kpi("Clientes", String(d.clientes.length))}${kpi("Activos administrados", usd(total), hechos < d.clientes.length ? `valuando ${hechos} de ${d.clientes.length}` : "en dólares CCL")}${kpi("Alertas", String(alertas), "", alertas ? "warn" : "up")}${kpi("Perfiles a actualizar", String(vencidos), "sin cuestionario o vencido", vencidos ? "warn" : "up")}`;
      }
    };
    Promise.all([trabajar(), trabajar(), trabajar()]);
  }
  el.querySelector("[data-nuevo]").addEventListener("click", () => ctx.irCon("clientes", { modo: "nuevo" }));
  el.querySelector("[data-respaldo]")?.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportado: new Date().toISOString(), clientes: d.clientes }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `clientes-${hoy()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}

/* -------------------------------------------------------- formulario */

async function formulario(el, ctx, c) {
  const { perfiles } = await api("/api/clientes");
  const perfil = c?.perfil || "moderado";
  const crit = { ...perfiles[perfil], ...(c?.criterios || {}) };
  const campo = (n, etiqueta, valor = "", tipo = "text", extra = "") => `<label class="campo"><span>${etiqueta}</span><input name="${n}" type="${tipo}" value="${esc(valor)}" ${extra}></label>`;
  el.innerHTML = `<form class="card form-cliente" novalidate>
    <header class="card-h"><div><h3>${c ? `Editar ${esc(c.nombre)}` : "Nuevo cliente"}</h3><p class="card-sub">Los movimientos y el cuestionario de perfil se cargan después, en la ficha del cliente.</p></div></header>
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
    <div class="kpis compactos">${CRITERIOS.map(([k, t, x]) => `<div class="kpi"><div class="k">${t}</div><input name="crit_${k}" type="number" min="0" step="any" value="${crit[k] ?? ""}" style="width:100%;margin-top:4px;font-family:var(--mono)"><div class="x">${x}</div></div>`).join("")}</div>
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

/* ------------------------------------------- cuestionario de perfil */

async function cuestionario(el, ctx, c) {
  const { perfiles } = await api("/api/clientes");
  const q = c.cuestionario;
  el.innerHTML = `<form class="card form-cliente" novalidate>
    <header class="card-h"><div><h3>Perfil del inversor · ${esc(c.nombre)}</h3><p class="card-sub">Cubre el contenido mínimo de las Normas de la CNV (Título VII, cap. II, art. 16): experiencia, conocimiento de los instrumentos, objetivo, situación financiera, horizonte y pérdida tolerable. Hay que actualizarlo al menos una vez por año.${q ? ` Última versión: ${fecha(q.fecha)} (vence ${fecha(vencimiento(q.fecha))}).` : ""}</p></div></header>
    ${PREGUNTAS.map((p, i) => `<fieldset class="pregunta"><legend>${i + 1}. ${esc(p.texto)}</legend>${p.opciones.map((o, j) => `<label class="opcion"><input type="radio" name="${p.id}" value="${j}"${q?.respuestas?.[p.id] === j ? " checked" : ""}> ${esc(o)}</label>`).join("")}</fieldset>`).join("")}
    <div class="grupo-titulo" style="margin-top:14px">Perfil transaccional (UIF)</div>
    <div class="form-grid">
      <label class="campo"><span>Monto anual estimado a operar (US$)</span><input name="montoAnual" type="number" min="0" step="any" value="${esc(q?.montoAnual ?? "")}"></label>
      <label class="campo"><span>Origen de los fondos</span><input name="origenFondos" maxlength="200" value="${esc(q?.origenFondos || "")}" placeholder="Ej.: ahorros de sueldo, venta de inmueble"></label>
      <label class="campo"><span>Fecha del cuestionario</span><input name="fecha" type="date" max="${hoy()}" value="${esc(q?.fecha || hoy())}"></label>
    </div>
    <div class="card" style="margin:14px 0 0" data-resultado></div>
    <div class="fila"><button class="btn primario" type="submit">Guardar cuestionario</button><button class="btn" type="button" data-aplicar>Guardar y aplicar el perfil sugerido</button><button class="btn" type="button" data-cancelar>Cancelar</button><span class="nota" data-estado style="margin:0"></span></div>
    <p class="nota">El perfil transaccional queda solo en este archivo y no se manda a ningún proveedor de IA.</p>
  </form>`;
  const f = el.querySelector("form");
  const respuestas = () => Object.fromEntries(PREGUNTAS.map((p) => { const v = f.querySelector(`input[name="${p.id}"]:checked`); return [p.id, v ? Number(v.value) : null]; }));
  const pintar = () => {
    const r = puntuar(respuestas());
    el.querySelector("[data-resultado]").innerHTML = r.completo
      ? `<div class="kpis compactos" style="margin:0">${kpi("Puntaje", `${r.puntaje} de ${r.maximo}`)}${kpi("Perfil sugerido", PERFIL[r.sugerido], r.topeado ? "limitado por horizonte o pérdida tolerable" : "", r.sugerido === c.perfil ? "up" : "warn")}${kpi("Perfil asignado hoy", PERFIL[c.perfil])}${kpi("Caída tolerada declarada", pct(r.perdidaTolerada, 0), "se usa como criterio")}</div>`
      : `<p class="vacio" style="margin:0">Faltan ${r.faltan.length} respuestas para calcular el perfil.</p>`;
  };
  f.addEventListener("change", pintar);
  pintar();
  el.querySelector("[data-cancelar]").addEventListener("click", () => ctx.irCon("clientes", { c: c.id }));
  const guardar = async (aplicar) => {
    const estado = el.querySelector("[data-estado]");
    const r = puntuar(respuestas());
    if (!r.completo) { estado.innerHTML = `<span class="down">Faltan respuestas.</span>`; return; }
    const datos = { cuestionario: { respuestas: respuestas(), fecha: f.fecha.value, montoAnual: f.montoAnual.value === "" ? null : Number(f.montoAnual.value), origenFondos: f.origenFondos.value } };
    if (aplicar) {
      datos.perfil = r.sugerido;
      datos.horizonte = r.horizonte;
      datos.criterios = { ...perfiles[r.sugerido], ddMax: r.perdidaTolerada };
    }
    estado.textContent = "Guardando…";
    try { await enviar("PUT", `/api/clientes/${c.id}`, datos); ctx.irCon("clientes", { c: c.id }); }
    catch (err) { estado.innerHTML = `<span class="down">${esc(err.message)}</span>`; }
  };
  f.addEventListener("submit", (e) => { e.preventDefault(); guardar(false); });
  el.querySelector("[data-aplicar]").addEventListener("click", () => guardar(true));
}

/* -------------------------------------------------- importar movimientos */

const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const COLUMNAS = {
  fecha: ["fecha", "date", "fecha concertacion", "fecha operacion"],
  tipo: ["tipo", "operacion", "movimiento", "type"],
  ticker: ["ticker", "especie", "simbolo", "instrumento", "symbol"],
  cantidad: ["cantidad", "nominales", "cantidad vn", "quantity"],
  precio: ["precio", "price", "precio unitario"],
  comision: ["comision", "comisiones", "gastos", "aranceles", "fee"],
  monto: ["monto", "importe", "amount", "neto"],
  moneda: ["moneda", "currency"],
  concepto: ["concepto"],
  nota: ["nota", "observacion", "observaciones", "detalle"]
};
/* Números en formato argentino o inglés: "1.234,56", "1234,56" o "1234.56". */
function numeroCsv(v) {
  let s = String(v ?? "").trim().replace(/[$\s]|US\$/gi, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function fechaCsv(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
function tipoCsv(v) {
  const s = normal(v);
  if (/^(compra|buy|c|suscripcion)/.test(s)) return { tipo: "compra" };
  if (/^(venta|sell|v|rescate)/.test(s)) return { tipo: "venta" };
  if (/dividend/.test(s)) return { tipo: "renta", concepto: "dividendo" };
  if (/cupon|renta|interes/.test(s)) return { tipo: "renta", concepto: "cupón" };
  if (/amortiz/.test(s)) return { tipo: "renta", concepto: "amortización" };
  return null;
}
function leerCsv(texto) {
  const lineas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length < 2) return { movimientos: [], errores: ["El archivo necesita una fila de encabezados y al menos un movimiento."] };
  const sep = (lineas[0].match(/;/g) || []).length >= (lineas[0].match(/,/g) || []).length ? ";" : lineas[0].includes("\t") ? "\t" : ",";
  const partir = (l) => { const out = []; let cur = "", q = false; for (const ch of l) { if (ch === "\"") q = !q; else if (ch === sep && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  const enc = partir(lineas[0]).map(normal);
  const idx = Object.fromEntries(Object.entries(COLUMNAS).map(([k, alias]) => [k, enc.findIndex((h) => alias.includes(h))]));
  if (idx.fecha < 0 || idx.tipo < 0) return { movimientos: [], errores: ["Faltan las columnas fecha y tipo (ver la plantilla)."] };
  const movimientos = [], errores = [];
  lineas.slice(1).forEach((l, i) => {
    const c = partir(l), v = (k) => (idx[k] >= 0 ? c[idx[k]] : "");
    const t = tipoCsv(v("tipo")), f = fechaCsv(v("fecha"));
    if (!t || !f) { errores.push(`Fila ${i + 2}: ${!t ? `tipo "${v("tipo")}" desconocido` : `fecha "${v("fecha")}" inválida`}`); return; }
    const m = { ...t, fecha: f, ticker: v("ticker").toUpperCase(), nota: v("nota") };
    if (t.tipo === "renta") { m.monto = numeroCsv(v("monto")); m.moneda = /ars|\$|peso/i.test(v("moneda")) && !/us/i.test(v("moneda")) ? "ARS" : "USD"; if (v("concepto")) m.concepto = normal(v("concepto")).replace("cupon", "cupón").replace("amortizacion", "amortización"); }
    else { m.cantidad = Math.abs(numeroCsv(v("cantidad")) ?? 0); m.precio = numeroCsv(v("precio")); m.comision = Math.abs(numeroCsv(v("comision")) ?? 0); }
    movimientos.push(m);
  });
  return { movimientos, errores };
}
const PLANTILLA = "fecha;tipo;ticker;cantidad;precio;comision;monto;moneda;concepto;nota\n15/01/2026;compra;GGAL.BA;100;4250,50;12,30;;;;\n02/03/2026;compra;GD30D;1000;62,15;;;;;Globales en dólares MEP\n09/07/2026;renta;GD30D;;;;82,40;USD;cupón;\n01/08/2026;venta;GGAL.BA;40;5100;8;;;;\n";

/* ----------------------------------------------------------- detalle */

async function detalle(el, ctx, id) {
  el.innerHTML = cargando("Valuando la cartera (precios, dólar CCL, rendimiento y riesgo)…");
  let k;
  try { k = await api(`/api/clientes/${id}/cartera`); }
  catch (e) { el.innerHTML = `${errorHtml(e)}<button class="btn" data-volver>Volver a la lista</button>`; el.querySelector("[data-volver]").addEventListener("click", () => ctx.irCon("clientes")); return; }
  const c = k.cliente, t = k.totales, r = k.riesgo, R = k.rendimiento;
  const guardar = async (datos) => { await enviar("PUT", `/api/clientes/${id}`, datos); ctx.rerender(); };
  const alertasReales = k.alertas.filter((a) => a.nivel !== "info");
  const spy = R?.benchmarks.find((b) => b.id === "spy");

  el.innerHTML = `
    <section class="card">
      <div class="fila" style="margin:0;align-items:flex-start">
        <div style="flex:1;min-width:240px">
          <h2 style="font-size:19px;margin:0 0 6px">${esc(c.nombre)}</h2>
          <div><span class="chip">${esc(PERFIL[c.perfil])}</span> <span class="chip">${esc(HORIZONTE[c.horizonte])}</span>${c.cuestionario ? ` <span class="chip">cuestionario ${fecha(c.cuestionario.fecha)} · sugiere ${esc(PERFIL[c.cuestionario.sugerido])}</span>` : ` <span class="etiqueta crit">sin cuestionario de perfil</span>`}${c.objetivo ? ` <span class="faint">· ${esc(c.objetivo)}</span>` : ""}</div>
          <p class="nota">${[c.email, c.telefono].filter(Boolean).map(esc).join(" · ") || "Sin datos de contacto"}${c.notas ? ` · ${esc(c.notas.slice(0, 160))}${c.notas.length > 160 ? "…" : ""}` : ""}</p>
        </div>
        <div class="card-acc"><button class="btn" data-volver>← Clientes</button><button class="btn" data-editar>Datos y criterios</button><button class="btn" data-perfil>Perfil del inversor</button><button class="btn primario" data-informe>Informe para el cliente</button><button class="btn peligro" data-eliminar>Eliminar</button></div>
      </div>
    </section>
    <div class="kpis compactos">
      ${kpi("Valor de la cartera", usd(t.valorUsd), `${ars(t.valorArs)} · CCL $ ${num(k.cclHoy, 2)}`)}
      ${kpi("Resultado no realizado", usd(t.noRealizadoUsd), `${pctS(t.gananciaUsd, 1)} sobre el costo`, cls(t.noRealizadoUsd))}
      ${kpi("Realizado y rentas", usd(t.realizadoUsd + t.rentasUsd), `ventas ${usd(t.realizadoUsd)} · rentas ${usd(t.rentasUsd)}`, cls(t.realizadoUsd + t.rentasUsd))}
      ${R ? kpi("Rendimiento (TWR)", pctS(R.twrUsd, 1), `en dólares desde ${fecha(R.desde)}${spy?.valor !== null && spy?.valor !== undefined ? ` · S&P ${pctS(spy.valor, 1)}` : ""}`, cls(R.twrUsd)) : ""}
      ${R ? kpi("TIR de la cartera", R.tirUsd !== null ? pct(R.tirUsd, 1) : "—", R.tirUsd !== null ? "anual, en dólares (ponderada por dinero)" : "hace falta más de un mes", cls(R.tirUsd)) : ""}
      ${kpi("Liquidez", pct(t.liquidez), usd(t.efectivoUsd), t.liquidez < c.criterios.liquidezMin ? "warn" : "")}
      ${kpi("Alertas", String(alertasReales.length), alertasReales.length ? "fuera de criterio" : "todo en criterio", alertasReales.length ? "warn" : "up")}
    </div>
    ${tarjeta(alertasReales.length ? "Alertas" : "Sin alertas", k.alertas.length
      ? `<ul class="lectura">${k.alertas.map((a) => `<li class="${a.nivel === "alta" ? "down" : a.nivel === "media" ? "warn" : "faint"}">${esc(a.texto)}</li>`).join("")}</ul>`
      : `<p class="vacio" style="margin:0">La cartera está dentro de todos los criterios del cliente.</p>`)}
    ${k.avisos.length ? `<div class="msg">${k.avisos.map(esc).join(" ")}</div>` : ""}
    ${R ? tarjeta("Rendimiento contra índices", `<div data-rend></div><div class="leyenda"><span><i style="background:var(--c1)"></i>Cartera (TWR en dólares)</span><span><i style="background:var(--c2)"></i>S&amp;P 500</span><span><i style="background:var(--c4)"></i>Merval en dólares CCL</span></div>
      <div class="grid2" style="margin:12px 0 0">
        <table><thead><tr><th>Desde ${fecha(R.desde)}</th><th class="n">Total</th><th class="n">Anual</th></tr></thead><tbody>
          <tr><td><b>Cartera en dólares (TWR)</b></td><td class="n ${cls(R.twrUsd)}"><b>${pctS(R.twrUsd, 1)}</b></td><td class="n">${R.twrUsdAnual !== null ? pctS(R.twrUsdAnual, 1) : "—"}</td></tr>
          <tr><td><b>Cartera en pesos (TWR)</b></td><td class="n ${cls(R.twrArs)}"><b>${pctS(R.twrArs, 1)}</b></td><td class="n">${R.twrArsAnual !== null ? pctS(R.twrArsAnual, 1) : "—"}</td></tr>
          ${R.benchmarks.map((b) => `<tr><td>${esc(b.nombre)} <span class="faint">(${b.moneda === "USD" ? "dólares" : "pesos"})</span></td><td class="n ${cls(b.valor)}">${pctS(b.valor, 1)}</td><td class="n faint">${b.valor !== null && R.anios >= 1 ? pctS(((1 + b.valor / 100) ** (1 / R.anios) - 1) * 100, 1) : "—"}</td></tr>`).join("")}
          <tr><td>TIR de la cartera (dinero)</td><td class="n">${R.multiploUsd !== null ? pctS(R.multiploUsd, 1) : "—"}<span class="sub">sobre lo invertido</span></td><td class="n">${R.tirUsd !== null ? pctS(R.tirUsd, 1) : "—"}</td></tr>
        </tbody></table>
        <div data-mensual></div>
      </div>
      <p class="nota">El TWR encadena el rendimiento de cada día y neutraliza cuándo y cuánto se invirtió: es el que se compara contra un índice. La TIR pondera por el dinero puesto en cada momento: mide el resultado de las decisiones de cuándo comprar y vender. Las rentas cobradas cuentan como rendimiento. El S&amp;P 500 no incluye dividendos.</p>`) : ""}
    ${tarjeta("Posiciones", `<div data-pos></div><p class="nota">Costo promedio ponderado (PPC) por unidad, en la moneda en que cotiza el activo; en renta fija, cada 100 nominales. El resultado en dólares usa el CCL de cada compra.</p>`)}
    ${tarjeta("Movimientos", `<div data-movs></div>
      <form class="form-pos" data-agregar novalidate>
        <select name="tipo" aria-label="Tipo">${Object.entries(TIPO).map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>
        <input name="fecha" type="date" aria-label="Fecha" value="${hoy()}" max="${hoy()}">
        <input name="ticker" class="tk" placeholder="Ticker" aria-label="Ticker">
        <input name="cantidad" type="number" min="0" step="any" placeholder="Cantidad / nominales" aria-label="Cantidad" data-solo="cv">
        <input name="precio" type="number" min="0" step="any" placeholder="Precio" aria-label="Precio" data-solo="cv">
        <input name="comision" type="number" min="0" step="any" placeholder="Comisión" aria-label="Comisión" data-solo="cv">
        <input name="monto" type="number" min="0" step="any" placeholder="Monto cobrado" aria-label="Monto" data-solo="r" hidden>
        <select name="moneda" aria-label="Moneda" data-solo="r" hidden><option value="USD">US$</option><option value="ARS">$</option></select>
        <select name="concepto" aria-label="Concepto" data-solo="r" hidden><option value="cupón">Cupón</option><option value="amortización">Amortización</option><option value="dividendo">Dividendo</option><option value="otro">Otro</option></select>
        <button class="btn" type="button" data-precio-hoy data-solo="cv" title="Completa con el último precio">Precio de hoy</button>
        <button class="btn primario" type="submit">Agregar</button>
        <span class="nota" data-estado style="margin:0"></span>
      </form>
      <details class="importar"><summary>Importar movimientos desde un CSV</summary>
        <p class="nota">Columnas: fecha, tipo (compra, venta, dividendo, cupón, amortización), ticker, cantidad, precio, comisión, monto, moneda, concepto y nota. Acepta separador ";" o ",", decimales con coma y fechas dd/mm/aaaa. Sirve para pasar el resumen de cualquier broker ordenando sus columnas en una planilla.</p>
        <div class="fila"><input type="file" accept=".csv,text/csv,text/plain" data-archivo><button class="btn" type="button" data-plantilla>Descargar plantilla</button></div>
        <div data-previa></div>
      </details>
      <p class="nota">Precio en la moneda en que cotiza el activo (pesos en BYMA, dólares en la especie D o en el exterior). En bonos, letras y ONs, la cantidad va en nominales y el precio cada 100 nominales. Una venta no puede superar la tenencia a su fecha.</p>`)}
    ${k.agenda.length || k.sensibilidad ? `<div class="grid2">
      ${tarjeta("Agenda de cobros (12 meses)", k.agenda.length ? `<div class="kpis compactos" style="margin:0 0 10px">${kpi("A cobrar en 12 meses", usd(k.agenda.reduce((s, f) => s + (f.totalUsd || 0), 0)), "cupones, amortizaciones y vencimientos")}${kpi("Próximo cobro", fecha(k.agenda[0].fecha), `${esc(k.agenda[0].ticker)} · ${k.agenda[0].moneda === "USD" ? "US$" : "$"} ${num(k.agenda[0].total, 2)}`)}</div><div data-agenda></div>` : `<p class="vacio">Sin bonos, ONs ni letras con flujos conocidos.</p>`)}
      ${tarjeta("Sensibilidad de la renta fija en dólares", k.sensibilidad ? `<div class="kpis compactos" style="margin:0 0 10px">${kpi("DV01", usd(k.sensibilidad.dv01Usd), "lo que se pierde si las TIR suben 1 pb")}${kpi("Duration modificada", num(k.sensibilidad.mdPromedio, 2), "promedio ponderado")}${kpi("Con +100 pb", usd(-k.sensibilidad.dv01Usd * 100), "aproximado", "down")}</div>
        <table><thead><tr><th>Instrumento</th><th class="n">MD</th><th class="n">Valor US$</th><th class="n">DV01</th></tr></thead><tbody>${k.sensibilidad.instrumentos.map((x) => `<tr><td>${esc(x.ticker)}</td><td class="n">${num(x.md, 2)}</td><td class="n">${grande(x.valorUsd)}</td><td class="n">${num(x.dv01Usd, 2)}</td></tr>`).join("")}</tbody></table>` : `<p class="vacio">Sin bonos u ONs en dólares con flujos conocidos.</p>`)}
    </div>` : ""}
    <div class="grid2">
      ${tarjeta("Composición", `<div data-comp></div><div class="grid2" style="margin:12px 0 0">${["porTipo", "porMoneda"].map((g) => `<table><thead><tr><th>${g === "porTipo" ? "Tipo" : "Moneda"}</th><th class="n">Peso</th></tr></thead><tbody>${k.composicion[g].map((x) => `<tr><td>${esc(x.nombre)}</td><td class="n">${pct(x.peso)}</td></tr>`).join("")}</tbody></table>`).join("")}</div>`)}
      ${tarjeta("Riesgo de la cartera actual", r ? `<div class="kpis compactos" style="margin:0">
          ${kpi("Volatilidad", pct(r.vol), `máx. ${pct(c.criterios.volMax, 0)}`, r.vol > c.criterios.volMax ? "down" : "up")}
          ${kpi("Caída máx. 1 año", pct(r.caidaMax), `tolera ${pct(c.criterios.ddMax, 0)}`, Math.abs(r.caidaMax) > c.criterios.ddMax ? "down" : "up")}
          ${kpi("VaR 95% diario", pct(r.var95), "1 de cada 20 días", "warn")}
          ${kpi("CVaR 95%", pct(r.cvar95), "promedio de esos días", "warn")}
          ${kpi("Sharpe", num(r.sharpe, 2), "sin tasa libre")}
          ${kpi("Retorno 1 año", pctS(r.retorno, 1), "con la cartera de hoy", cls(r.retorno))}
        </div>
        ${k.contribucion ? `<div class="grupo-titulo" style="margin-top:12px">Aporte de cada posición al riesgo</div><div data-contrib></div>` : ""}
        <p class="nota">Cómo se habría movido la cartera de hoy (mismas cantidades) entre ${fecha(r.desde)} y ${fecha(r.hasta)}, en dólares CCL. Mide riesgo, no el resultado real. El aporte al riesgo es la parte de la varianza que explica cada posición: una puede pesar 10% y aportar 30% del riesgo.</p>` : `<p class="vacio">Hace falta al menos una posición con historia de precios para medir el riesgo.</p>`)}
    </div>
    ${k.escenarios?.length ? tarjeta("Escenarios de estrés", `<table><thead><tr><th>Escenario</th><th class="n">Impacto</th><th class="n">% de la cartera</th><th>Más afectadas</th></tr></thead><tbody>
      ${k.escenarios.map((e) => `<tr><td><b>${esc(e.nombre)}</b><span class="sub">${esc(e.detalle)}</span></td><td class="n ${cls(e.usd)}">${usd(e.usd)}</td><td class="n ${cls(e.pct)}">${pctS(e.pct, 1)}</td><td>${e.peores.filter((p) => p.cambio < 0).map((p) => `${esc(p.ticker)} ${pctS(p.cambio, 1)}`).join(" · ") || "—"}</td></tr>`).join("")}</tbody></table>
      <p class="nota">Escenarios simples para dimensionar exposiciones, no pronósticos: usan las betas del último año, la duration de la renta fija en dólares y la moneda de cada activo.</p>`) : ""}
    ${tarjeta("Cartera objetivo y rebalanceo", `<div data-reb></div>
      <form data-objetivo novalidate>
        <div class="grupo-titulo">Pesos objetivo</div>
        <div data-filas-obj></div>
        <div class="fila"><button class="btn chico" type="button" data-mas-obj>+ Activo</button><button class="btn chico" type="button" data-actual-obj>Partir de la cartera actual</button><button class="btn primario" type="submit">Guardar objetivo</button><span class="nota" data-estado-obj style="margin:0"></span></div>
      </form>
      <p class="nota">Lo que no suma 100% queda como efectivo. Se marca lo que se sale de la banda de ±${num(c.criterios.banda ?? 5, 1)} puntos (se cambia en los criterios). Las cantidades son aproximadas, al precio de hoy y sin comisiones.</p>`)}
    ${k.cerradas.length ? tarjeta("Posiciones cerradas", `<table><thead><tr><th>Activo</th><th class="n">Resultado US$</th><th class="n">Resultado $</th><th class="n">Rentas US$</th><th class="n">Último movimiento</th></tr></thead><tbody>${k.cerradas.map((x) => `<tr><td>${esc(x.ticker)}</td><td class="n ${cls(x.realizadoUsd)}">${grande(x.realizadoUsd)}</td><td class="n ${cls(x.realizadoArs)}">${grande(x.realizadoArs)}</td><td class="n">${grande(x.rentasUsd)}</td><td class="n">${fecha(x.ultimoMovimiento)}</td></tr>`).join("")}</tbody></table>`) : ""}
    ${tarjeta("Criterios del cliente", `<div class="kpis compactos" style="margin:0">${CRITERIOS.map(([key, titulo, x]) => kpi(titulo, key === "banda" ? `±${num(c.criterios[key] ?? 5, 1)}` : pct(c.criterios[key], 0), x)).join("")}</div>`)}
    <div data-ia></div>`;

  el.querySelector("[data-volver]").addEventListener("click", () => ctx.irCon("clientes"));
  el.querySelector("[data-editar]").addEventListener("click", () => ctx.irCon("clientes", { c: id, modo: "editar" }));
  el.querySelector("[data-perfil]").addEventListener("click", () => ctx.irCon("clientes", { c: id, modo: "perfil" }));
  el.querySelector("[data-informe]").addEventListener("click", () => ctx.irCon("clientes", { c: id, modo: "informe" }));
  el.querySelector("[data-eliminar]").addEventListener("click", async () => {
    if (!confirm(`¿Eliminar a ${c.nombre} y toda su cartera? No se puede deshacer.`)) return;
    try { await enviar("DELETE", `/api/clientes/${id}`); ctx.irCon("clientes"); } catch (e) { alert(e.message); }
  });

  /* Rendimiento */
  if (R) {
    graficoLineas(el.querySelector("[data-rend]"), [
      { nombre: "Cartera", datos: R.serie.map((x) => ({ d: x.d, v: x.cartera })), color: "var(--c1)" },
      ...(R.indices.spy ? [{ nombre: "S&P 500", datos: R.indices.spy, color: "var(--c2)" }] : []),
      ...(R.indices.merval ? [{ nombre: "Merval US$", datos: R.indices.merval, color: "var(--c4)" }] : [])
    ], { alto: 220, fmtY: (v) => num(v, 0), fmtTip: (v) => num(v, 1) });
    tablaMensual(el.querySelector("[data-mensual]"), R.mensual);
  }

  /* Posiciones */
  tablaOrdenable(el.querySelector("[data-pos]"), {
    columnas: [
      { k: "ticker", t: "Activo", fmt: (v, p) => `<b>${esc(v)}</b><span class="sub">${esc(p.error ? "sin precio" : p.nombre || p.tipo)}</span>` },
      { k: "cantidad", t: "Cantidad", n: true, fmt: (v) => num(v, v % 1 ? 4 : 0) },
      { k: "ppc", t: "PPC", n: true, fmt: (v, p) => `${precio(v)}<span class="sub">desde ${fecha(p.primeraCompra)}</span>` },
      { k: "precioActual", t: "Actual", n: true, fmt: (v, p) => `${precio(v)}<span class="sub">${esc(p.moneda || "")}${p.dia !== null && p.dia !== undefined ? ` · ${pctS(p.dia, 1)} hoy` : ""}</span>` },
      { k: "valorUsd", t: "Valor US$", n: true, fmt: grande },
      { k: "peso", t: "Peso", n: true, fmt: (v) => pct(v), cls: (v) => (v > c.criterios.pesoMax ? "warn" : "") },
      { k: "gananciaArs", t: "Resultado $", n: true, fmt: (v) => pctS(v, 1), cls },
      { k: "gananciaUsd", t: "Resultado US$", n: true, fmt: (v) => pctS(v, 1), cls: (v) => (v < -c.criterios.stopLoss ? "down" : cls(v)) },
      { k: "realizadoUsd", t: "Realizado US$", n: true, fmt: (v, p) => (v || p.rentasUsd ? `${grande(v)}<span class="sub">rentas ${grande(p.rentasUsd)}</span>` : "—") },
      { k: "vol", t: "Vol. 1a", n: true, fmt: (v) => pct(v), cls: (v) => (v > c.criterios.volMaxPosicion ? "warn" : "") }
    ],
    filas: k.posiciones,
    nombreCsv: `cartera-${nombreArchivo(c)}`,
    alClick: (p) => ctx.cargarTicker(p.ticker, "cotizacion")
  });

  /* Movimientos */
  const movs = [...c.movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (movs.length) {
    tablaOrdenable(el.querySelector("[data-movs]"), {
      columnas: [
        { k: "fecha", t: "Fecha", fmt: fecha },
        { k: "tipo", t: "Tipo", fmt: (v, m) => `${esc(TIPO[v])}${m.concepto ? `<span class="sub">${esc(m.concepto)}</span>` : ""}` },
        { k: "ticker", t: "Activo", fmt: (v) => (v ? `<b>${esc(v)}</b>` : "—") },
        { k: "cantidad", t: "Cantidad", n: true, fmt: (v) => (v ? num(v, v % 1 ? 4 : 0) : "") },
        { k: "precio", t: "Precio", n: true, fmt: (v, m) => (m.tipo === "renta" ? "" : precio(v)) },
        { k: "monto", t: "Monto", n: true, fmt: (v, m) => (m.tipo === "renta" ? `${m.moneda === "USD" ? "US$" : "$"} ${num(v, 2)}` : "") },
        { k: "comision", t: "Comisión", n: true, fmt: (v) => (v ? num(v, 2) : "") },
        { k: "nota", t: "Nota", fmt: esc },
        { k: "id", t: "", fmt: (v) => `<button class="btn chico" data-quitar="${esc(v)}" title="Borrar movimiento">Borrar</button>`, csv: () => "" }
      ],
      filas: movs, limite: 15, filtro: movs.length > 15, nombreCsv: `movimientos-${nombreArchivo(c)}`
    });
  } else el.querySelector("[data-movs]").innerHTML = `<p class="vacio">Todavía no hay movimientos. Registrá la primera compra abajo o importá un CSV.</p>`;
  el.querySelector("[data-movs]").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-quitar]");
    if (!b) return;
    e.stopPropagation();
    const m = c.movimientos.find((x) => x.id === b.dataset.quitar);
    if (!m || !confirm(`¿Borrar ${TIPO[m.tipo].toLowerCase()} ${m.ticker || ""} del ${fecha(m.fecha)}?`)) return;
    try { await guardar({ movimientos: c.movimientos.filter((x) => x.id !== m.id) }); } catch (err) { alert(err.message); }
  });

  const f = el.querySelector("[data-agregar]");
  const estado = f.querySelector("[data-estado]");
  const ajustarTipo = () => {
    const renta = f.tipo.value === "renta";
    f.querySelectorAll("[data-solo]").forEach((x) => { x.hidden = (x.dataset.solo === "r") !== renta; });
    f.ticker.placeholder = renta ? "Ticker (opcional)" : "Ticker";
  };
  f.tipo.addEventListener("change", ajustarTipo);
  f.querySelector("[data-precio-hoy]").addEventListener("click", async () => {
    const tk = f.ticker.value.trim();
    if (!tk) { estado.innerHTML = `<span class="down">Escribí el ticker primero.</span>`; return; }
    estado.textContent = "Buscando precio…";
    try { const px = await api(`/api/price?t=${encodeURIComponent(tk)}&rango=1y`); f.precio.value = px.stats.last.toFixed(4); estado.textContent = `${px.ticker} · ${px.moneda}`; }
    catch (e) { estado.innerHTML = `<span class="down">${esc(e.message)}</span>`; }
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tipo = f.tipo.value;
    const nuevo = { tipo, fecha: f.fecha.value, ticker: f.ticker.value.trim() };
    if (tipo === "renta") {
      Object.assign(nuevo, { monto: Number(f.monto.value), moneda: f.moneda.value, concepto: f.concepto.value });
      if (!(nuevo.monto > 0)) { estado.innerHTML = `<span class="down">Completá el monto cobrado.</span>`; return; }
    } else {
      Object.assign(nuevo, { cantidad: Number(f.cantidad.value), precio: Number(f.precio.value), comision: Number(f.comision.value) || 0 });
      if (!nuevo.ticker || !(nuevo.cantidad > 0) || f.precio.value === "") { estado.innerHTML = `<span class="down">Completá ticker, cantidad y precio.</span>`; return; }
    }
    estado.textContent = "Guardando…";
    try { await guardar({ movimientos: [...c.movimientos, nuevo] }); } catch (err) { estado.innerHTML = `<span class="down">${esc(err.message)}</span>`; }
  });

  /* Importación */
  el.querySelector("[data-plantilla]").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([PLANTILLA], { type: "text/csv" }));
    a.download = "plantilla-movimientos.csv"; document.body.appendChild(a); a.click(); a.remove();
  });
  el.querySelector("[data-archivo]").addEventListener("change", async (e) => {
    const archivo = e.target.files?.[0];
    const previa = el.querySelector("[data-previa]");
    if (!archivo) return;
    if (archivo.size > 2e6) { previa.innerHTML = `<p class="down">El archivo pesa más de 2 MB.</p>`; return; }
    const { movimientos, errores } = leerCsv(await archivo.text());
    previa.innerHTML = `<p class="nota">${movimientos.length} movimiento${movimientos.length === 1 ? "" : "s"} leído${movimientos.length === 1 ? "" : "s"}${errores.length ? `; ${errores.length} fila${errores.length === 1 ? "" : "s"} con problemas` : ""}.</p>
      ${errores.length ? `<ul class="lectura">${errores.slice(0, 8).map((x) => `<li class="warn">${esc(x)}</li>`).join("")}</ul>` : ""}
      ${movimientos.length ? `<button class="btn primario" type="button" data-confirmar>Agregar ${movimientos.length} a la cartera</button> <span class="nota" data-estado-imp></span>` : ""}`;
    previa.querySelector("[data-confirmar]")?.addEventListener("click", async () => {
      const est = previa.querySelector("[data-estado-imp]");
      est.textContent = "Guardando…";
      try { await guardar({ movimientos: [...c.movimientos, ...movimientos] }); } catch (err) { est.innerHTML = `<span class="down">${esc(err.message)}</span>`; }
    });
  });

  /* Agenda */
  if (k.agenda.length) {
    tablaOrdenable(el.querySelector("[data-agenda]"), {
      columnas: [
        { k: "fecha", t: "Fecha", fmt: fecha }, { k: "ticker", t: "Activo", fmt: (v) => `<b>${esc(v)}</b>` },
        { k: "cupon", t: "Renta", n: true, fmt: (v) => (v === null ? "" : num(v, 2)) },
        { k: "amortizacion", t: "Amortización", n: true, fmt: (v) => (v === null ? "" : num(v, 2)) },
        { k: "total", t: "Total", n: true, fmt: (v, x) => `<b>${x.moneda === "USD" ? "US$" : "$"} ${num(v, 2)}</b>` }
      ],
      filas: k.agenda, limite: 10, nombreCsv: `cobros-${nombreArchivo(c)}`
    });
  }

  /* Composición y riesgo */
  const validas = k.posiciones.filter((p) => !p.error && p.peso !== null).sort((a, b) => b.peso - a.peso);
  if (validas.length) graficoBarras(el.querySelector("[data-comp]"), validas.map((p) => ({ etiqueta: p.ticker, v: p.peso, color: p.peso > c.criterios.pesoMax ? "var(--warn)" : "var(--c1)" })), { horizontal: true, fmt: (v) => pct(v), alClick: (it) => ctx.cargarTicker(it.etiqueta, "cotizacion") });
  else el.querySelector("[data-comp]").innerHTML = `<p class="vacio">Sin posiciones valuadas.</p>`;
  if (k.contribucion) graficoBarras(el.querySelector("[data-contrib]"), k.contribucion.map((x) => ({ etiqueta: x.ticker, v: x.riesgo, color: x.riesgo > (x.peso || 0) * 1.5 ? "var(--warn)" : "var(--c3)" })), { horizontal: true, fmt: (v) => pct(v) });

  /* Rebalanceo */
  rebalanceoUi(el, k, c, guardar);

  /* El prompt no lleva nombre, contacto ni perfil transaccional: a un
     proveedor de IA no le hace falta saber quién es el cliente. */
  const prompt =
`Revisá la cartera de un cliente de un asesor financiero (datos anonimizados).

PERFIL: ${PERFIL[c.perfil]} · horizonte ${HORIZONTE[c.horizonte].toLowerCase()}${c.objetivo ? ` · objetivo: ${c.objetivo}` : ""}${c.cuestionario ? ` · el cuestionario sugiere ${PERFIL[c.cuestionario.sugerido].toLowerCase()}` : " · sin cuestionario de perfil"}
CRITERIOS: ${CRITERIOS.map(([key, titulo]) => `${titulo.toLowerCase()} ${num(c.criterios[key], 0)}`).join(" · ")}

CARTERA (valor total ${usd(t.valorUsd)} en dólares CCL, liquidez ${pct(t.liquidez)}; no realizado ${usd(t.noRealizadoUsd)}, realizado ${usd(t.realizadoUsd)}, rentas ${usd(t.rentasUsd)})
${k.posiciones.map((p) => (p.error ? `- ${p.ticker}: sin precio` : `- ${p.ticker} (${p.tipo}, ${p.moneda}): peso ${pct(p.peso)} · resultado ${pctS(p.gananciaUsd, 1)} en US$ y ${pctS(p.gananciaArs, 1)} en pesos · volatilidad ${pct(p.vol)}`)).join("\n")}

RENDIMIENTO: ${R ? `TWR ${pctS(R.twrUsd, 1)} en dólares y ${pctS(R.twrArs, 1)} en pesos desde ${fecha(R.desde)}; TIR de la cartera ${R.tirUsd !== null ? pct(R.tirUsd, 1) : "—"}; ${R.benchmarks.map((b) => `${b.nombre} ${pctS(b.valor, 1)}`).join(" · ")}` : "sin datos"}
RIESGO DE LA CARTERA ACTUAL (último año): ${r ? `volatilidad ${pct(r.vol)} · caída máxima ${pct(r.caidaMax)} · VaR 95% ${pct(r.var95)} · Sharpe ${num(r.sharpe, 2)}` : "sin datos"}
${k.contribucion ? `APORTE AL RIESGO: ${k.contribucion.map((x) => `${x.ticker} ${pct(x.riesgo, 0)} (pesa ${pct(x.peso, 0)})`).join(" · ")}` : ""}
${k.escenarios?.length ? `ESCENARIOS: ${k.escenarios.map((e) => `${e.nombre}: ${pctS(e.pct, 1)}`).join(" · ")}` : ""}

ALERTAS
${k.alertas.map((a) => `- ${a.texto}`).join("\n") || "- ninguna"}

Devolvé:
1. ¿LA CARTERA ES COHERENTE CON EL PERFIL? Con cifras, dónde sí y dónde no.
2. RENDIMIENTO: cómo le fue contra los índices y si la diferencia entre TWR y TIR dice algo de las decisiones de entrada y salida.
3. CONCENTRACIÓN Y RIESGO: por activo, por moneda y por tipo de riesgo (país, sector, tasa); qué posiciones aportan más riesgo que su peso.
4. LAS ALERTAS, EN ORDEN DE IMPORTANCIA: qué implica cada una para este cliente.
5. PREGUNTAS PARA LA PRÓXIMA REUNIÓN: tres preguntas al cliente que ayudarían a decidir si hay que ajustar algo.

Reglas: no recomiendes comprar ni vender instrumentos puntuales; describí desvíos y riesgos para que el asesor decida. Cada afirmación con su cifra.`;
  dossier(el.querySelector("[data-ia]"), { titulo: "Revisión de cartera", prompt, nota: "sin datos personales" });
}

/* Rendimientos mensuales por año, como los resúmenes de los fondos. */
function tablaMensual(cont, mensual) {
  const anios = [...new Set(Object.keys(mensual).map((m) => m.slice(0, 4)))].sort().reverse();
  if (!anios.length) { cont.innerHTML = ""; return; }
  cont.innerHTML = `<div class="tabla-scroll"><table class="mensual"><thead><tr><th>Año</th>${MESES.map((m) => `<th class="n">${m}</th>`).join("")}<th class="n">Año</th></tr></thead><tbody>
    ${anios.map((a) => {
      const vals = MESES.map((_, i) => mensual[`${a}-${String(i + 1).padStart(2, "0")}`]);
      const anual = (vals.filter((v) => v !== undefined).reduce((s, v) => s * (1 + v / 100), 1) - 1) * 100;
      return `<tr><td><b>${a}</b></td>${vals.map((v) => `<td class="n ${v === undefined ? "faint" : cls(v)}">${v === undefined ? "" : num(v, 1)}</td>`).join("")}<td class="n ${cls(anual)}"><b>${num(anual, 1)}</b></td></tr>`;
    }).join("")}</tbody></table></div><p class="nota">Rendimiento mensual en dólares (TWR, %).</p>`;
}

function rebalanceoUi(el, k, c, guardar) {
  const reb = k.rebalanceo;
  const caja = el.querySelector("[data-reb]");
  caja.innerHTML = reb ? `<table><thead><tr><th>Activo</th><th class="n">Actual</th><th class="n">Objetivo</th><th class="n">Desvío</th><th class="n">Para volver (US$)</th><th class="n">Cantidad aprox.</th></tr></thead><tbody>
    ${reb.filas.map((x) => `<tr class="${x.fuera ? "" : "faint"}"><td><b>${esc(x.ticker)}</b>${x.fuera ? ` <span class="etiqueta crit">fuera de banda</span>` : ""}</td><td class="n">${pct(x.actual)}</td><td class="n">${pct(x.objetivo)}</td><td class="n ${x.fuera ? "warn" : ""}">${pctS(x.desvio, 1)}</td><td class="n ${cls(x.montoUsd)}">${x.montoUsd > 0 ? "comprar " : x.montoUsd < 0 ? "vender " : ""}${grande(Math.abs(x.montoUsd))}</td><td class="n">${x.cantidad === null ? "—" : num(Math.abs(x.cantidad), Math.abs(x.cantidad) < 10 ? 2 : 0)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="vacio">Definí los pesos objetivo para ver los desvíos y lo que habría que operar para volver.</p>`;
  const filas = el.querySelector("[data-filas-obj]");
  const fila = (o = { ticker: "", peso: "" }) => `<div class="fila obj"><input class="tk" placeholder="Ticker" value="${esc(o.ticker)}" data-o-t><input type="number" min="0" max="100" step="any" placeholder="Peso %" value="${esc(o.peso)}" data-o-p style="width:110px"><button class="btn chico" type="button" data-o-x>Quitar</button></div>`;
  filas.innerHTML = (c.asignacion?.length ? c.asignacion : [{ ticker: "", peso: "" }]).map(fila).join("");
  filas.addEventListener("click", (e) => { if (e.target.closest("[data-o-x]")) e.target.closest(".obj").remove(); });
  el.querySelector("[data-mas-obj]").addEventListener("click", () => filas.insertAdjacentHTML("beforeend", fila()));
  el.querySelector("[data-actual-obj]").addEventListener("click", () => {
    filas.innerHTML = k.posiciones.filter((p) => p.peso).map((p) => fila({ ticker: p.ticker, peso: p.peso.toFixed(1) })).join("") || fila();
  });
  el.querySelector("[data-objetivo]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const est = el.querySelector("[data-estado-obj]");
    const asignacion = [...filas.querySelectorAll(".obj")].map((x) => ({ ticker: x.querySelector("[data-o-t]").value.trim(), peso: Number(x.querySelector("[data-o-p]").value) })).filter((o) => o.ticker && o.peso > 0);
    const suma = asignacion.reduce((s, o) => s + o.peso, 0);
    if (suma > 100.0001) { est.innerHTML = `<span class="down">Los pesos suman ${num(suma, 1)}%.</span>`; return; }
    est.textContent = "Guardando…";
    try { await guardar({ asignacion }); } catch (err) { est.innerHTML = `<span class="down">${esc(err.message)}</span>`; }
  });
}

/* ----------------------------------------------------------- informe */

/* Informe para entregar al cliente: se imprime o se guarda como PDF desde el
   navegador. No muestra las alertas internas ni el perfil transaccional. */
async function informe(el, ctx, id) {
  el.innerHTML = cargando("Armando el informe…");
  let k;
  try { k = await api(`/api/clientes/${id}/cartera`); } catch (e) { el.innerHTML = errorHtml(e); return; }
  const c = k.cliente, t = k.totales, R = k.rendimiento;
  const desde = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10);
  const recientes = c.movimientos.filter((m) => m.fecha >= desde).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const comisiones = c.movimientos.filter((m) => m.comision).reduce((s, m) => s + m.comision, 0);
  el.innerHTML = `
    <div class="fila no-imprimir"><button class="btn" data-volver>← Volver a la ficha</button><button class="btn primario" data-imprimir>Imprimir o guardar PDF</button><span class="nota" style="margin:0">En el diálogo de impresión elegí "Guardar como PDF".</span></div>
    <article class="informe">
      <header class="informe-h">
        <div><h2>Informe de cartera</h2><p>${esc(c.nombre)} · perfil ${esc(PERFIL[c.perfil].toLowerCase())} · ${esc(HORIZONTE[c.horizonte].toLowerCase())}</p></div>
        <div class="n"><b>${fecha(hoy())}</b><p>Dólar CCL $ ${num(k.cclHoy, 2)}</p></div>
      </header>
      <section><h3>Resumen</h3>
        <div class="kpis compactos">
          ${kpi("Valor total", usd(t.valorUsd), ars(t.valorArs))}
          ${kpi("Resultado no realizado", usd(t.noRealizadoUsd), pctS(t.gananciaUsd, 1), cls(t.noRealizadoUsd))}
          ${kpi("Realizado y rentas", usd(t.realizadoUsd + t.rentasUsd), "", cls(t.realizadoUsd + t.rentasUsd))}
          ${R ? kpi("Rendimiento", pctS(R.twrUsd, 1), `en dólares desde ${fecha(R.desde)}`, cls(R.twrUsd)) : ""}
          ${kpi("Liquidez", pct(t.liquidez), usd(t.efectivoUsd))}
        </div>
      </section>
      ${R ? `<section><h3>Rendimiento comparado</h3><div data-rend></div><div class="leyenda"><span><i style="background:var(--c1)"></i>Su cartera (base 100)</span><span><i style="background:var(--c2)"></i>S&amp;P 500</span><span><i style="background:var(--c4)"></i>Merval en dólares</span></div>
        <table><thead><tr><th>Desde ${fecha(R.desde)}</th><th class="n">Rendimiento</th></tr></thead><tbody>
          <tr><td><b>Su cartera, en dólares</b></td><td class="n"><b>${pctS(R.twrUsd, 1)}</b></td></tr>
          <tr><td><b>Su cartera, en pesos</b></td><td class="n"><b>${pctS(R.twrArs, 1)}</b></td></tr>
          ${R.benchmarks.map((b) => `<tr><td>${esc(b.nombre)}</td><td class="n">${pctS(b.valor, 1)}</td></tr>`).join("")}
        </tbody></table><div data-mensual></div></section>` : ""}
      <section><h3>Composición</h3>
        <div class="grid2" style="margin:0">${["porTipo", "porMoneda"].map((g) => `<table><thead><tr><th>${g === "porTipo" ? "Tipo de activo" : "Moneda"}</th><th class="n">Valor US$</th><th class="n">Peso</th></tr></thead><tbody>${k.composicion[g].map((x) => `<tr><td>${esc(x.nombre)}</td><td class="n">${grande(x.valorUsd)}</td><td class="n">${pct(x.peso)}</td></tr>`).join("")}</tbody></table>`).join("")}</div>
      </section>
      <section><h3>Tenencias</h3>
        <table><thead><tr><th>Activo</th><th class="n">Cantidad</th><th class="n">Costo promedio</th><th class="n">Precio</th><th class="n">Valor US$</th><th class="n">Peso</th><th class="n">Resultado US$</th></tr></thead><tbody>
          ${k.posiciones.map((p) => `<tr><td><b>${esc(p.ticker)}</b>${p.nombre ? `<span class="sub">${esc(p.nombre)}</span>` : ""}</td><td class="n">${num(p.cantidad, p.cantidad % 1 ? 4 : 0)}</td><td class="n">${precio(p.ppc)}</td><td class="n">${precio(p.precioActual)}</td><td class="n">${grande(p.valorUsd)}</td><td class="n">${pct(p.peso)}</td><td class="n ${cls(p.gananciaUsd)}">${pctS(p.gananciaUsd, 1)}</td></tr>`).join("")}
          ${t.efectivoUsd ? `<tr><td>Efectivo</td><td></td><td></td><td></td><td class="n">${grande(t.efectivoUsd)}</td><td class="n">${pct(t.liquidez)}</td><td></td></tr>` : ""}
        </tbody></table>
      </section>
      ${k.agenda.length ? `<section><h3>Próximos cobros</h3><table><thead><tr><th>Fecha</th><th>Activo</th><th class="n">Monto</th></tr></thead><tbody>${k.agenda.slice(0, 12).map((f) => `<tr><td>${fecha(f.fecha)}</td><td>${esc(f.ticker)}</td><td class="n">${f.moneda === "USD" ? "US$" : "$"} ${num(f.total, 2)}</td></tr>`).join("")}</tbody></table></section>` : ""}
      <section><h3>Movimientos de los últimos 30 días</h3>${recientes.length ? `<table><thead><tr><th>Fecha</th><th>Operación</th><th>Activo</th><th class="n">Cantidad</th><th class="n">Precio / monto</th><th class="n">Comisión</th></tr></thead><tbody>${recientes.map((m) => `<tr><td>${fecha(m.fecha)}</td><td>${esc(TIPO[m.tipo])}${m.concepto ? ` (${esc(m.concepto)})` : ""}</td><td>${esc(m.ticker || "—")}</td><td class="n">${m.cantidad ? num(m.cantidad, m.cantidad % 1 ? 4 : 0) : ""}</td><td class="n">${m.tipo === "renta" ? `${m.moneda === "USD" ? "US$" : "$"} ${num(m.monto, 2)}` : precio(m.precio)}</td><td class="n">${m.comision ? num(m.comision, 2) : ""}</td></tr>`).join("")}</tbody></table>` : `<p class="vacio">Sin movimientos en el período.</p>`}
        <p class="nota">Comisiones registradas desde el inicio: ${num(comisiones, 2)} (en la moneda de cada operación).</p>
      </section>
      ${k.riesgo ? `<section><h3>Riesgo</h3><p>Con la composición actual, la cartera tuvo en el último año una volatilidad anual de ${pct(k.riesgo.vol)} y una caída máxima de ${pct(Math.abs(k.riesgo.caidaMax))}. En 1 de cada 20 días se podría esperar una baja diaria mayor a ${pct(Math.abs(k.riesgo.var95))}.</p></section>` : ""}
      <footer class="informe-pie">Valores con precios de mercado de la fecha del informe (pueden tener demora) y dólar contado con liquidación. El rendimiento en dólares se mide día por día (TWR) y no depende de los aportes ni de los retiros. Rendimientos pasados no garantizan rendimientos futuros. Este informe describe la cartera y no constituye una recomendación de compra o venta.</footer>
    </article>`;
  el.querySelector("[data-volver]").addEventListener("click", () => ctx.irCon("clientes", { c: id }));
  el.querySelector("[data-imprimir]").addEventListener("click", () => window.print());
  if (R) {
    graficoLineas(el.querySelector("[data-rend]"), [
      { nombre: "Cartera", datos: R.serie.map((x) => ({ d: x.d, v: x.cartera })), color: "var(--c1)" },
      ...(R.indices.spy ? [{ nombre: "S&P 500", datos: R.indices.spy, color: "var(--c2)" }] : []),
      ...(R.indices.merval ? [{ nombre: "Merval US$", datos: R.indices.merval, color: "var(--c4)" }] : [])
    ], { alto: 200, fmtY: (v) => num(v, 0), fmtTip: (v) => num(v, 1) });
    tablaMensual(el.querySelector("[data-mensual]"), R.mensual);
  }
}
