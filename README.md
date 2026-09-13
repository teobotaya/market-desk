# Market Desk

Mesa de análisis local para operativa de corto plazo. Reúne datos públicos de tres fuentes
**sin ninguna clave de API**, calcula las métricas cuantitativas en tu máquina y arma dossieres
listos para pasarle a un modelo de lenguaje.

> Herramienta de análisis. **No emite recomendaciones de compra o venta ni constituye
> asesoramiento financiero.** Los precios son de cierre diario, no en tiempo real.

## Por qué no lleva claves

Es publicable tal cual: no hay secretos que filtrar. La parte cuantitativa —retornos,
volatilidad, ATR, medias, drawdown, volumen relativo, clasificación de riesgos del 10-K,
puntuación de titulares— corre entera en tu máquina. La parte cualitativa no se resuelve con
una clave incrustada en el código, sino con un **dossier**: la app junta los datos, los
estructura y genera el prompt con un botón de copiar. Vos lo pegás en el modelo que prefieras.

Una clave de API en un repositorio público es una clave comprometida, y en una app de frontend
queda expuesta al usuario aunque el repo sea privado. Este diseño evita las dos cosas.

## Fuentes

| Dato | Fuente | Clave |
|---|---|---|
| Precios diarios (OHLCV) | Stooq | no |
| Factores de riesgo (Item 1A del 10-K) | SEC EDGAR | no |
| Noticias de las últimas semanas | Google News RSS | no |
| Transcripción de earnings call | la pegás vos | — |

Las transcripciones no tienen fuente libre: se pegan en la pestaña correspondiente y el análisis
léxico corre en el navegador.

## Uso

```bash
npm run dev      # http://localhost:5173
```

Node 18 o superior. Sin dependencias: usa `fetch` y el `http` del propio Node.

El servidor actúa de proxy porque esas tres fuentes no admiten peticiones desde el navegador
(CORS). También identifica la app ante la SEC, que exige un `User-Agent` con contacto: si
publicás esto con otro dueño, cambiá el mail con la variable de entorno `SEC_UA`.

## Las seis pestañas

**Panel** — cierre, retornos a 1/5/21/63/252 ruedas, volatilidad anualizada, ATR(14) para
dimensionar el stop, posición frente a SMA 20/50/200, rango de 52 semanas, drawdown máximo del
año y volumen relativo. Gráfico de las últimas 180 ruedas.

**Tesis** — escribís tu tesis y la app arma un prompt de *red team*: qué supuestos implícitos
tiene, por dónde se rompe, qué riesgos de sector ignora y qué dato de los que ya tenés la
contradice.

**Earnings call** — pegás la transcripción. El análisis local separa las frases con lenguaje
prospectivo, puntúa el tono, marca las tres citas más negativas y estima la dirección de la guía.
El prompt pide profundizar: eufemismos, preguntas esquivadas, divergencia entre discurso y números.

**Foso competitivo** — compara la empresa contra un competidor en los tres ejes que sostienen un
foso: poder de fijación de precios, costes de cambio y propiedad intelectual, más dónde se está
acortando la distancia y qué métrica lo delataría primero.

**Sentimiento** — titulares de las últimas 1 a 4 semanas con puntuación léxica, recuento
positivo/negativo y volumen de noticias por día.

**Riesgos 10-K** — baja el último 10-K, aísla el Item 1A y separa los riesgos específicos de la
empresa (concentración de clientes, proveedor único, exposición geográfica, controles de
exportación) del boilerplate que aparece en todos los informes.

## Lo que esta herramienta no hace

- **No da precios en tiempo real.** Stooq publica cierres diarios. Para intradía hace falta una
  fuente con clave.
- **El lexicón de sentimiento es tonto.** Cuenta palabras: no entiende ironía, negación ni si la
  noticia ya estaba descontada. Es un ordenador de la lectura, no una conclusión.
- **La clasificación de riesgos es por reglas** y se equivoca en los dos sentidos. Sirve para
  decidir qué leer primero.
- **No decide por vos.** Arma el expediente; el juicio es tuyo.

## Estructura

```
market-desk
├── server.mjs        proxy, parseo y cálculo (sin dependencias)
└── public
    ├── index.html    interfaz y estilos
    └── app.js        render, análisis de transcripción y generación de dossieres
```

## Licencia

MIT — Teo Matías Botaya
