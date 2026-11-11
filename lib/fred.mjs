import { cached, getText, HttpError } from "./http.mjs";

/* La Reserva Federal de St. Louis publica sus series en CSV sin clave
   (fredgraph.csv). La API JSON sí pide clave; el CSV no. */
export function parseFred(csv) {
  const lineas = csv.trim().split(/\r?\n/);
  if (!/^(observation_date|DATE),/i.test(lineas[0] || "")) throw new HttpError("FRED no devolvió un CSV válido", 502);
  return lineas.slice(1).map((l) => {
    const [d, v] = l.split(",");
    return { d, v: v === "." || v === "" ? null : Number(v) };
  }).filter((x) => x.v !== null && Number.isFinite(x.v));
}

export async function fredSerie(id, desde) {
  if (!/^[A-Z0-9]+$/.test(id)) throw new HttpError("serie inválida", 400);
  return cached(`fred:${id}:${desde}`, 6 * 3600e3, async () =>
    parseFred(await getText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${desde}`, { timeout: 20000, fuente: "FRED" })));
}

/* Las series diarias de FRED son solo el cierre (sin apertura, máximo,
   mínimo ni volumen) y algunas llegan con demora: las de energía y monedas
   se actualizan una vez por semana. */
const DIAS = { "1y": 400, "2y": 760, "5y": 1860, "10y": 3700 };

/* Serie de FRED con la forma de una serie de precios (velas de cierre). */
export async function fromFred(id, rango = "2y") {
  const desde = new Date(Date.now() - (DIAS[rango] || 760) * 864e5).toISOString().slice(0, 10);
  const filas = await fredSerie(id, desde);
  if (filas.length < 30) throw new HttpError(`FRED: serie ${id} con ${filas.length} datos`, 502);
  return { rows: filas.map((x) => ({ d: x.d, o: x.v, h: x.v, l: x.v, c: x.v, v: null })), meta: { moneda: "USD", nombre: null } };
}
