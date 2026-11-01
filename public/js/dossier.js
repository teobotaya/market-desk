/* Tarjeta de análisis con IA. El prompt queda plegado (se puede ver y
   copiar), y si hay alguna clave configurada se analiza sin salir de la app. */

import { esc, markdown, copiar, api, pref, setPref } from "./util.js";

let IA = { ia: false, proveedores: [] };
export const configurarIA = (estado) => { IA = estado || IA; };
export const iaDisponible = () => IA.ia;

export function dossier(cont, { titulo, prompt, nota = "" }) {
  const conClave = IA.proveedores.filter((p) => p.configurado);
  const elegido = pref("ia.proveedor", IA.proveedor);
  const actual = conClave.find((p) => p.id === elegido) ? elegido : IA.proveedor;
  const selector = conClave.length > 1
    ? `<select class="ia-prov" aria-label="Proveedor de IA">${conClave.map((p) => `<option value="${p.id}"${p.id === actual ? " selected" : ""}>${esc(p.nombre)}${p.gratis ? "" : " (pago)"}</option>`).join("")}</select>`
    : "";
  const nombreDe = (id) => conClave.find((p) => p.id === id)?.nombre || "IA";

  const el = document.createElement("section");
  el.className = "card ia-card";
  el.innerHTML = `
    <header class="card-h">
      <div><h3>Análisis con IA</h3><p class="card-sub">${esc(titulo)} · ${prompt.length.toLocaleString("es-AR")} caracteres${nota ? ` · ${esc(nota)}` : ""}</p></div>
      <div class="card-acc">
        ${conClave.length ? `${selector}<button class="btn primario" data-analizar>Analizar con ${esc(nombreDe(actual))}</button>` : ""}
        <button class="btn" data-copiar>Copiar prompt</button>
      </div>
    </header>
    ${conClave.length ? "" : `<p class="ia-pista">Sin clave de IA: copiá el prompt y pegalo en el modelo que uses. Para analizar desde acá, sumá una clave gratuita (Gemini, Groq u OpenRouter) en el archivo <code>.env</code>; los pasos están en <a href="#/fuentes">Fuentes y claves</a>.</p>`}
    <details class="ia-prompt"><summary>Ver el prompt</summary><pre>${esc(prompt)}</pre></details>
    <div class="ia-out" hidden></div>`;
  cont.appendChild(el);

  el.querySelector("[data-copiar]").addEventListener("click", (e) => copiar(prompt, e.currentTarget));
  const sel = el.querySelector(".ia-prov");
  const boton = el.querySelector("[data-analizar]");
  sel?.addEventListener("change", () => { setPref("ia.proveedor", sel.value); boton.textContent = `Analizar con ${nombreDe(sel.value)}`; });

  boton?.addEventListener("click", async () => {
    const out = el.querySelector(".ia-out");
    const prov = sel?.value || actual;
    boton.disabled = true;
    out.hidden = false;
    const t0 = Date.now();
    out.innerHTML = `<div class="cargando"><span class="spin"></span>Analizando con ${esc(nombreDe(prov))}… <span class="seg">0 s</span></div>`;
    const reloj = setInterval(() => { const s = out.querySelector(".seg"); if (s) s.textContent = `${Math.round((Date.now() - t0) / 1000)} s`; }, 500);
    try {
      const r = await api("/api/analizar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, proveedor: prov }) });
      out.innerHTML = `<div class="ia-meta"><span>${esc(r.proveedor)} · ${esc(r.modelo)} · ${String(r.segundos).replace(".", ",")} s</span><button class="btn chico" data-copiar-resp>Copiar respuesta</button></div>
        ${r.truncado ? `<div class="msg">La respuesta se cortó por el límite de largo del modelo.</div>` : ""}
        <div class="md">${markdown(r.texto)}</div>`;
      out.querySelector("[data-copiar-resp]").addEventListener("click", (e) => copiar(r.texto, e.currentTarget));
    } catch (e) {
      out.innerHTML = `<div class="msg err"><b>La IA no respondió.</b> ${esc(e.message)}</div>`;
    } finally {
      clearInterval(reloj);
      boton.disabled = false;
    }
  });
  return el;
}
