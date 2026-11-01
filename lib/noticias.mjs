import { cached, getText } from "./http.mjs";

/* Léxico bilingüe. La versión anterior solo tenía palabras en inglés, pero la
   búsqueda se hace en español (Google News Argentina), así que la mayoría de
   los titulares quedaban en cero. Las raíces cubren las conjugaciones
   ("sube", "subió", "suben"). */
const POS_EN = "beat beats upgrade upgraded record surge surges rally rallies jumps jump soars soar strong growth outperform raises raised bullish expansion partnership wins approval approved breakthrough optimistic momentum gains gain rebound rebounds tops exceeds boost boosts".split(" ");
const NEG_EN = "miss misses downgrade downgraded cuts cut plunge plunges slump slumps falls fall sinks sink weak warning warns lawsuit probe investigation recall delay delays shortage layoffs bearish loss losses decline declines halt ban restriction tariff tariffs default crash tumbles tumble selloff fears".split(" ");
const POS_ES = ["sube", "suben", "subi", "suba", "alza", "récord", "repunt", "rebot", "dispar", "gana", "ganó", "crec", "mejor", "supera", "superó", "superáv", "avanz", "optimis", "aprob", "impuls", "recuper", "vuela", "trepa", "trepó", "positiv"];
const NEG_ES = ["baja", "bajan", "bajó", "caíd", "cae", "caen", "cayó", "cayeron", "desplom", "hund", "pierd", "perdió", "pérdid", "recort", "rebaj", "demanda judicial", "investigac", "multa", "default", "crisis", "alerta", "temor", "miedo", "debilit", "retroce", "derrumb", "negativ", "prohib", "prohíb", "arancel", "despid", "suspend", "cesación"];

export function scoreHeadline(t) {
  const txt = String(t).toLowerCase();
  const palabras = txt.replace(/[^a-záéíóúñü ]/g, " ").split(/\s+/).filter(Boolean);
  let s = 0;
  for (const w of palabras) {
    if (POS_EN.includes(w)) s++;
    if (NEG_EN.includes(w)) s--;
  }
  for (const w of palabras) {
    if (w.length < 3) continue;
    if (POS_ES.some((r) => w.startsWith(r))) s++;
    else if (NEG_ES.some((r) => !r.includes(" ") && w.startsWith(r))) s--;
  }
  for (const frase of NEG_ES.filter((r) => r.includes(" "))) if (txt.includes(frase)) s--;
  return Math.max(-3, Math.min(3, s));
}

export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const b = m[1];
    const pick = (tag) => {
      const r = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return r ? r[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").trim() : "";
    };
    const fuente = pick("source");
    /* Google agrega " - Medio" al final del título: lo sacamos para puntuar. */
    let title = pick("title");
    if (fuente && title.endsWith(` - ${fuente}`)) title = title.slice(0, -(fuente.length + 3));
    const fecha = new Date(pick("pubDate"));
    return { title, link: pick("link"), source: fuente, date: isNaN(fecha) ? null : fecha.toISOString(), score: scoreHeadline(title) };
  });
}

const IDIOMAS = {
  es: "hl=es-419&gl=AR&ceid=AR:es-419",
  en: "hl=en-US&gl=US&ceid=US:en"
};

export async function news(query, days, idioma = "es") {
  const q = String(query || "").trim();
  if (!q) throw new Error("Escribí qué buscar");
  const cfg = IDIOMAS[idioma] || IDIOMAS.es;
  return cached(`news:${idioma}:${days}:${q}`, 10 * 60e3, async () => {
    const xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${days}d`)}&${cfg}`);
    const vistos = new Set();
    const items = parseRss(xml).filter((i) => {
      const k = i.title.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, "").slice(0, 70);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    }).slice(0, 80);
    const pos = items.filter((i) => i.score > 0).length;
    const neg = items.filter((i) => i.score < 0).length;
    const byDay = new Map();
    for (const i of items) {
      if (!i.date) continue;
      const key = i.date.slice(0, 10);
      const e = byDay.get(key) || { day: key, n: 0, score: 0 };
      e.n++; e.score += i.score;
      byDay.set(key, e);
    }
    const medios = new Map();
    for (const i of items) medios.set(i.source, (medios.get(i.source) || 0) + 1);
    return {
      query: q, days, idioma, items,
      summary: { total: items.length, pos, neg, neutral: items.length - pos - neg, net: pos - neg },
      timeline: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      medios: [...medios.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, n]) => ({ medio: m || "—", n }))
    };
  });
}
