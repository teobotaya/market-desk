/* Cuestionario de perfil del inversor. Cubre el contenido mínimo que piden
   las Normas de la CNV (Título VII, cap. II, art. 16 inc. j): experiencia,
   conocimiento de los instrumentos, objetivo, situación financiera,
   horizonte y pérdida tolerable. La CNV pide actualizarlo al menos una vez
   por año. Lo usan el navegador y el servidor (mismo puntaje en los dos). */

export const VIGENCIA_DIAS = 365;
export const VERSION = 1;

export const PREGUNTAS = [
  { id: "experiencia", texto: "¿Cuánta experiencia tiene invirtiendo en el mercado de capitales?", opciones: ["Ninguna", "Menos de 2 años", "Entre 2 y 5 años", "Más de 5 años"] },
  { id: "conocimiento", texto: "¿Qué instrumentos conoce y operó?", opciones: ["Solo plazo fijo o fondos money market", "Bonos, letras y fondos de renta fija", "Acciones y CEDEARs", "Opciones, futuros o posiciones apalancadas"] },
  { id: "objetivo", texto: "¿Cuál es el objetivo principal de esta inversión?", opciones: ["Preservar el capital", "Obtener una renta periódica", "Crecimiento moderado del capital", "Máximo crecimiento, aceptando mucha volatilidad"] },
  { id: "patrimonio", texto: "¿Qué parte de su patrimonio representa esta inversión?", opciones: ["Más del 75%", "Entre 50% y 75%", "Entre 25% y 50%", "Menos del 25%"] },
  { id: "ingresos", texto: "¿Tiene ingresos estables y un fondo de reserva aparte de esta inversión?", opciones: ["Ni ingresos estables ni reserva", "Ingresos estables, sin reserva", "Ingresos estables y reserva de unos 3 meses", "Ingresos estables y reserva de más de 6 meses"] },
  { id: "horizonte", texto: "¿En cuánto tiempo podría necesitar este dinero?", opciones: ["Menos de 1 año", "Entre 1 y 3 años", "Entre 3 y 5 años", "Más de 5 años"] },
  { id: "perdida", texto: "¿Qué caída máxima de la cartera toleraría sin cambiar de estrategia?", opciones: ["Hasta 5%", "Hasta 15%", "Hasta 25%", "Más de 25%"] },
  { id: "reaccion", texto: "Si la cartera cae 20% en un mes, ¿qué haría?", opciones: ["Vendería todo", "Vendería una parte", "Mantendría las posiciones", "Compraría más"] }
];

/* Caída máxima que el cliente declaró tolerar, para proponer el criterio. */
export const PERDIDA_TOLERADA = [5, 15, 25, 40];
export const HORIZONTE_DE = ["corto", "medio", "largo", "largo"];

/* Puntaje de 0 a 24. El horizonte y la pérdida tolerable topean el perfil:
   alguien que necesita el dinero en menos de un año o que no tolera caídas
   de más de 5% es conservador aunque sume muchos puntos en lo demás. */
export function puntuar(respuestas) {
  const faltan = PREGUNTAS.filter((p) => !Number.isInteger(respuestas?.[p.id]) || respuestas[p.id] < 0 || respuestas[p.id] >= p.opciones.length);
  if (faltan.length) return { completo: false, faltan: faltan.map((p) => p.id) };
  const puntaje = PREGUNTAS.reduce((s, p) => s + respuestas[p.id], 0);
  let nivel = puntaje <= 8 ? 0 : puntaje <= 16 ? 1 : 2;
  const tope = Math.min(respuestas.horizonte === 0 ? 0 : respuestas.horizonte === 1 ? 1 : 2, respuestas.perdida === 0 ? 0 : respuestas.perdida === 1 ? 1 : 2);
  nivel = Math.min(nivel, tope);
  return {
    completo: true, puntaje, maximo: PREGUNTAS.length * 3,
    sugerido: ["conservador", "moderado", "agresivo"][nivel],
    topeado: tope < (puntaje <= 8 ? 0 : puntaje <= 16 ? 1 : 2),
    perdidaTolerada: PERDIDA_TOLERADA[respuestas.perdida],
    horizonte: HORIZONTE_DE[respuestas.horizonte]
  };
}

const NIVEL = { conservador: 0, moderado: 1, agresivo: 2 };
export const masAgresivo = (a, b) => NIVEL[a] > NIVEL[b];

export function vencimiento(fecha) {
  if (!fecha) return null;
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + VIGENCIA_DIAS);
  return d.toISOString().slice(0, 10);
}
