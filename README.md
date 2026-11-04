# Market Desk

Mesa de análisis local para analistas de mercado. Junta precios, técnico, fundamentales de la SEC,
consenso de analistas, insiders, macro global y el mercado argentino (dólares, riesgo país,
inflación, REM, bonos y ONs en dólares, tasa fija, CER, carry contra la banda y paneles de BYMA)
en una sola interfaz, administra las carteras de tus clientes con su perfil de la CNV, calcula
las métricas en tu máquina y arma dossieres listos para analizar con un modelo de IA.

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
| **Argentina** | *Dólar y macro*: oficial, MEP, CCL, blue, mayorista, cripto y tarjeta con brecha, canje y variaciones; historia del dólar; riesgo país; inflación mensual, interanual y acumulada; expectativas del REM del BCRA; variables del BCRA. *Bonos en dólares* (al estilo de las plataformas pagas de renta fija): AL29 a GD46 con TIR, duration, duration modificada, convexidad, PVBP, valor residual, interés corrido, valor técnico, paridad y próximo pago; curva por legislación; diferencia ley local contra Nueva York; ficha con cronograma completo y TIR histórica; calculadora precio ↔ TIR; arbitraje entre dos bonos. Además, Bonares 2027–2029 y BOPREAL con TIR y duration, escenarios de tasa en la ficha (precio exacto con ±50 a ±300 pb) y metodología de cada cálculo. *Obligaciones negociables*: 49 ONs en dólares con TIR, duration y **spread contra la curva soberana** a igual duration, en tabla y gráfico. *Tasas y renta fija en pesos*: plazo fijo por banco, cauciones, FCI money market, **LECAP y BONCAP con TEM, TEA y TNA calculadas en la app** desde el pago final y **bonos CER con TIR real calculada en la app** con el CER del BCRA, con sus curvas, dólar MEP y CCL implícito por bono. *Breakevens y carry*: inflación implícita (tasa fija contra CER) comparada con el REM, distancia al techo y al piso de la banda cambiaria, y dólar de equilibrio de cada letra contra el techo proyectado. *CEDEARs*: MEP y CCL implícito en cada CEDEAR con su ratio, para ver cuáles están baratos o caros en pesos. *Panel BYMA*: Merval líder, panel general, CEDEARs, bonos, ONs, letras y ADRs. |
| **Calendario** | Balances de los próximos días hábiles con **buscador de empresa** (por defecto se ven las grandes y las de tu watchlist; el buscador recorre todas) y calendario económico mundial. |
| **Clientes** | Ficha de cada cliente con perfil de riesgo, horizonte y criterios propios. **Movimientos** (compras, ventas y rentas cobradas, a mano o importados desde un CSV de cualquier broker, con tipo de cambio propio opcional) de los que salen las tenencias a costo promedio, el resultado no realizado y el realizado. **Rendimiento** ponderado por tiempo (TWR, el que se compara con un índice) y ponderado por dinero (TIR de la cartera), en dólares y en pesos, separado en precio, rentas y efecto del dólar, contra el S&P 500, el Merval en dólares, el CCL y la inflación, con gráfico base 100 y tabla de rendimientos mensuales. **Agenda de cobros** de los próximos 12 meses (cupones, amortizaciones y vencimientos de bonos, ONs y letras) y DV01 de la renta fija. Riesgo de la cartera actual (volatilidad, caída máxima, VaR, CVaR, Sharpe), **aporte de cada posición al riesgo** y **escenarios de estrés** (S&P −20%, Merval −30%, tasas +200 pb, devaluación de 30%). **Cartera objetivo y rebalanceo** con banda de tolerancia. **Cuestionario de perfil del inversor** con el contenido mínimo de la CNV, vencimiento anual y perfil transaccional (UIF). **Informe para el cliente** imprimible o en PDF. **Alertas** cuando algo se sale de los criterios: concentración, pérdida máxima, volatilidad, liquidez, desvío del objetivo, perfil vencido o más agresivo que el que surge del cuestionario, y cobros de la semana. |
| **Armado de carteras** | Calculadoras de **CAPM** (con riesgo país opcional), **WACC**, **DCF** con tabla de sensibilidad, **VAN y TIR** (también con fechas, como XVAN y XTIR), **APT** multifactor con betas estimadas por regresión, y **optimización de cartera** (mínima volatilidad, máximo Sharpe, frontera y correlaciones). Los supuestos se precargan desde los datos reales del activo. |
| **Cotización y técnico** | Gráfico con línea o velas, SMA 20/50/200, Bollinger, RSI, volumen, rangos de 1 mes a 10 años y comparación contra otro activo. RSI, MACD, %B, cruces de medias, volatilidad, ATR, rango de 52 semanas, volumen relativo y dividendo. Lectura de los indicadores en lenguaje llano. |
| **Fundamentales** | **Estado de resultados, balance general y flujo de efectivo** completos (anual y trimestral, con análisis vertical y CSV). Estados de la SEC: últimos 12 meses, 6 ejercicios y 8 trimestres. Márgenes, ROIC, FCF, conversión, deuda, remuneración en acciones, recompras. Valuación con el precio de hoy (PER, P/V, EV/EBITDA, EV/EBIT, P/libro, rentabilidad del FCF). Consenso de analistas: precio objetivo, recomendaciones, estimaciones, revisiones, sorpresas y cambios de calificación. |
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
| [data912](https://data912.com) | Paneles de BYMA (precios de bonos, letras, ONs y CEDEARs para los cálculos propios), dólar implícito por bono, historia de bonos, volatilidad implícita de opciones |
| [BCRA](https://www.bcra.gob.ar/apis-banco-central/) | Variables monetarias oficiales y límites de la banda cambiaria (API v4, series 1187 y 1188) |
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
- **Tasa fija**: LECAP y BONCAP se calculan en la app con el precio de data912 y el pago final de las
  condiciones de emisión (`lib/instrumentos.mjs`): TEM = (pago / precio)^(30/días) − 1. Las letras que
  no están en esa tabla usan las tasas de ArgentinaDatos, marcadas. Una TEM imposible o un vencimiento
  de menos de 5 días quedan en gris y fuera de la curva. **Cuando se emite una letra, bono u ON nueva,
  hay que sumarla a `lib/instrumentos.mjs`.**
- **Bonos CER**: se calculan en la app. Coeficiente = CER del BCRA (serie 30) de 10 días hábiles antes de
  la liquidación / CER de emisión; la TIR real sale del precio dividido por ese coeficiente y los flujos de
  emisión (amortización + cupón sobre el residual). Los que no están en `lib/instrumentos.mjs` usan la TIR de
  ArgentinaDatos, marcada. La curva no mezcla fuentes y deja afuera los duales CER/TAMAR, los Discount y Par,
  los vencimientos de menos de 30 días y las TIR reales de más de 20%.
- **Inflación implícita**: (1 + TEA de la letra) / (1 + TIR real CER interpolada al mismo plazo) − 1.
- **Carry contra la banda**: dólar de equilibrio = mayorista × (1 + TEM)^(días/30). El techo de la banda
  se proyecta (hasta 18 meses) con la regla vigente desde enero de 2026: sube cada mes la inflación de
  dos meses antes (INDEC y, para los meses sin dato, la mediana mensual del REM).
- **Obligaciones negociables**: TIR de los flujos restantes con el precio de la especie D; spread contra
  la TIR de los Globales interpolada linealmente a la misma duration modificada.
- **Bonos en dólares**: cronogramas de las condiciones de emisión del canje de 2020 (pagos 9 de enero y 9
  de julio, cupones *step up* en base 30/360). TIR efectiva anual con base actual/365 y liquidación T+1,
  sobre precio sucio por cada 100 nominales originales. Paridad = precio / (valor residual + interés corrido).
- **Clientes**: el valor de hoy usa el CCL de hoy; el costo, el CCL del día de compra, así el resultado en
  dólares no se confunde con la devaluación. Costo promedio ponderado: una venta saca costo en proporción
  a lo vendido. En bonos, letras y ONs la cantidad va en nominales y el precio cada 100 nominales. En
  renta fija, el precio de hoy sale del panel de BYMA, y la moneda, de la especie (D o C, dólares; el
  resto, pesos). El riesgo se mide como si la cartera actual se hubiera tenido todo el último año.
- **TWR**: cada día se parte en dos tramos: lo que ya estaba, de cierre a cierre (ventas y rentas a su
  precio), y lo comprado ese día, desde su precio hasta el cierre. Se encadenan los días, así el resultado
  no depende de cuándo ni cuánto se invirtió. **TIR de la cartera**: XTIR de compras (negativas), ventas y
  rentas (positivas) y el valor de hoy. Las dos miden sobre lo invertido, sin el efectivo ocioso.
  **Descomposición**: el TWR sin las rentas es el rendimiento de precio; la diferencia, el de cupones y
  dividendos. El efecto del dólar es (1 + TWR en dólares) / (1 + TWR en pesos) − 1.
- **Tipo de cambio por movimiento**: opcional. Si se carga (por ejemplo, el MEP al que se compraron los
  dólares), reemplaza al CCL de esa fecha para ese movimiento.
- **Aporte al riesgo**: wᵢ·(Σw)ᵢ / wᵀΣw con la covarianza de los retornos diarios en dólares del último año.
- **Escenarios**: beta diaria de cada posición contra el S&P 500 y contra el Merval en dólares; en renta fija
  en dólares, −duration modificada × cambio de tasa. Son para dimensionar exposiciones, no pronósticos.
- **Cuestionario de perfil**: ocho preguntas de 0 a 3 puntos (experiencia, conocimiento, objetivo,
  patrimonio, ingresos y reserva, horizonte, pérdida tolerable y reacción ante una caída). Hasta 8 puntos,
  conservador; hasta 16, moderado; más, agresivo. Un horizonte de menos de 1 año o una pérdida tolerable de
  hasta 5% topean en conservador, y de 1 a 3 años o hasta 15%, en moderado. Vence a los 365 días; si el
  cliente opera después del vencimiento, aparece una alerta (la CNV pide revisarlo en la primera operación
  posterior). Cada versión anterior queda en el historial con su fecha.
- **APT**: regresión de los retornos semanales en dólares del activo contra los de cada factor. La prima
  de cada factor arranca en su retorno histórico menos la tasa libre de riesgo y conviene reemplazarla.
- **Optimización**: simulación de 5.000 carteras sin ventas en corto (pesos al azar) sobre dos años de
  retornos diarios en dólares. Es una aproximación de la frontera eficiente, y es del pasado.
- **ROIC**: resultado operativo después de impuestos sobre patrimonio + deuda − caja. Es una
  aproximación, no la definición contable.
- **Sharpe**: sin tasa libre de riesgo. **Sortino**: con semidesvío (solo caídas).

## Seguridad y privacidad

- **Los datos de clientes** se guardan en `datos/clientes.json`, en tu máquina. La carpeta está en el
  `.gitignore`: nunca se sube al repositorio. Los prompts de IA de clientes no incluyen nombre, contacto
  ni perfil transaccional. Los archivos de la versión anterior (con "posiciones") se convierten solos en
  movimientos de compra al leerlos.
- El servidor escucha solo en `127.0.0.1`; `HOST=0.0.0.0` lo abre a tu red (y tu clave de IA con él).
- Las claves se leen de `.env` (cubierto por `.gitignore`) y nunca llegan al navegador.
- Bloquea pedidos desde otros dominios (protección contra *DNS rebinding*) y exige JSON en
  `/api/analizar`, así otra página no puede gastar tu cuota de IA.
- Política de seguridad de contenido: el navegador solo carga código propio y los widgets de TradingView.

## Limitaciones

- **No es tiempo real.** Yahoo tiene 15 a 20 minutos de demora; data912 y ArgentinaDatos, más.
- **Los cronogramas de bonos, letras y ONs son datos cargados a mano** (`lib/bonos.mjs` y
  `lib/instrumentos.mjs`): conviene cotejarlos con el prospecto antes de usarlos con un cliente.
- **Impuestos**: la app no calcula Ganancias ni Bienes Personales. Los criterios cambian año a año y
  algunos están en discusión; el resultado realizado y la valuación al 31/12 sirven de base para el contador.
- **Los léxicos (noticias, earnings call, riesgos del 10-K) son reglas**: ordenan la lectura, no la reemplazan.
- **Las fuentes no oficiales pueden cambiar** sin aviso (Yahoo, Nasdaq, CNN). La sección *Fuentes y
  claves* muestra cuál falla.
- **No decide por vos.** Arma el expediente; el juicio es tuyo.

## Desarrollo

```bash
npm test     # 57 tests sin red: fórmulas, bonos, TWR y TIR, parsers, XBRL, clientes y todas las rutas de la API
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
│   ├── bonos.mjs         soberanos en dólares: cronogramas, TIR, duration, paridad
│   ├── instrumentos.mjs  condiciones de LECAP/BONCAP, Bonares nuevos, BOPREAL, ONs y ratios de CEDEARs
│   ├── rentafija.mjs     tasa fija, ONs, breakevens, carry contra la banda y CEDEARs
│   ├── movimientos.mjs   costo promedio, TWR, TIR de la cartera, rebalanceo y aporte al riesgo (puras)
│   ├── clientes.mjs      clientes, movimientos, agenda de cobros, alertas (datos en datos/, fuera de git)
│   ├── carteras.mjs      supuestos de CAPM/WACC/DCF, APT y optimización
│   ├── extras.mjs        volatilidad implícita y Finnhub
│   └── ia.mjs            proveedores de IA
├── public/
│   ├── index.html
│   ├── css/app.css
│   └── js/               main.js (enrutador, buscador, watchlist), util, charts, dossier,
│                         finanzas.js y perfil.js (fórmulas y cuestionario, compartidos con el
│                         servidor) y views/
└── test/                 node:test + fetch falso + fixtures
```

## Licencia

MIT — Teo Matías Botaya
