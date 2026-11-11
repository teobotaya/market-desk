import { esc, num, pctS, precio, cls, cargando, errorHtml, api, tarjeta, kpi, fecha } from "../util.js";
import { sparkline, graficoBarras, graficoLineas, medidor } from "../charts.js";
import { dossier } from "../dossier.js";

/* Un dato de más de 4 días (fin de semana largo incluido) se marca con su
   fecha: FRED y BYMA publican con demora, y no tiene que parecer de hoy. */
const atrasado = (f) => Boolean(f) && Date.now() - Date.parse(`${f}T00:00:00Z`) > 4 * 864e5;

export default {
  id: "resumen",
  titulo: "Resumen de mercado",
  icono: "◉",
  descripcion: "Índices, tasas, monedas, materias primas y cripto con su variación del día, del mes y del año; rotación sectorial; sentimiento y curva de tasas de EE.UU. Tocá cualquier fila para abrir el activo.",

  async render(el, ctx) {
    el.innerHTML = `
      <div data-tablero>${cargando("Armando el tablero (son unas 30 series)…")}</div>
      <div class="grid2 bloque">
        <div data-sectores>${cargando("Sectores…")}</div>
        <div data-miedo>${cargando("Sentimiento…")}</div>
      </div>
      <div data-macro>${cargando("Tasas y spreads de la Fed…")}</div>
      <div data-ia></div>`;

    const resultados = {};
    const abrir = (t) => ctx.cargarTicker(t, "cotizacion");

    const tablero = api("/api/mercado/tablero").then((d) => {
      resultados.tablero = d;
      el.querySelector("[data-tablero]").innerHTML = `<div class="tablero">${d.grupos.map((g) => tarjeta(g.grupo, `
        <div class="tabla-scroll"><table><thead><tr><th>Activo</th><th class="n">Último</th><th class="n">Día</th><th class="n">Mes</th><th class="n">Año</th><th class="n">3 meses</th></tr></thead><tbody>
        ${g.items.map((x) => x.error
          ? `<tr><td>${esc(x.nombre)}</td><td colspan="5" class="faint" title="${esc(x.error)}">sin datos</td></tr>`
          : `<tr class="clic" data-t="${esc(x.ticker)}" title="${esc(x.ticker)} · ${esc(x.fuente)} · ${fecha(x.fecha)}"><td>${esc(x.nombre)}${atrasado(x.fecha) ? `<span class="sub warn">al ${fecha(x.fecha)} · ${esc(x.fuente)}</span>` : ""}</td>
              <td class="n">${g.tasa ? `${num(x.last, 2)}%` : precio(x.last)}</td>
              <td class="n ${cls(x.ret1)}">${pctS(x.ret1, 1)}</td><td class="n ${cls(x.ret21)}">${pctS(x.ret21, 1)}</td><td class="n ${cls(x.retYtd)}">${pctS(x.retYtd, 1)}</td>
              <td class="n">${sparkline(x.spark, { w: 64, h: 20 })}</td></tr>`).join("")}
        </tbody></table></div>`)).join("")}</div>
        <p class="nota">${esc(d.fuente)}. En tasas, la variación es del rendimiento, no del precio del bono. "Año" es desde el último cierre del año anterior.</p>`;
      el.querySelectorAll("[data-tablero] tr[data-t]").forEach((tr) => tr.addEventListener("click", () => abrir(tr.dataset.t)));
    }).catch((e) => { el.querySelector("[data-tablero]").innerHTML = errorHtml(e); });

    const sectores = api("/api/mercado/sectores").then((d) => {
      resultados.sectores = d;
      const cont = el.querySelector("[data-sectores]");
      let campo = "ret21";
      const pintar = () => {
        const items = d.filas.filter((f) => !f.error).map((f) => ({ etiqueta: f.nombre, v: f[campo], ticker: f.ticker })).sort((a, b) => b.v - a.v);
        graficoBarras(cont.querySelector("[data-g]"), items, { horizontal: true, fmt: (v) => pctS(v, 1), alClick: (it) => abrir(it.ticker) });
      };
      cont.innerHTML = tarjeta("Rotación sectorial", `<div data-g></div><p class="nota">${esc(d.fuente)}. Tocá una barra para abrir el ETF.</p>`, {
        acciones: `<div class="segmentos" data-campo>${[["ret1", "Día"], ["ret5", "Semana"], ["ret21", "Mes"], ["retYtd", "Año"], ["ret252", "12 m"]].map(([k, t]) => `<button data-v="${k}" aria-pressed="${k === campo}">${t}</button>`).join("")}</div>`
      });
      cont.querySelector("[data-campo]").addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        campo = b.dataset.v;
        cont.querySelectorAll("[data-campo] button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        pintar();
      });
      pintar();
    }).catch((e) => { el.querySelector("[data-sectores]").innerHTML = tarjeta("Rotación sectorial", errorHtml(e)); });

    const miedo = api("/api/mercado/miedo").then((d) => {
      resultados.miedo = d;
      el.querySelector("[data-miedo]").innerHTML = tarjeta("Miedo y codicia (CNN)", `
        ${medidor(d.valor, d.etiqueta)}
        <p style="text-align:center;margin:4px 0 12px;font-weight:600;text-transform:capitalize">${esc(d.etiqueta)}</p>
        <div class="kpis cuatro" style="margin:0">
          ${kpi("Cierre previo", num(d.previo, 0))}${kpi("Hace 1 semana", num(d.semana, 0))}${kpi("Hace 1 mes", num(d.mes, 0))}${kpi("Hace 1 año", num(d.anio, 0))}
        </div>
        <p class="nota">Combina momento, amplitud, opciones put/call, demanda de refugio, bonos basura y volatilidad. Es un termómetro del clima, no un indicador de entrada o salida.</p>`);
    }).catch((e) => { el.querySelector("[data-miedo]").innerHTML = tarjeta("Miedo y codicia (CNN)", errorHtml(e)); });

    const macro = api("/api/mercado/macro").then((d) => {
      resultados.macro = d;
      const cont = el.querySelector("[data-macro]");
      cont.innerHTML = `<div class="grid2 bloque">
        ${tarjeta("Curva de tasas del Tesoro de EE.UU.", `<div data-curva></div><div class="leyenda"><span><i style="background:var(--c1)"></i>Hoy</span><span><i style="background:var(--c2)"></i>Hace 1 mes</span><span><i style="background:var(--c4)"></i>Hace 1 año</span></div>
          <p class="nota">Si la parte corta rinde más que la larga, la curva está invertida: históricamente precedió recesiones, con demoras muy variables.</p>`)}
        ${tarjeta("Indicadores de la Fed (FRED)", `<div class="tabla-scroll"><table><thead><tr><th>Serie</th><th class="n">Último</th><th class="n">1 mes</th><th class="n">1 año</th><th></th></tr></thead><tbody>
          ${d.indicadores.map((x) => x.error ? `<tr><td>${esc(x.nombre)}</td><td colspan="4" class="faint" title="${esc(x.error)}">sin datos</td></tr>` : `<tr title="${esc(x.id)} · ${fecha(x.fecha)}"><td>${esc(x.nombre)}</td><td class="n">${num(x.valor, 2)}${x.unidad === "%" ? "%" : ""}</td>
            <td class="n ${cls(x.cambio1m)}">${x.cambio1m === null ? "—" : `${x.cambio1m > 0 ? "+" : ""}${num(x.cambio1m, 2)}`}</td><td class="n ${cls(x.cambio1a)}">${x.cambio1a === null ? "—" : `${x.cambio1a > 0 ? "+" : ""}${num(x.cambio1a, 2)}`}</td>
            <td class="n">${sparkline(x.serie.slice(-120).map((p) => p.v), { w: 70, h: 20, color: "var(--accent)" })}</td></tr>`).join("")}
          </tbody></table></div><p class="nota">${esc(d.fuente)}. Cambios en puntos porcentuales.</p>`)}
      </div>`;
      /* Plazos equiespaciados, como se grafica la curva habitualmente: en
         escala de años, 1M, 3M y 6M quedarían amontonados en el borde. */
      const pts = (k) => d.curva.map((c, i) => ({ x: i, v: c[k], etiqueta: c.plazo })).filter((p) => p.v !== null);
      graficoLineas(cont.querySelector("[data-curva]"), [
        { nombre: "Hoy", datos: pts("hoy"), color: "var(--c1)", puntos: true, ancho: 2.2 },
        { nombre: "Hace 1 mes", datos: pts("hace1m"), color: "var(--c2)", punteada: true },
        { nombre: "Hace 1 año", datos: pts("hace1a"), color: "var(--c4)", punteada: true }
      ], { xNum: true, alto: 230, fmtY: (v) => `${num(v, 2)}%`, etiquetasX: d.curva.map((c, i) => ({ x: i, t: c.plazo })) });
    }).catch((e) => { el.querySelector("[data-macro]").innerHTML = tarjeta("Tasas de la Fed", errorHtml(e)); });

    await Promise.allSettled([tablero, sectores, miedo, macro]);
    const linea = (x) => `${x.nombre}: ${x.last === undefined ? "sin datos" : `${precio(x.last)} (día ${pctS(x.ret1, 1)}, mes ${pctS(x.ret21, 1)}, año ${pctS(x.retYtd, 1)})`}`;
    const prompt =
`Escribí el brief de mercado de hoy para un analista. Primero la foto, después la interpretación.

TABLERO
${resultados.tablero ? resultados.tablero.grupos.map((g) => `${g.grupo}:\n${g.items.map((x) => `- ${linea(x)}`).join("\n")}`).join("\n") : "(no disponible)"}

SECTORES (mes / año)
${resultados.sectores ? resultados.sectores.filas.filter((f) => !f.error).map((f) => `- ${f.nombre}: ${pctS(f.ret21, 1)} / ${pctS(f.retYtd, 1)}`).join("\n") : "(no disponible)"}

SENTIMIENTO: ${resultados.miedo ? `Fear & Greed ${num(resultados.miedo.valor, 0)} (${resultados.miedo.etiqueta}); hace un mes ${num(resultados.miedo.mes, 0)}` : "no disponible"}

TASAS Y SPREADS (FRED)
${resultados.macro ? resultados.macro.indicadores.filter((x) => !x.error).map((x) => `- ${x.nombre}: ${num(x.valor, 2)} (1 mes ${num(x.cambio1m, 2)}, 1 año ${num(x.cambio1a, 2)})`).join("\n") : "(no disponible)"}

Devolvé:
1. LO QUE PASÓ, EN CINCO LÍNEAS: los movimientos que importan, con cifras.
2. EL RÉGIMEN: ¿riesgo sí o riesgo no? Apoyalo en al menos tres series que coincidan, y marcá las que lo contradicen.
3. ROTACIÓN: qué sectores lideran y qué dice eso del ciclo que está descontando el mercado.
4. TASAS Y CRÉDITO: qué dicen la curva y los spreads sobre crecimiento e inflación.
5. LATAM Y ARGENTINA: cómo se ubica el Merval y el real frente al resto.
6. QUÉ MIRAR: tres datos o eventos que confirmarían o romperían la lectura.

Reglas: sin recomendaciones de inversión; cada afirmación con su cifra; si un dato falta, decilo.`;
    dossier(el.querySelector("[data-ia]"), { titulo: "Brief de mercado", prompt });
  }
};
