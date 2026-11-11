import { getJSON, HttpError } from "./http.mjs";

/* Índices de BYMA desde sus datos abiertos (open.bymadata.com.ar).

   Desde el 19/10/2026 el Merval lo calcula MSCI en lugar de S&P: se llama
   MSCI Merval, arranca en 100.000 puntos (el cierre del 16/10 del S&P Merval
   equivale a 100.000) y cambió su composición. Yahoo dejó de actualizar
   ^MERV ese día. Para que la serie siga siendo continua, los valores
   anteriores se reexpresan en la base nueva, como hacen los sitios de datos:
   valor × 100.000 / cierre del 16/10. */

const BASE = "https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free";

export const INDICES_BYMA = {
  M: { nombre: "MSCI Merval", cambiosDeBase: [{ desde: "2026-10-19", base: 100000 }] }
};

const DIAS = { "1y": 400, "2y": 760, "5y": 1860, "10y": 3700 };

/* Reexpresa los valores anteriores a cada cambio de base. */
export function encadenar(rows, cambios = []) {
  let out = rows;
  for (const { desde, base } of cambios) {
    const previo = out.filter((x) => x.d < desde).at(-1);
    if (!previo?.c) continue;
    const f = base / previo.c;
    out = out.map((x) => (x.d < desde ? { ...x, o: x.o * f, h: x.h * f, l: x.l * f, c: x.c * f } : x));
  }
  return out;
}

export async function indiceByma(simbolo, rango = "2y") {
  const def = INDICES_BYMA[simbolo];
  if (!def) throw new HttpError(`BYMA: índice ${simbolo} desconocido`, 400);
  const hasta = Math.floor(Date.now() / 1000), desde = hasta - (DIAS[rango] || 760) * 86400;
  const j = await getJSON(`${BASE}/chart/index-historical-series/history?symbol=${simbolo}&resolution=D&from=${desde}&to=${hasta}`, { fuente: "BYMA", timeout: 15000 });
  if (j?.s !== "ok" || !Array.isArray(j.t) || !Array.isArray(j.c)) throw new HttpError("BYMA no devolvió la serie del índice", 502);
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const porFecha = new Map();
  j.t.forEach((t, i) => {
    const c = num(j.c[i]);
    if (!c) return;
    const d = new Date(t * 1000).toISOString().slice(0, 10);
    porFecha.set(d, { d, o: num(j.o?.[i]) ?? c, h: num(j.h?.[i]) ?? c, l: num(j.l?.[i]) ?? c, c, v: num(j.v?.[i]) });
  });
  const rows = encadenar([...porFecha.values()].sort((a, b) => a.d.localeCompare(b.d)), def.cambiosDeBase);
  if (rows.length < 30) throw new HttpError(`BYMA: serie de ${rows.length} ruedas`, 502);
  return { rows, meta: { moneda: "ARS", nombre: def.nombre, bolsa: "BYMA", instrumento: "índice" } };
}
