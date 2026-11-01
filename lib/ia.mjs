/* Proveedores de análisis con IA. Ninguno es obligatorio: sin clave la app
   arma el prompt y lo copiás a mano en el modelo que prefieras.

   Gratis (con límites por minuto o por día):
   - Gemini (Google AI Studio), Groq, OpenRouter (modelos ":free"),
     Cerebras, Mistral (plan Experiment) y Ollama (corre en tu máquina).
   De pago: Anthropic (Claude) y OpenAI.

   Groq, OpenRouter, Cerebras, Mistral, OpenAI y Ollama hablan el mismo
   protocolo (el de OpenAI), así que comparten el código. */

const env = process.env;

const PROVEEDORES = {
  gemini: {
    nombre: "Gemini", gratis: true, tipo: "gemini",
    clave: () => env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "",
    modelo: () => env.GEMINI_MODEL || "",
    web: "https://aistudio.google.com/apikey"
  },
  groq: {
    nombre: "Groq", gratis: true, tipo: "openai", base: "https://api.groq.com/openai/v1",
    clave: () => env.GROQ_API_KEY || "", modelo: () => env.GROQ_MODEL || "",
    preferidos: [/gpt-oss-120b/, /llama-3\.3-70b/, /llama-4.*maverick/, /qwen3?-.*32b/, /llama.*70b/, /llama/],
    excluir: /whisper|guard|tts|playai|distil|prompt|compound/i,
    web: "https://console.groq.com/keys"
  },
  openrouter: {
    nombre: "OpenRouter", gratis: true, tipo: "openai", base: "https://openrouter.ai/api/v1",
    clave: () => env.OPENROUTER_API_KEY || "", modelo: () => env.OPENROUTER_MODEL || "",
    soloGratis: true,
    preferidos: [/deepseek.*(chat|v3|r1)/, /llama-3\.3-70b/, /qwen.*(235|72|32)/, /gpt-oss/, /gemma-3-27b/, /mistral/],
    excluir: /vision|vl\b|image|audio/i,
    web: "https://openrouter.ai/keys"
  },
  cerebras: {
    nombre: "Cerebras", gratis: true, tipo: "openai", base: "https://api.cerebras.ai/v1",
    clave: () => env.CEREBRAS_API_KEY || "", modelo: () => env.CEREBRAS_MODEL || "",
    preferidos: [/gpt-oss-120b/, /qwen.*235/, /llama.*70b/, /llama/],
    web: "https://cloud.cerebras.ai"
  },
  mistral: {
    nombre: "Mistral", gratis: true, tipo: "openai", base: "https://api.mistral.ai/v1",
    clave: () => env.MISTRAL_API_KEY || "", modelo: () => env.MISTRAL_MODEL || "",
    preferidos: [/^mistral-large-latest$/, /^mistral-medium-latest$/, /^mistral-small-latest$/],
    excluir: /embed|ocr|moderation|codestral|pixtral|voxtral/i,
    web: "https://console.mistral.ai/api-keys"
  },
  ollama: {
    nombre: "Ollama (local)", gratis: true, tipo: "openai",
    base: `${(env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "")}/v1`,
    clave: () => (env.OLLAMA_URL || env.OLLAMA_MODEL ? "ollama" : ""), modelo: () => env.OLLAMA_MODEL || "",
    preferidos: [/qwen/, /llama/, /gemma/, /mistral/],
    web: "https://ollama.com"
  },
  anthropic: {
    nombre: "Claude", gratis: false, tipo: "anthropic",
    clave: () => env.ANTHROPIC_API_KEY || "", modelo: () => env.ANTHROPIC_MODEL || env.CLAUDE_MODEL || "",
    web: "https://console.anthropic.com/settings/keys"
  },
  openai: {
    nombre: "OpenAI", gratis: false, tipo: "openai", base: "https://api.openai.com/v1",
    clave: () => env.OPENAI_API_KEY || "", modelo: () => env.OPENAI_MODEL || "",
    preferidos: [/^gpt-5(\.\d)?$/, /^gpt-5-mini/, /^gpt-4\.1$/, /^gpt-4o$/],
    excluir: /audio|realtime|embedding|tts|whisper|dall|image|transcribe|search|moderation|codex|nano/i,
    web: "https://platform.openai.com/api-keys"
  }
};

const ORDEN = ["gemini", "groq", "openrouter", "cerebras", "mistral", "ollama", "anthropic", "openai"];
const elegidos = {};

export const SISTEMA = [
  "Sos un analista financiero escéptico que asiste a un analista de mercado profesional.",
  "Trabajás solo con los datos que te dan y decís explícitamente cuándo algo es un supuesto tuyo.",
  "Nunca recomendás comprar ni vender, ni das asesoramiento financiero personalizado: describís riesgos, evidencia y escenarios para que la persona decida.",
  "Respondés en español rioplatense, sin relleno, en Markdown: títulos con ##, viñetas cortas y cifras exactas tal como aparecen en los datos."
].join(" ");

export const configurados = () => ORDEN.filter((k) => PROVEEDORES[k].clave());

export function proveedorPorDefecto() {
  const pref = (env.IA_PROVEEDOR || "").toLowerCase();
  const lista = configurados();
  return lista.includes(pref) ? pref : lista[0] || null;
}

/* Si IA_MODELO está definido, aplica al proveedor por defecto (compatible con
   la configuración anterior). */
function modeloFijo(k) {
  return PROVEEDORES[k].modelo() || (k === proveedorPorDefecto() ? env.IA_MODELO || "" : "");
}

export function estadoIA() {
  return {
    ia: configurados().length > 0,
    proveedor: proveedorPorDefecto(),
    proveedores: ORDEN.map((k) => ({
      id: k, nombre: PROVEEDORES[k].nombre, gratis: PROVEEDORES[k].gratis,
      configurado: Boolean(PROVEEDORES[k].clave()), modelo: elegidos[k] || modeloFijo(k) || null, web: PROVEEDORES[k].web
    }))
  };
}

async function respuestaJson(r, nombre) {
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch { /* algunos errores vienen en texto */ }
  if (!r.ok) {
    const msg = j?.error?.message || j?.message || txt.slice(0, 200) || `HTTP ${r.status}`;
    if (r.status === 401 || r.status === 403) throw new Error(`${nombre} rechazó la clave (${r.status}). Revisá la variable en el .env. Detalle: ${msg}`);
    if (r.status === 429) throw new Error(`${nombre}: se agotó la cuota gratuita por ahora (429). Esperá un minuto o elegí otro proveedor. Detalle: ${msg}`);
    const e = new Error(`${nombre} respondió ${r.status}: ${msg}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

/* ------------------------------------------------------- elegir modelo */

/* No adivinamos identificadores de modelo: se los preguntamos a cada API y
   elegimos según una lista de preferencias. */
async function elegirModelo(k) {
  if (elegidos[k]) return elegidos[k];
  const fijo = modeloFijo(k);
  if (fijo) return (elegidos[k] = fijo);
  const p = PROVEEDORES[k];

  if (p.tipo === "gemini") {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": p.clave() }, signal: AbortSignal.timeout(15000) });
    const j = await respuestaJson(r, "Google");
    const aptos = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((m) => /^gemini-/.test(m) && !/vision|embed|aqa|tuning|image|tts|live|audio|robotics|computer/i.test(m));
    const version = (m) => {
      const v = m.match(/gemini-(\d+)(?:\.(\d+))?/);
      return v ? Number(v[1]) * 100 + Number(v[2] || 0) : 0;
    };
    const porVersion = (a, b) => version(b) - version(a) || a.length - b.length;
    /* La capa gratuita cubre los modelos "flash": se prefieren los estables
       (sin "preview" ni "exp") y la versión más alta. */
    const estable = (m) => !/preview|exp|latest/i.test(m);
    const flash = aptos.filter((m) => /flash/.test(m) && !/lite/.test(m)).sort(porVersion);
    const lite = aptos.filter((m) => /flash-lite/.test(m)).sort(porVersion);
    const pro = aptos.filter((m) => /pro/.test(m)).sort(porVersion);
    elegidos[k] = flash.find(estable) || flash[0] || lite.find(estable) || lite[0] || pro[0] || aptos[0];
  } else if (p.tipo === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=50", { headers: { "x-api-key": p.clave(), "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(15000) });
    const j = await respuestaJson(r, "Anthropic");
    const ids = (j.data || []).map((m) => m.id);
    elegidos[k] = ids.find((i) => /sonnet/i.test(i)) || ids[0];
  } else {
    const headers = k === "ollama" ? {} : { Authorization: `Bearer ${p.clave()}` };
    const r = await fetch(`${p.base}/models`, { headers, signal: AbortSignal.timeout(15000) });
    const j = await respuestaJson(r, p.nombre);
    let modelos = (j.data || j.models || []).map((m) => ({ id: m.id || m.name, gratis: m.pricing ? Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0 : true }));
    if (p.soloGratis) modelos = modelos.filter((m) => m.gratis || /:free$/.test(m.id));
    const ids = modelos.map((m) => m.id).filter((id) => id && !(p.excluir && p.excluir.test(id)));
    let elegido = null;
    for (const re of p.preferidos || []) { elegido = ids.find((i) => re.test(i)); if (elegido) break; }
    elegidos[k] = elegido || ids[0];
  }
  if (!elegidos[k]) throw new Error(`${p.nombre} no devolvió ningún modelo disponible para esta clave`);
  return elegidos[k];
}

/* ------------------------------------------------------------- llamadas */

async function llamarGemini(p, modelo, prompt, reintento = true) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": p.clave() },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SISTEMA }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      /* Los modelos 2.5+ "piensan" con tokens de salida: con un tope bajo la
         respuesta llega vacía. */
      generationConfig: { maxOutputTokens: 8192, temperature: 0.4 }
    }),
    signal: AbortSignal.timeout(180000)
  });
  let j;
  try { j = await respuestaJson(r, "Google"); }
  catch (e) {
    /* Google a veces retira un modelo para cuentas nuevas y dice en el error
       cuál usar. Le hacemos caso una vez y lo recordamos. */
    const sugerido = e.message.match(/models\/([a-z0-9.\-]+)/gi)?.map((x) => x.replace("models/", "")).find((x) => x !== modelo);
    if (reintento && (sugerido || e.status === 404)) {
      delete elegidos.gemini;
      const nuevo = sugerido || await elegirModelo("gemini");
      elegidos.gemini = nuevo;
      return llamarGemini(p, nuevo, prompt, false);
    }
    throw e;
  }
  const texto = (j.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text).filter(Boolean).join("\n");
  if (!texto) throw new Error(`Google no devolvió texto (motivo: ${j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || "desconocido"})`);
  return { texto, modelo, truncado: j.candidates?.[0]?.finishReason === "MAX_TOKENS" };
}

async function llamarAnthropic(p, modelo, prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": p.clave(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: modelo, max_tokens: 4000, system: SISTEMA, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(180000)
  });
  const j = await respuestaJson(r, "Anthropic");
  return { texto: (j.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n"), modelo, truncado: j.stop_reason === "max_tokens" };
}

async function llamarOpenAI(k, p, modelo, prompt) {
  const headers = { "content-type": "application/json" };
  if (k !== "ollama") headers.Authorization = `Bearer ${p.clave()}`;
  if (k === "openrouter") { headers["HTTP-Referer"] = "http://localhost"; headers["X-Title"] = "Market Desk"; }
  const cuerpo = { model: modelo, messages: [{ role: "system", content: SISTEMA }, { role: "user", content: prompt }] };
  if (k === "openai") cuerpo.max_completion_tokens = 6000;
  else { cuerpo.max_tokens = 4000; cuerpo.temperature = 0.4; }
  const r = await fetch(`${p.base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(240000) });
  const j = await respuestaJson(r, p.nombre);
  const c = j.choices?.[0];
  /* Algunos modelos de razonamiento devuelven su borrador entre <think>. */
  const texto = String(c?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!texto) throw new Error(`${p.nombre} no devolvió texto (motivo: ${c?.finish_reason || "desconocido"})`);
  return { texto, modelo, truncado: c?.finish_reason === "length" };
}

export async function analizar(prompt, proveedor) {
  const k = proveedor && PROVEEDORES[proveedor]?.clave() ? proveedor : proveedorPorDefecto();
  if (!k) {
    throw new Error("No hay ninguna clave de IA configurada. Poné una gratuita en el .env (GEMINI_API_KEY, GROQ_API_KEY u OPENROUTER_API_KEY) o copiá el prompt y usalo donde quieras.");
  }
  const p = PROVEEDORES[k];
  const modelo = await elegirModelo(k);
  const t0 = Date.now();
  const out = p.tipo === "gemini" ? await llamarGemini(p, modelo, prompt)
    : p.tipo === "anthropic" ? await llamarAnthropic(p, modelo, prompt)
    : await llamarOpenAI(k, p, modelo, prompt);
  return { proveedor: p.nombre, id: k, segundos: Math.round((Date.now() - t0) / 100) / 10, ...out };
}
