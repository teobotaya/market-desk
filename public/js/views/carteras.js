import { esc, num, pct, pctS, precio, grande, cls, kpi, cargando, errorHtml, api, tarjeta, fecha, subtabs, enlazarSubtabs, pref, setPref, qs, vacio } from "../util.js";
import { graficoDispersion } from "../charts.js";
import { dossier } from "../dossier.js";
import { capm, wacc, dcf, sensibilidadDcf, van, tir, xvan, xtir, recupero, apt } from "../finanzas.js";

/* Estado compartido entre pestañas: el Ke del CAPM alimenta el WACC y el
   WACC alimenta el DCF. Se recuerda entre visitas. */
const DEF = {
  rf: 4.2, beta: 1, prima: 5, riesgoPais: 0, sumarRp: false,
  E: 1000, D: 200, kd: 6, t: 25, keManual: "", usarKe: true,
  fcf: 100, g1: 8, anios: 5, gT: 2.5, desvanecer: true, waccManual: "", usarWacc: true, deudaNeta: 100, acciones: 10, precioActual: "",
  flujos: "-1000\n300\n400\n500\n200", tasa: 10,
  factores: "SPY, IEF, UUP, USO, GLD",
  activos: "SPY, QQQ, TLT, GLD, GGAL.BA", pesos: "", rfCartera: ""
};
const S = { ...DEF, ...pref("carteras", {}) };
const guardar = () => setPref("carteras", S);

const n = (v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(",", ".")));
const campo = (k, etiqueta, x = "", paso = "any") => `<label class="campo"><span>${etiqueta}</span><input data-k="${k}" type="number" step="${paso}" value="${esc(S[k])}">${x ? `<small class="faint">${x}</small>` : ""}</label>`;
const marcar = (k, etiqueta) => `<label class="chk"><input type="checkbox" data-k="${k}" ${S[k] ? "checked" : ""}>${etiqueta}</label>`;

function enlazar(el, alCambiar) {
  el.querySelectorAll("[data-k]").forEach((i) => i.addEventListener("input", () => {
    S[i.dataset.k] = i.type === "checkbox" ? i.checked : i.value;
    guardar();
    alCambiar();
  }));
}

const keCalculado = () => capm({ rf: n(S.rf), beta: n(S.beta), primaMercado: n(S.prima), riesgoPais: S.sumarRp ? n(S.riesgoPais) : 0 });
const keUsado = () => (S.usarKe ? keCalculado() : n(S.keManual));
const waccCalculado = () => wacc({ E: n(S.E), D: n(S.D), ke: keUsado(), kd: n(S.kd), t: n(S.t) });
const waccUsado = () => (S.usarWacc ? waccCalculado()?.wacc ?? null : n(S.waccManual));

export default {
  id: "carteras",
  titulo: "Armado de carteras",
  icono: "∑",
  descripcion: "Las fórmulas del armado de carteras con supuestos precargados desde los datos reales: costo del capital (CAPM y WACC), valuación por flujos descontados (DCF), VAN y TIR, modelo multifactor (APT) y optimización de carteras. Todo es editable: los resultados dependen de tus supuestos.",

  async render(el, ctx) {
    const activa = pref("carteras.tab", "capm");
    el.innerHTML = `
      <section class="card"><div class="fila" style="margin:0">
        <label>Cargar supuestos de <input class="tk" data-tk value="${esc(ctx.ticker)}" aria-label="Ticker"></label>
        <button class="btn" data-cargar>Traer datos</button>
        <span class="nota" data-estado style="margin:0">Tasa libre de riesgo (FRED), beta, riesgo país y estados de la SEC.</span>
      </div></section>
      ${subtabs("cart", [["capm", "CAPM y WACC"], ["dcf", "Valuación DCF"], ["vantir", "VAN y TIR"], ["apt", "APT multifactor"], ["optimizar", "Optimizar cartera"]], activa)}
      <div data-tab></div>`;
    const cont = el.querySelector("[data-tab]");
    const abrir = (k) => { setPref("carteras.tab", k); cont.innerHTML = ""; const d = document.createElement("div"); cont.appendChild(d); ({ capm: vCapm, dcf: vDcf, vantir: vVanTir, apt: vApt, optimizar: vOptimizar })[k](d, ctx); };
    enlazarSubtabs(el, "cart", abrir);

    el.querySelector("[data-cargar]").addEventListener("click", async () => {
      const t = el.querySelector("[data-tk]").value.trim().toUpperCase();
      const estado = el.querySelector("[data-estado]");
      estado.innerHTML = `<span class="spin" style="display:inline-block;vertical-align:middle"></span> Trayendo datos de ${esc(t)}…`;
      try {
        const s = await api(`/api/carteras/supuestos?t=${encodeURIComponent(t)}`);
        const poner = (k, v, dec = 2) => { if (!vacio(v)) S[k] = Number(v.toFixed(dec)); };
        poner("rf", s.rf?.valor); poner("beta", s.beta); poner("riesgoPais", s.riesgoPais?.valor);
        S.sumarRp = s.esArgentina;
        poner("E", s.E, 0); poner("D", s.D, 0); poner("kd", s.kd); poner("t", s.tasaImpositiva, 1);
        poner("fcf", s.fcf, 0); poner("deudaNeta", s.deudaNeta, 0); poner("acciones", s.acciones, 0); poner("precioActual", s.precio);
        const g = s.crecimientoEstimado ?? s.crecimientoHistorico;
        if (!vacio(g)) S.g1 = Number(Math.max(-20, Math.min(40, g)).toFixed(1));
        S.usarKe = true; S.usarWacc = true;
        guardar();
        estado.innerHTML = `${esc(s.empresa || t)}: Rf ${pct(s.rf?.valor, 2)} (${esc(s.rf?.fuente || "—")}), beta ${num(s.beta, 2)} contra ${esc(s.referenciaBeta || "—")}${s.esArgentina ? `, riesgo país ${pct(s.riesgoPais?.valor, 2)}` : ""}. ${s.avisos.length ? `<span class="warn">Faltó: ${esc(s.avisos.join(" · "))}</span>` : ""}`;
        abrir(pref("carteras.tab", "capm"));
      } catch (e) { estado.innerHTML = `<span class="down">${esc(e.message)}</span>`; }
    });
    abrir(activa);
  }
};

/* ------------------------------------------------------- CAPM y WACC */

function vCapm(el) {
  el.innerHTML = `<div class="grid2">
    ${tarjeta("CAPM: costo del capital propio (Ke)", `<div class="calc-grid">
        ${campo("rf", "Tasa libre de riesgo (%)", "bono del Tesoro a 10 años")}
        ${campo("beta", "Beta", "sensibilidad al mercado")}
        ${campo("prima", "Prima de mercado (%)", "Rm − Rf; suele usarse 4–6%")}
        ${campo("riesgoPais", "Riesgo país (%)", "puntos básicos / 100")}
      </div>
      <div class="fila" style="margin:10px 0 0">${marcar("sumarRp", "Sumar riesgo país (activos argentinos)")}</div>
      <div class="resultado" data-ke></div><div class="formula" data-fke></div>
      <p class="nota">El CAPM supone que el único riesgo que se paga es el de mercado (beta). Para Argentina se suma el riesgo país como prima extra, una práctica habitual aunque discutida.</p>`)}
    ${tarjeta("WACC: costo promedio ponderado del capital", `<div class="calc-grid">
        ${campo("E", "Capital propio, E", "capitalización de mercado")}
        ${campo("D", "Deuda financiera, D")}
        ${campo("kd", "Costo de la deuda, Kd (%)", "intereses / deuda")}
        ${campo("t", "Tasa impositiva (%)", "escudo fiscal")}
        ${campo("keManual", "Ke manual (%)", "si no usás el del CAPM")}
      </div>
      <div class="fila" style="margin:10px 0 0">${marcar("usarKe", "Usar el Ke del CAPM")}</div>
      <div class="resultado" data-wacc></div><div class="formula" data-fwacc></div>
      <div class="kpis compactos" data-pesos style="margin:0"></div>`)}
  </div>`;
  const calc = () => {
    const ke = keCalculado(), w = waccCalculado(), keU = keUsado();
    el.querySelector("[data-ke]").textContent = `Ke = ${pct(ke, 2)}`;
    el.querySelector("[data-fke]").textContent = `Ke = Rf + β × (Rm − Rf)${S.sumarRp ? " + RP" : ""} = ${pct(n(S.rf), 2)} + ${num(n(S.beta), 2)} × ${pct(n(S.prima), 2)}${S.sumarRp ? ` + ${pct(n(S.riesgoPais), 2)}` : ""}`;
    el.querySelector("[data-wacc]").textContent = w ? `WACC = ${pct(w.wacc, 2)}` : "WACC = —";
    el.querySelector("[data-fwacc]").textContent = w ? `WACC = E/V × Ke + D/V × Kd × (1 − t) = ${pct(w.pesoE, 1)} × ${pct(keU, 2)} + ${pct(w.pesoD, 1)} × ${pct(n(S.kd), 2)} × ${num(1 - n(S.t) / 100, 2)}` : "Completá E, D, Ke y Kd.";
    el.querySelector("[data-pesos]").innerHTML = w ? `${kpi("Peso del capital", pct(w.pesoE, 1))}${kpi("Peso de la deuda", pct(w.pesoD, 1))}${kpi("Kd después de impuestos", pct(w.kdNeto, 2))}` : "";
  };
  enlazar(el, calc);
  calc();
}

/* --------------------------------------------------------------- DCF */

function crecimientos() {
  const a = Math.max(1, Math.min(15, Math.round(n(S.anios) || 5)));
  const g1 = n(S.g1) ?? 0, gT = n(S.gT) ?? 0;
  /* Con "desvanecer", el crecimiento baja en línea recta hasta el perpetuo:
     ninguna empresa crece al mismo ritmo para siempre. */
  return Array.from({ length: a }, (_, i) => (S.desvanecer && a > 1 ? g1 + ((gT - g1) * i) / (a - 1 || 1) : g1));
}

function vDcf(el) {
  el.innerHTML = `${tarjeta("Valuación por flujos de caja descontados (DCF)", `<div class="calc-grid">
      ${campo("fcf", "Flujo de caja libre base", "últimos 12 meses")}
      ${campo("g1", "Crecimiento inicial (%)", "año 1")}
      ${campo("anios", "Años proyectados", "5 a 10", "1")}
      ${campo("gT", "Crecimiento perpetuo (%)", "no más que la economía: 2–3%")}
      ${campo("waccManual", "WACC manual (%)", "si no usás el calculado")}
      ${campo("deudaNeta", "Deuda neta", "deuda − caja")}
      ${campo("acciones", "Acciones en circulación")}
      ${campo("precioActual", "Precio actual", "para comparar")}
    </div>
    <div class="fila" style="margin:10px 0 0">${marcar("desvanecer", "Bajar el crecimiento gradualmente hasta el perpetuo")}${marcar("usarWacc", "Usar el WACC de la pestaña anterior")}</div>
    <div data-res></div>`)}
    <div class="grid2"><div data-tabla></div><div data-sens></div></div>
    <div data-ia></div>`;
  const calc = () => {
    const w = waccUsado();
    const base = { fcf0: n(S.fcf), crecimientos: crecimientos(), gTerminal: n(S.gT), wacc: w, deudaNeta: n(S.deudaNeta) ?? 0, acciones: n(S.acciones) };
    const d = vacio(w) ? null : dcf(base);
    const res = el.querySelector("[data-res]");
    if (!d || d.error) { res.innerHTML = `<div class="msg err">${esc(d?.error || "Completá el flujo base y el WACC.")}</div>`; el.querySelector("[data-tabla]").innerHTML = ""; el.querySelector("[data-sens]").innerHTML = ""; return; }
    const pa = n(S.precioActual);
    const margen = pa && d.porAccion ? (d.porAccion / pa - 1) * 100 : null;
    res.innerHTML = `<div class="kpis compactos" style="margin:14px 0 0">
        ${kpi("WACC usado", pct(w, 2))}${kpi("Valor de la empresa (EV)", grande(d.ev))}${kpi("Valor del patrimonio", grande(d.equity))}
        ${kpi("Valor por acción", precio(d.porAccion), pa ? `precio ${precio(pa)}` : "")}
        ${kpi("Diferencia con el precio", pctS(margen, 1), margen === null ? "" : margen >= 0 ? "por encima del precio" : "por debajo del precio", cls(margen))}
        ${kpi("Peso del valor terminal", pct(d.pesoTerminal, 0), "del valor total", d.pesoTerminal > 75 ? "warn" : "")}
      </div>
      <p class="nota"><b>Es el valor que surge de tus supuestos, no un precio objetivo.</b> ${d.pesoTerminal > 75 ? "Más de tres cuartos del valor depende del valor terminal: el resultado es muy sensible al crecimiento perpetuo y al WACC." : ""}</p>`;
    el.querySelector("[data-tabla]").innerHTML = tarjeta("Proyección", `<table><thead><tr><th>Año</th><th class="n">Crec.</th><th class="n">FCF</th><th class="n">Factor</th><th class="n">Valor presente</th></tr></thead><tbody>
      ${d.proyeccion.map((p) => `<tr><td>${p.anio}</td><td class="n">${pct(p.crecimiento, 1)}</td><td class="n">${grande(p.fcf)}</td><td class="n">${num(p.factor, 3)}</td><td class="n">${grande(p.pv)}</td></tr>`).join("")}
      <tr class="destacada"><td>Terminal</td><td class="n">${pct(n(S.gT), 1)}</td><td class="n">${grande(d.terminal)}</td><td class="n">${num(d.pvTerminal / d.terminal, 3)}</td><td class="n">${grande(d.pvTerminal)}</td></tr></tbody></table>
      <div class="formula">VT = FCF<sub>n</sub> × (1 + g) / (WACC − g) · EV = Σ FCF<sub>t</sub> / (1 + WACC)<sup>t</sup> + VT / (1 + WACC)<sup>n</sup></div>`);
    const ws = [-1, -0.5, 0, 0.5, 1].map((x) => w + x), gs = [-1, -0.5, 0, 0.5, 1].map((x) => n(S.gT) + x);
    const m = sensibilidadDcf(base, ws, gs);
    el.querySelector("[data-sens]").innerHTML = tarjeta("Sensibilidad del valor por acción", `<div class="tabla-scroll"><table><thead><tr><th>WACC \\ g</th>${gs.map((g) => `<th class="n">${pct(g, 1)}</th>`).join("")}</tr></thead><tbody>
      ${m.map((fila, i) => `<tr><td><b>${pct(ws[i], 1)}</b></td>${fila.map((v, j) => `<td class="n ${pa && v !== null ? cls(v - pa) : ""}" ${i === 2 && j === 2 ? 'style="outline:2px solid var(--accent)"' : ""}>${precio(v)}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div><p class="nota">En verde, combinaciones que dan más que el precio actual; en rojo, menos. El recuadro es tu caso base.</p>`);
  };
  enlazar(el, calc);
  calc();
  const w = waccUsado();
  const prompt =
`Revisá críticamente esta valuación por flujos descontados. No la valides: buscá los supuestos más frágiles.

SUPUESTOS
FCF base ${grande(n(S.fcf))} · crecimiento inicial ${pct(n(S.g1), 1)} durante ${S.anios} años${S.desvanecer ? " (bajando gradualmente)" : ""} · crecimiento perpetuo ${pct(n(S.gT), 1)}
WACC ${pct(w, 2)} (Rf ${pct(n(S.rf), 2)}, beta ${num(n(S.beta), 2)}, prima ${pct(n(S.prima), 2)}${S.sumarRp ? `, riesgo país ${pct(n(S.riesgoPais), 2)}` : ""}, Kd ${pct(n(S.kd), 2)}, tasa impositiva ${pct(n(S.t), 1)})
Deuda neta ${grande(n(S.deudaNeta))} · acciones ${grande(n(S.acciones))} · precio actual ${precio(n(S.precioActual))}

Devolvé:
1. QUÉ SUPUESTO MUEVE MÁS EL RESULTADO y por cuánto.
2. ¿ES CREÍBLE EL CRECIMIENTO? Comparalo con lo que suele sostener una empresa madura y con el crecimiento de la economía.
3. ¿EL WACC ESTÁ BIEN ARMADO? Beta, prima de mercado y, si corresponde, riesgo país.
4. QUÉ CRECIMIENTO IMPLÍCITO DESCUENTA EL PRECIO ACTUAL con este WACC.
5. LO QUE EL DCF NO CAPTURA en este caso.

Reglas: no recomiendes comprar ni vender; mostrá las cuentas.`;
  dossier(el.querySelector("[data-ia]"), { titulo: "Revisión del DCF", prompt });
}

/* ---------------------------------------------------------- VAN y TIR */

function leerFlujos(txt) {
  const lineas = String(txt).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fechas = [], montos = [];
  for (const l of lineas) {
    const partes = l.split(/[;\t]|\s{2,}/).map((x) => x.trim()).filter(Boolean);
    let f = null, m;
    if (partes.length >= 2) {
      const a = partes[0];
      f = /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.test(a) ? a.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (_, d, mm, y) => `${y}-${mm.padStart(2, "0")}-${d.padStart(2, "0")}`) : null;
      m = n(partes[1].replace(/\.(?=\d{3}(\D|$))/g, ""));
    } else m = n(partes[0].replace(/\.(?=\d{3}(\D|$))/g, ""));
    if (m === null || Number.isNaN(m)) return { error: `No entiendo la línea "${l}"` };
    fechas.push(f); montos.push(m);
  }
  const conFechas = fechas.every(Boolean);
  if (!conFechas && fechas.some(Boolean)) return { error: "Poné fecha en todas las líneas o en ninguna." };
  return { montos, fechas: conFechas ? fechas : null };
}

function vVanTir(el) {
  el.innerHTML = `<div class="grid2">
    ${tarjeta("Flujos de fondos", `<label class="campo"><span>Un flujo por línea. Sin fecha: períodos (el primero es hoy). Con fecha: <code>AAAA-MM-DD;monto</code> o <code>DD/MM/AAAA;monto</code></span>
        <textarea data-k="flujos" style="min-height:190px">${esc(S.flujos)}</textarea></label>
      <div class="calc-grid" style="margin-top:10px">${campo("tasa", "Tasa de descuento (%)", "por período o anual si hay fechas")}</div>
      <div class="fila" style="margin:10px 0 0"><button class="btn chico" data-ej="proyecto">Ejemplo: proyecto</button><button class="btn chico" data-ej="bono">Ejemplo: bono con fechas</button></div>`)}
    <div data-res></div>
  </div>`;
  const ejemplos = { proyecto: "-1000\n300\n400\n500\n200", bono: "2026-11-05;-95\n2027-05-05;3,5\n2027-11-05;3,5\n2028-05-05;3,5\n2028-11-05;103,5" };
  el.querySelectorAll("[data-ej]").forEach((b) => b.addEventListener("click", () => { S.flujos = ejemplos[b.dataset.ej]; guardar(); vVanTir(el); }));
  const calc = () => {
    const f = leerFlujos(S.flujos), res = el.querySelector("[data-res]"), tasa = n(S.tasa);
    if (f.error) { res.innerHTML = tarjeta("Resultado", `<div class="msg err">${esc(f.error)}</div>`); return; }
    if (f.montos.length < 2) { res.innerHTML = tarjeta("Resultado", `<p class="vacio">Cargá al menos dos flujos.</p>`); return; }
    if (f.fechas) {
      const fl = f.montos.map((m, i) => ({ fecha: f.fechas[i], monto: m }));
      const v = xvan(tasa, fl), r = xtir(fl);
      res.innerHTML = tarjeta("Resultado (con fechas)", `<div class="resultado ${cls(v)}">VAN = ${num(v, 2)}</div><div class="resultado">TIR = ${pct(r, 2)}</div>
        <div class="formula">VAN = Σ F<sub>i</sub> / (1 + r)<sup>(días<sub>i</sub>/365)</sup> · TIR: la r que hace VAN = 0 (tasa efectiva anual)</div>
        <table><thead><tr><th>Fecha</th><th class="n">Flujo</th><th class="n">Años</th><th class="n">Valor presente</th></tr></thead><tbody>${fl.map((x) => { const t = (Date.parse(x.fecha) - Date.parse(fl[0].fecha)) / 864e5 / 365; return `<tr><td>${fecha(x.fecha)}</td><td class="n">${num(x.monto, 2)}</td><td class="n">${num(t, 2)}</td><td class="n">${num(x.monto / (1 + tasa / 100) ** t, 2)}</td></tr>`; }).join("")}</tbody></table>
        <p class="nota">${v >= 0 ? "VAN positivo: a esa tasa, el proyecto rinde más de lo que exigís." : "VAN negativo: a esa tasa, el proyecto no alcanza lo que exigís."}</p>`);
    } else {
      const v = van(tasa, f.montos), r = tir(f.montos), p = recupero(f.montos);
      res.innerHTML = tarjeta("Resultado", `<div class="resultado ${cls(v)}">VAN = ${num(v, 2)}</div><div class="resultado">TIR = ${r === null ? "no existe" : pct(r, 2)}</div>
        <div class="formula">VAN = Σ F<sub>t</sub> / (1 + r)<sup>t</sup> · TIR: la r que hace VAN = 0</div>
        <div class="kpis compactos" style="margin:0">${kpi("Recupero", p === null ? "no recupera" : `${num(p, 2)} períodos`)}${kpi("Suma sin descontar", num(f.montos.reduce((a, b) => a + b, 0), 2))}</div>
        <table><thead><tr><th>Período</th><th class="n">Flujo</th><th class="n">Valor presente</th><th class="n">Acumulado</th></tr></thead><tbody>${(() => { let acc = 0; return f.montos.map((m, i) => { const pv = m / (1 + tasa / 100) ** i; acc += pv; return `<tr><td>${i}</td><td class="n">${num(m, 2)}</td><td class="n">${num(pv, 2)}</td><td class="n ${cls(acc)}">${num(acc, 2)}</td></tr>`; }).join(""); })()}</tbody></table>
        <p class="nota">${r === null ? "Sin cambio de signo en los flujos no hay TIR." : v >= 0 ? `VAN positivo: la TIR (${pct(r, 2)}) supera la tasa exigida.` : `VAN negativo: la TIR (${pct(r, 2)}) queda por debajo de la tasa exigida.`}</p>`);
    }
  };
  enlazar(el, calc);
  el.querySelector("textarea").addEventListener("input", (e) => { S.flujos = e.target.value; guardar(); calc(); });
  calc();
}

/* --------------------------------------------------------------- APT */

function vApt(el, ctx) {
  el.innerHTML = `<section class="card"><div class="fila" style="margin:0">
      <label>Activo <input class="tk" data-activo value="${esc(ctx.ticker)}"></label>
      <label>Factores <input data-factores value="${esc(S.factores)}" style="width:300px;font-family:var(--mono);text-transform:uppercase"></label>
      <button class="btn primario" data-estimar>Estimar betas</button>
    </div><p class="nota">Factores por defecto: mercado (SPY), tasas (IEF), dólar global (UUP), petróleo (USO) y oro (GLD). Podés usar cualquier ticker, por ejemplo ^MERV o EEM.</p></section>
    <div data-res></div>`;
  const estimar = async () => {
    S.factores = el.querySelector("[data-factores]").value; guardar();
    const res = el.querySelector("[data-res]");
    res.innerHTML = cargando("Bajando dos años de precios y estimando la regresión…");
    try {
      const d = await api(`/api/carteras/apt?${qs({ t: el.querySelector("[data-activo]").value.trim(), f: S.factores })}`);
      const rf = d.rf?.valor ?? 0;
      const primas = d.factores.map((f) => Number((f.retornoAnual - rf).toFixed(2)));
      res.innerHTML = `${d.fallidos.length ? `<div class="msg">Sin datos para: ${esc(d.fallidos.join(" · "))}</div>` : ""}
        ${tarjeta(`${esc(d.ticker)}: betas por factor`, `<div class="tabla-scroll"><table><thead><tr><th>Factor</th><th class="n">Beta</th><th class="n">t</th><th class="n">Retorno anual del factor</th><th class="n">Prima λ (%)</th><th class="n">Aporte β × λ</th></tr></thead><tbody>
          ${d.factores.map((f, i) => `<tr><td><b>${esc(f.ticker)}</b><span class="sub">${esc(f.nombre)}</span></td><td class="n">${num(f.beta, 3)}</td><td class="n ${Math.abs(f.t) >= 2 ? "up" : "faint"}" title="${Math.abs(f.t) >= 2 ? "significativo" : "no significativo"}">${num(f.t, 2)}${Math.abs(f.t) >= 2 ? " ✓" : ""}</td><td class="n">${pctS(f.retornoAnual, 1)}</td>
            <td class="n"><input data-lambda="${i}" type="number" step="any" value="${primas[i]}" style="width:90px;text-align:right;font-family:var(--mono)"></td><td class="n" data-aporte="${i}"></td></tr>`).join("")}
          </tbody></table></div>
          <div class="kpis compactos" style="margin:12px 0 0">${kpi("Tasa libre de riesgo", pct(rf, 2), d.rf?.fuente || "")}${kpi("R²", num(d.r2, 2), "qué parte del movimiento explican los factores")}${kpi("Alfa anual", pctS(d.alfaAnual, 1), `t = ${num(d.tAlfa, 2)}`)}${kpi("Semanas", String(d.semanas), `${fecha(d.desde)} a ${fecha(d.hasta)}`)}</div>
          <div class="resultado" data-er style="margin-top:12px"></div><div class="formula">E(R) = Rf + β₁λ₁ + β₂λ₂ + … + βₙλₙ</div>
          <p class="nota">Las betas salen de una regresión de los retornos semanales en dólares contra los de cada factor; t ≥ 2 (✓) indica que la beta es estadísticamente distinta de cero. La prima λ de cada factor arranca como su retorno histórico menos la tasa libre de riesgo: <b>cambiala por tu propia estimación</b>, porque el pasado reciente puede estar muy lejos de la prima esperada.</p>`)}`;
      const calc = () => {
        const ls = d.factores.map((_, i) => n(res.querySelector(`[data-lambda="${i}"]`).value) ?? 0);
        d.factores.forEach((f, i) => { res.querySelector(`[data-aporte="${i}"]`).textContent = pctS(f.beta * ls[i], 2); });
        res.querySelector("[data-er]").textContent = `Retorno esperado (APT) = ${pct(apt({ rf, betas: d.factores.map((f) => f.beta), primas: ls }), 2)}`;
      };
      res.querySelectorAll("[data-lambda]").forEach((i) => i.addEventListener("input", calc));
      calc();
    } catch (e) { res.innerHTML = errorHtml(e); }
  };
  el.querySelector("[data-estimar]").addEventListener("click", estimar);
}

/* ---------------------------------------------------------- optimizar */

function vOptimizar(el) {
  el.innerHTML = `<section class="card"><div class="calc-grid">
      <label class="campo" style="grid-column:span 2"><span>Activos (separados por coma)</span><input data-activos value="${esc(S.activos)}" style="font-family:var(--mono);text-transform:uppercase"></label>
      <label class="campo" style="grid-column:span 2"><span>Tus pesos en % (opcional, mismo orden)</span><input data-pesos value="${esc(S.pesos)}" placeholder="Vacío = partes iguales" style="font-family:var(--mono)"></label>
      <label class="campo"><span>Tasa libre de riesgo (%)</span><input data-rf type="number" step="any" value="${esc(S.rfCartera)}" placeholder="FRED 3 meses"></label>
    </div><div class="fila" style="margin:10px 0 0"><button class="btn primario" data-calc>Calcular</button><span class="nota" style="margin:0">Hasta 12 activos. Lo que cotiza en pesos se pasa a dólares CCL.</span></div></section>
    <div data-res></div>`;
  const calcular = async () => {
    S.activos = el.querySelector("[data-activos]").value; S.pesos = el.querySelector("[data-pesos]").value; S.rfCartera = el.querySelector("[data-rf]").value; guardar();
    const res = el.querySelector("[data-res]");
    res.innerHTML = cargando("Bajando dos años de precios y simulando 5.000 carteras…");
    try {
      const d = await api(`/api/carteras/optimizar?${qs({ t: S.activos, pesos: S.pesos, rf: S.rfCartera })}`);
      const fila = (nombre, c) => `<tr><td><b>${nombre}</b></td>${c.pesos.map((w) => `<td class="n">${pct(w * 100, 1)}</td>`).join("")}<td class="n">${pct(c.retorno, 1)}</td><td class="n">${pct(c.vol, 1)}</td><td class="n">${num(c.sharpe, 2)}</td></tr>`;
      const color = (v) => (v >= 0 ? `rgba(224,92,110,${Math.min(0.85, v * 0.85)})` : `rgba(63,178,127,${Math.min(0.85, -v * 0.85)})`);
      res.innerHTML = `${d.errores.length ? `<div class="msg">Sin datos para: ${esc(d.errores.join(" · "))}</div>` : ""}
        ${tarjeta("Carteras", `<div class="tabla-scroll"><table><thead><tr><th>Cartera</th>${d.activos.map((a) => `<th class="n">${esc(a.ticker)}</th>`).join("")}<th class="n">Retorno</th><th class="n">Volatilidad</th><th class="n">Sharpe</th></tr></thead><tbody>
          ${fila("Tus pesos", d.usuario)}${fila("Mínima volatilidad", d.minVar)}${fila("Máximo Sharpe", d.maxSharpe)}
          <tr><td colspan="${d.activos.length + 4}" class="grupo-titulo" style="padding-top:12px">Cada activo por separado</td></tr>
          <tr><td>Retorno anual</td>${d.activos.map((a) => `<td class="n ${cls(a.retorno)}">${pct(a.retorno, 1)}</td>`).join("")}<td colspan="3"></td></tr>
          <tr><td>Volatilidad anual</td>${d.activos.map((a) => `<td class="n">${pct(a.vol, 1)}</td>`).join("")}<td colspan="3"></td></tr>
          </tbody></table></div><p class="nota">${esc(d.aviso)} Período ${fecha(d.desde)} a ${fecha(d.hasta)} (${d.ruedas} ruedas en común) · tasa libre ${pct(d.rf, 2)}.</p>`)}
        <div class="grid2">
          ${tarjeta("Riesgo y retorno de 5.000 carteras", `<div data-nube></div><p class="nota">Cada punto gris es una combinación de pesos al azar. El borde superior izquierdo de la nube es la frontera eficiente: más retorno por cada unidad de volatilidad.</p>`)}
          ${tarjeta("Correlaciones", `<div class="tabla-scroll"><table><thead><tr><th></th>${d.activos.map((a) => `<th class="n">${esc(a.ticker)}</th>`).join("")}</tr></thead><tbody>
            ${d.correlacion.map((f, i) => `<tr><td><b>${esc(d.activos[i].ticker)}</b></td>${f.map((v, j) => `<td class="heat" style="background:${i === j ? "transparent" : color(v)}">${num(v, 2)}</td>`).join("")}</tr>`).join("")}
            </tbody></table></div><p class="nota">Rojo: se mueven juntos (diversifican poco). Verde: se mueven en sentido contrario.</p>`)}
        </div>`;
      graficoDispersion(res.querySelector("[data-nube]"), d.nube.map((p) => ({ x: p.vol, y: p.retorno })), [
        ...d.activos.map((a) => ({ x: a.vol, y: a.retorno, etiqueta: a.ticker, color: "var(--c3)", r: 4 })),
        { x: d.usuario.vol, y: d.usuario.retorno, etiqueta: "Tuya", color: "var(--c2)" },
        { x: d.minVar.vol, y: d.minVar.retorno, etiqueta: "Mín. vol.", color: "var(--up)" },
        { x: d.maxSharpe.vol, y: d.maxSharpe.retorno, etiqueta: "Máx. Sharpe", color: "var(--c4)" }
      ], { fmtX: (v) => `${num(v, 0)}%`, fmtY: (v) => `${num(v, 0)}%`, nombreX: "Volatilidad", nombreY: "Retorno", etiquetaX: "volatilidad anual →", etiquetaY: "retorno anual" });
    } catch (e) { res.innerHTML = errorHtml(e); }
  };
  el.querySelector("[data-calc]").addEventListener("click", calcular);
}
