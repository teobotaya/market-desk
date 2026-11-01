# Market Desk

Mesa de análisis local para analistas de mercado. Junta precios, técnico, fundamentales de la SEC,
consenso de analistas, insiders, macro global y el mercado argentino (dólares, riesgo país,
inflación, REM, tasas, letras, bonos CER y paneles de BYMA) en una sola interfaz, calcula las
métricas en tu máquina y arma dossieres listos para analizar con un modelo de IA.

**No necesita ninguna clave de API para funcionar** y no tiene dependencias: solo Node.

> Herramienta de análisis. **No emite recomendaciones de compra o venta ni constituye
> asesoramiento financiero.** Los precios tienen demora (15 a 20 minutos en Yahoo, cierre diario
> en otras fuentes).

## Inicio rápido

```bash
npm start
```

Abrí la dirección que muestra la consola (<http://127.0.0.1:5173>). Requiere Node 18 o superior
(recomendado 20+).

Opcional: para analizar con IA sin copiar y pegar, copiá `.env.example` como `.env` y pegá una
clave gratuita (Gemini, Groq u OpenRouter). Ver [Análisis con IA](#análisis-con-ia).

## Qué hay en cada sección

| Sección | Qué muestra |
|---|---|
| **Resumen de mercado** | Índices, tasas del Tesoro, monedas, materias primas (incluye soja, maíz y trigo) y cripto con variación del día, mes y año; rotación sectorial con los ETFs SPDR; Fear & Greed de CNN; curva de tasas de EE.UU. y spreads de crédito (FRED). Brief de mercado para IA. |
| **Argentina** | *Dólar y macro*: oficial, MEP, CCL, blue, mayorista, cripto y tarjeta con brecha, canje y variaciones; historia del dólar; riesgo país; inflación mensual, interanual y acumulada; expectativas del REM del BCRA; variables del BCRA. *Tasas y renta fija*: plazo fijo por banco, cauciones, FCI money market, letras (TNA/TEA/TEM) y bonos CER (TIR real) con sus curvas, dólar MEP y CCL implícito por bono. *Panel BYMA*: Merval líder, panel general, CEDEARs, bonos, ONs, letras y ADRs. |
| **Calendario** | Balances de los próximos días (empresas grandes y las de tu watchlist) y calendario económico mundial. |
| **Cotización y técnico** | Gráfico con línea o velas, SMA 20/50/200, Bollinger, RSI, volumen, rangos de 1 mes a 10 años y comparación contra otro activo. RSI, MACD, %B, cruces de medias, volatilidad, ATR, rango de 52 semanas, volumen relativo y dividendo. Lectura de los indicadores en lenguaje llano. |
| **Fundamentales** | Estados de la SEC: últimos 12 meses, 6 ejercicios y 8 trimestres. Márgenes, ROIC, FCF, conversión, deuda, remuneración en acciones, recompras. Valuación con el precio de hoy (PER, P/V, EV/EBITDA, EV/EBIT, P/libro, rentabilidad del FCF). Consenso de analistas: precio objetivo, recomendaciones, estimaciones, revisiones, sorpresas y cambios de calificación. |
| **Valuación y comparables** | PER histórico sin mirar el futuro, percentil contra su propia historia y tabla de comparables (PER, P/V, EV/EBITDA, márgenes, crecimiento, ROIC). Sugiere pares; vos decidís cuáles. |
| **Perfil de riesgo** | Retorno, CAGR, Sharpe, Sortino, Calmar, volatilidad, beta, VaR y CVaR, caídas máximas, gráfico de caídas desde máximos, volatilidad móvil y volatilidad implícita de opciones con su percentil. |
| **Mis criterios** | Tus umbrales (quedan guardados) evaluados contra el activo, con frecuencia histórica por horizonte de tenencia. |
| **SEC** | Factores de riesgo del último 10-K o 20-F **comparados con el del año anterior** (riesgos nuevos y eliminados), presentaciones recientes con los hechos relevantes críticos marcados, y compras y ventas de directivos (formulario 4), separando ventas planificadas 10b5-1. |
| **Noticias y sentimiento** | Titulares de Google News en español o inglés con puntuación léxica, por día y por medio. |
| **Análisis con IA** | Red team de una tesis, análisis de una earnings call pegada y estrés del foso competitivo contra un rival, con márgenes, ROIC e I+D de ambos. |
| **TradingView** | Gráfico avanzado, resumen técnico, estados financieros, mapa de calor del S&P 500 y screener. |
| **Fuentes y claves** | Estado de cada fuente en la sesión, proveedores de IA configurados y cómo sumar claves. |

Además: **buscador** con autocompletado (tecla `/`), **watchlist** lateral con variación y
minigráfico (☆ junto al nombre para agregar), **tema claro y oscuro**, **exportación a CSV**
(separador `;` y coma decimal, como lo abre Excel en español) y direcciones que guardan vista y
ticker (`#/fundamentales?t=MSFT`).

### Formatos de ticker

| Escribí | Para |
|---|---|
| `NVDA`, `BRK.B` | Acciones de EE.UU. |
| `GGAL.BA`, `YPFD.BA`, `AL30.BA` | BYMA en pesos (acciones, CEDEARs, bonos). Un ticker local sin sufijo (`YPFD`) también se encuentra. |
| `^GSPC`, `^MERV`, `^VIX` o `S&P 500`, `Merval` | Índices |
| `BTC-USD`, `EURUSD=X`, `GC=F`, `VALE3.SA` | Cripto, monedas, futuros y otras bolsas |

Para activos en pesos, el botón **USD CCL** convierte toda la serie dividiendo cada día por el
dólar contado con liquidación de ese día: es la forma de ver si una acción argentina ganó en
dólares o solo acompañó la devaluación. Perfil de riesgo y criterios respetan esa elección.

## Fuentes de datos

Todas gratuitas. Las de la tabla funcionan **sin clave**.

| Fuente | Qué aporta |
|---|---|
| [Yahoo Finance](https://finance.yahoo.com) | Precios diarios (EE.UU., BYMA, índices, monedas, futuros, cripto), dividendos y splits, buscador, consenso de analistas, estimaciones y pares sugeridos |
| [Nasdaq](https://www.nasdaq.com) | Precios de respaldo y calendario de balances |
| [Stooq](https://stooq.com) | Precios de respaldo |
| [SEC EDGAR](https://www.sec.gov/edgar) | Estados financieros XBRL (US GAAP e IFRS), 10-K/20-F, presentaciones, formularios 4 |
| [FRED](https://fred.stlouisfed.org) | Tasas del Tesoro, curva, tasas reales, inflación implícita, spreads de crédito (CSV público, sin clave) |
| [CNN Fear & Greed](https://edition.cnn.com/markets/fear-and-greed) | Índice de miedo y codicia |
| [Google News](https://news.google.com) | Titulares (RSS) |
| [DolarApi](https://dolarapi.com) | Dólares argentinos en vivo |
| [ArgentinaDatos](https://argentinadatos.com) | Historia del dólar, riesgo país, inflación, REM, plazo fijo, cauciones, FCI, letras y bonos CER |
| [data912](https://data912.com) | Paneles de BYMA, dólar implícito por bono, historia de bonos, volatilidad implícita de opciones |
| [BCRA](https://www.bcra.gob.ar/apis-banco-central/) | Variables monetarias oficiales (API v4) |
| [TradingView](https://www.tradingview.com/widget-docs/) | Widgets embebidos (se cargan en tu navegador) |

Opcional con clave gratuita: **[Finnhub](https://finnhub.io)** (`FINNHUB_API_KEY`) como respaldo
de recomendaciones, sorpresas de ganancias, pares de industria y métricas cuando Yahoo no responde.

Si una fuente cae, la app lo dice en la tarjeta correspondiente y el resto sigue funcionando. Los
precios pasan por una cadena Yahoo → Nasdaq → Stooq (y data912 para BYMA).

### Herramientas pagas que se usan gratis

- **Consenso de analistas** (precio objetivo, recomendaciones, estimaciones, revisiones, sorpresas,
  cambios de calificación): la pantalla de estimaciones de las terminales pagas, vía Yahoo.
- **Volatilidad implícita y su percentil** ("IV rank"): de las plataformas pagas de opciones, vía data912.
- **Seguimiento de insiders** y **alertas de hechos relevantes** (8-K): directo de la SEC.
- **Comparación de factores de riesgo año contra año**: típica de servicios de research pagos.
- **Gráfico avanzado, mapa de calor, screener y estados de TradingView**: widgets gratuitos oficiales.
- **Modelos de IA**: capas gratuitas de Gemini, Groq, OpenRouter, Cerebras y Mistral, o Ollama local.

## Análisis con IA

Cada sección termina con un dossier: los datos ya estructurados y un prompt escrito para que el
modelo busque lo que contradice la lectura, no lo que la confirma. Siempre podés copiar el prompt y
pegarlo donde quieras. Con una clave en `.env`, se analiza desde la app y la respuesta se muestra
formateada.

| Proveedor | Costo | Variable |
|---|---|---|
| [Gemini](https://aistudio.google.com/apikey) | gratis con límites | `GEMINI_API_KEY` |
| [Groq](https://console.groq.com/keys) | gratis con límites | `GROQ_API_KEY` |
| [OpenRouter](https://openrouter.ai/keys) | gratis (modelos `:free`) | `OPENROUTER_API_KEY` |
| [Cerebras](https://cloud.cerebras.ai) | gratis con límites | `CEREBRAS_API_KEY` |
| [Mistral](https://console.mistral.ai/api-keys) | gratis (plan Experiment) | `MISTRAL_API_KEY` |
| [Ollama](https://ollama.com) | gratis, local | `OLLAMA_MODEL` |
| Anthropic (Claude) | de pago | `ANTHROPIC_API_KEY` |
| OpenAI | de pago | `OPENAI_API_KEY` |

El modelo se elige solo consultando la lista de cada proveedor (o lo fijás con `GROQ_MODEL`,
`GEMINI_MODEL`, etc.). Con varias claves, elegís el proveedor en cada análisis; `IA_PROVEEDOR` fija
el de defecto. **Ojo:** varios planes gratuitos usan lo que les mandás para entrenar; no pegues
información confidencial de clientes.

## Cómo se calcula lo que no es obvio

- **Últimos 12 meses (TTM)**: suma de los últimos cuatro trimestres. Los 10-Q informan el flujo de
  fondos acumulado (3, 6, 9 meses): cada trimestre se reconstruye restando acumulados, y el cuarto
  sale del anual menos los tres anteriores.
- **Splits**: la SEC guarda el beneficio por acción tal como se presentó. Si hubo un split después,
  se ajusta antes de cualquier cuenta; si no, un PER histórico mostraría saltos falsos.
- **PER histórico sin mirar el futuro**: cada rueda usa el beneficio que ya era público ese día
  (la primera fecha de presentación), no el que se conoció después.
- **ADRs y CEDEARs**: `YPFD.BA` busca los estados del ADR `YPF`; `AAPL.BA` los de `AAPL`, y la
  valuación usa el precio en EE.UU. para no mezclar monedas. Para emisores extranjeros (20-F) se
  avisa que la relación ADR/acciones puede distorsionar los múltiplos.
- **Curvas de letras y CER**: se excluyen del gráfico los vencimientos de menos de 20 días y las
  tasas atípicas (por ejemplo, instrumentos que no son de tasa fija); quedan en gris en la tabla.
- **ROIC**: resultado operativo después de impuestos sobre patrimonio + deuda − caja. Es una
  aproximación, no la definición contable.
- **Sharpe**: sin tasa libre de riesgo. **Sortino**: con semidesvío (solo caídas).

## Seguridad y privacidad

- El servidor escucha solo en `127.0.0.1`; `HOST=0.0.0.0` lo abre a tu red (y tu clave de IA con él).
- Las claves se leen de `.env` (cubierto por `.gitignore`) y nunca llegan al navegador.
- Bloquea pedidos desde otros dominios (protección contra *DNS rebinding*) y exige JSON en
  `/api/analizar`, así otra página no puede gastar tu cuota de IA.
- Política de seguridad de contenido: el navegador solo carga código propio y los widgets de TradingView.

## Limitaciones

- **No es tiempo real.** Yahoo tiene 15 a 20 minutos de demora; data912 y ArgentinaDatos, más.
- **Los léxicos (noticias, earnings call, riesgos del 10-K) son reglas**: ordenan la lectura, no la reemplazan.
- **Las fuentes no oficiales pueden cambiar** sin aviso (Yahoo, Nasdaq, CNN). La sección *Fuentes y
  claves* muestra cuál falla.
- **No decide por vos.** Arma el expediente; el juicio es tuyo.

## Desarrollo

```bash
npm test     # 30+ tests sin red: cálculos, parsers, XBRL y todas las rutas de la API
npm run dev  # reinicia el servidor al guardar
```

Los tests usan un `fetch` falso (`test/fake-fetch.mjs`): Argentina con datos reales recortados de
ArgentinaDatos y DolarApi, y series sintéticas rotuladas para el resto.

```
market-desk
├── server.mjs            rutas, archivos estáticos y cabeceras de seguridad
├── lib/
│   ├── config.mjs        lectura de .env y parámetros
│   ├── http.mjs          fetch con timeout, cache, concurrencia y salud por fuente
│   ├── indicadores.mjs   técnico, estadísticas y perfil de riesgo (funciones puras)
│   ├── precios.mjs       cadena de precios, buscador y consenso (Yahoo, Nasdaq, Stooq, data912)
│   ├── sec.mjs           XBRL, TTM, PER, comparables, 10-K, filings e insiders
│   ├── argentina.mjs     dólar, riesgo país, inflación, REM, tasas, renta fija, BYMA, BCRA
│   ├── mercado.mjs       tablero global, sectores, FRED, Fear & Greed, calendario
│   ├── noticias.mjs      Google News y léxico bilingüe
│   ├── extras.mjs        volatilidad implícita y Finnhub
│   └── ia.mjs            proveedores de IA
├── public/
│   ├── index.html
│   ├── css/app.css
│   └── js/               main.js (enrutador, buscador, watchlist), util, charts, dossier y views/
└── test/                 node:test + fetch falso + fixtures
```

## Licencia

MIT — Teo Matías Botaya
