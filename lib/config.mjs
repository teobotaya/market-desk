import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Lee las claves sin dependencias, de varios archivos posibles. Todos están
   cubiertos por el .gitignore, así que nunca llegan al repositorio.
   El de _privado/ existe porque macOS oculta los archivos que empiezan con
   punto y encontrarlos es una pelea innecesaria. Una variable ya definida en
   el entorno siempre gana sobre la del archivo. */
const ARCHIVOS_CLAVES = [".env", "_privado/claves.txt", "_privado/EJEMPLO.env.txt", "claves.txt"];

export const archivosLeidos = [];
for (const archivo of ARCHIVOS_CLAVES) {
  let raw;
  try { raw = fs.readFileSync(path.join(ROOT, archivo), "utf8"); } catch { continue; }
  archivosLeidos.push(archivo);
  for (const linea of raw.split(/\r?\n/)) {
    const m = linea.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || !m[2] || m[2].startsWith("#")) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const PORT = Number(process.env.PORT) || 5173;

/* Por defecto solo escucha en esta máquina: /api/analizar gasta la cuota de
   tu clave de IA y no tiene sentido exponerlo a toda la red local. */
export const HOST = process.env.HOST || "127.0.0.1";

/* La SEC exige identificarse con un contacto. Cambialo si publicás esto con
   otro dueño. */
export const SEC_UA = process.env.SEC_UA || "market-desk/2.0 (teobotaya@gmail.com)";

export const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
