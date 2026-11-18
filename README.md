# Multi-verso Kin

Un plugin de [Kino](https://kinotvapp.github.io/kino-plugins/) para leer **manga, manhwa y novelas ligeras en español** de nueve fuentes:

| Fuente | Sitio | Qué da |
| --- | --- | --- |
| ZonaTMO | `zonatmo.net` | API JSON: recientes, lo más visto, mejor valorados, géneros, búsqueda |
| ZonaTMO.org | `zonatmo.org` | El mismo software que zonatmo.net (gemelo: si uno falla, prueba el otro) |
| ManhwaSS | `manhwass.lat` | Webtoon: últimas actualizaciones, en emisión, completados, búsqueda |
| ManhwaShot | `manhwashot.lat` | La misma aplicación que manhwass.lat (gemelo) |
| Skynovels | `skynovels.net` | API JSON: home por secciones, detalle, capítulos de texto, búsqueda |
| MatchaNovels | `matchanovels.com` | API pública: catálogo por orden y estado, detalle, capítulos de texto |
| Astral | `astralnovelstranslations.wordpress.com` | Site de WordPress.com: catálogo por página, detalle, capítulos |
| Anslid | `anslid.com` | Madara estándar: archivo por orden, búsqueda XHR, detalle, capítulos |
| DevilNovels | `devilnovels.com` | Madara estándar (ídem) |

Instalación en Kino: **Ajustes ▸ Plugins ▸ Agregar plugin** y pega `Lenoxlkz/multi-verso-kin`.

## Qué hace

- **Búsqueda global** en las fuentes de manga y novelas a la vez (con chips para filtrar por una fuente concreta).
- **Filas en el Home de Kino** y una sección propia «Multi-verso» con pestañas por fuente (manga) y cápsula de fuente para novelas.
- **Pantalla propia** (menú de Kino): portada con filas por fuente, búsqueda, detalle con la lista de capítulos, Biblioteca, ajustes.
- **Lector propio**: manga japonés (RTL) a páginas volteadas con barra de progreso; webtoon en tira vertical con zoom; novelas como párrafos de texto en lista perezosa con progreso por scroll. Botones de capítulo anterior y siguiente.
- **Seguir leyendo**: guarda en qué capítulo y página quedaste (kino.progress, Kino 0.9.83+) y muestra la fila «Seguir leyendo» en el Home y en la portada del plugin.
- **Biblioteca**: «Me Gustas» y «Etiquetados» con las etiquetas Leyendo / Por leer / Pendiente / Terminado, desde el detalle de cada título.
- **Cuentas (opcional)**: el plugin funciona sin cuenta. Para entrar, lo cómodo es **«Entrar con ventana»**: Kino abre la web del sitio, inicias sesión tú, y Kino guarda el token (ZonaTMO, del localStorage `auth:tokens`) o las cookies (Manhwa) en ajustes de tipo contraseña; el plugin nunca ve esos valores.
- **Desafíos de Cloudflare**: si una fuente responde con un desafío interactivo, el Home y el detalle ofrecen la **ventana embebida del sitio** (navegador visual de Kino) para resolverlo una vez; la sesión queda ligada al User-Agent interno del plugin.
- **Temas de toda la app**: cuatro temas (uno por fuente de manga), con un botón para ponerlos desde la pestaña de ajustes del plugin.
- **Compartir**: botón en la barra y en el detalle (teléfono), con la tarjeta del título.
- **Solo catálogo** (`catalogOnly`): el plugin no reproduce video y Kino nunca lo pide como fuente de reproducción.

## Novedades v2.8

- **SkyNovels: imágenes recuperadas** (causa raíz del blanco en Home y detalle): la API movió las imágenes y la ruta vieja `api.skynovels.net/img/{archivo}` devuelve 404. La web las sirve ahora en `/v1/media/novels/thumbs/{archivo}` (tarjetas, ~10 KB) y `/v1/media/novels/{archivo}` (full, para el detalle). El adaptador usa cada una donde toca y codifica el nombre del archivo. Verificado con respuestas reales: la portada de la referencia `/novelas/925/otro-dia-que-voy-a-morir` responde 200.
- **SkyNovels: Home con las secciones nuevas de la API**: las claves `trendingViews`, `weeklyViews`, `monthlyViews` y `views` desaparecieron de `/v1/home`; ahora son `trending`, `weekly_views`, `monthly_views` y `most_viewed` (y llegaron `featured` y `rising`). Antes solo sobrevivían 4 de las 8 filas; ahora hay 10 filas con 73 tarjetas usando datos reales.
- Detalle, capítulos y texto de capítulo sin cambios: la API conserva el formato (`content.paragraphs`).
- Nota: la API de Skynovels desafía por huella de cliente TLS (Cloudflare «Just a moment»); el plugin mantiene el flujo de ventana embebida por si algún dispositivo llegara a ser desafiado.

## Novedades v2.7

- **Legn Novels eliminada**: solo ofrecía enlaces de descarga, no contenido legible dentro del lector.
- **Anslid: portadas reales en el Home** (causa raíz de las imágenes en blanco): las tarjetas Madara usan lazy-load (`src` = placeholder `dflazy.jpg`, `data-src` = portada real); el adaptador tomaba el placeholder primero. Ahora elige la primera URL que no sea placeholder. Verificado en vivo: 70 portadas reales, 0 placeholders. La pantalla individual no cambió (ya funcionaba).
- **ZonaTMO.org y DevilNovels**: ambos hosts responden con el desafío JS de Cloudflare («used Cloudflare to restrict access» / «Attention Required»). El detector lo reconoce desde las respuestas que ya llegaron (registro HTTP por host, sin peticiones extra) y el Home ofrece la ventana embebida para resolverlo una vez.
- **Referer opcional por fuente**: el User-Agent interno va SIEMPRE (prioritario); el `Referer` solo donde el host lo exige (mapa `IMG_REFERER`, hoy: Astral/WordPress.com, el único con hotlink-check demostrado). Las cabeceras base no identifican la app como WebView (sin `X-Requested-With` global; solo en `admin-ajax`, donde WordPress lo exige).
- **Configuración HTTPS independiente por fuente**: cada host lleva su UA, su Referer (si lo pide) y su jarra de cookies de desafío; una corrección para uno no afecta a los demás.

## Novedades v2.6

- **Ventana embebida para el desafío de Cloudflare** (`cfAbrir`): el navegador visual de Kino abre el sitio con el UA interno del plugin, la persona completa el desafío una vez, y la fuente se recarga sola; `apiVersion` 20 en el manifiesto.
- **Jarra de cookies por host** en `fetchText`: la sesión del desafío se manda solo al host que la creó (coherente con la configuración HTTPS independiente por fuente).
- **`imgHeads` en todos los nodos de imagen**: el User-Agent interno y el `Referer` del propio host viajan con cada portada, ilustración y página del lector.
- **Detección de desafío** `isCfChallenge` (403/429/503 con sus marcas: «Just a moment», `challenge-platform`, «Checking your browser»…): el Home distingue la fuente desafiada de la fuente caída y ofrece el panel correspondiente.

## Novedades v2.5

- **Cápsula de fuente para novelas**: abre un panel con las fuentes disponibles, se cierra con un toque fuera o por temporizador de 5 s, y al elegir una el Home trae sus secciones nativas.
- **Lecturas recientes** bajo la cápsula, con historial borrable.
- **Lector de novelas perezoso**: `ListView` (solo los párrafos visibles) y progreso guardado por scroll.
- **Caché de la lista de capítulos**: una sola petición por novela y ventana, expiración antes del recorte por número.
- **«Fuente caída» vs «sin datos»**: mensajes distintos y reintento que vuelve a llamar a la fuente exacta que falló.

## Novedades v2.4

- **Seis fuentes de novelas ligeras** (Skynovels, MatchaNovels, Astral, Anslid, DevilNovels y LegnNovels) con el mismo `parseRef` de refs y búsqueda por filtro.
- **Barra Inicio / Biblioteca / Ajustes** con la sección activa marcada según la ruta real.
- **Biblioteca**: «Me Gustas» y «Etiquetados» con las etiquetas Leyendo / Por leer / Pendiente / Terminado.
- **Detalle con Me Gusta y Agregar a Biblioteca** (y quitar), coherente con la Biblioteca.
- **Lector de novelas**: capítulos como párrafos de texto (formato `content.paragraphs` de la API).

## Novedades v2.3

- **«Leer archivos locales» retirado por completo** (vista, ruta, eventos y capacidad `files` del manifiesto): la app es de lectura online. El primer arranque también purga su clave vieja del storage.
- **Filtros de búsqueda**: chips «Todas» o una fuente concreta (ZonaTMO/ZonaTMO.org/ManhwaSS/ManhwaShot). Cambiar el filtro con texto en el campo repite la búsqueda al momento; solo la fuente elegida = respuesta más rápida.
- **«Abrir en el navegador»** en el detalle: abre la ficha del manga en la web de la fuente (Kino muestra su propia hoja de confirmación; en TV, un QR).
- **Regreso del lector arreglado**: se quitó el botón «Salir del capítulo» y todo enlace profundo («Seguir leyendo») abre ahora el DETALLE del manga. El lector solo se apila desde el detalle, así que el botón de atrás lleva siempre a la ficha del manga, nunca al Home.
- Optimización: menos código (67 KB), sin capacidades muertas, búsqueda por fuente sin tráfico de las otras.

## Novedades v2.2

- **La descarga de capítulos se retiró por completo** (motor, cola, tics, ruta y botones): no era sostenible con los límites de la plataforma (2 MB por árbol, cuota de storage). Al abrir el plugin se purgan los restos viejos de storage y se libera la cuota.
- **Lector en inmersión**: sin barra de navegación; conserva anterior/siguiente y el capítulo actual.
- **Tema «Modo Oscuro AMOLED»** (negro puro) entre los 8 temas.
- **Descripciones con «Ver más»/«Ver menos»** cuando la sinopsis es larga.
- **Capítulos de pago**: detección por texto/clase de la fila, aviso de cuántos hay y ajuste «Ocultar capítulos de pago» para esconderlos. Es mejor esfuerzo: se activa solo cuando una fuente lo marca.
- **Cero trabajo de fondo**: sin temporizadores, cada toque se atiende al instante.

## Novedades v2.1

- **Barra con sección Inicio**: Inicio / Ajustes, con la sección activa marcada según la ruta de verdad.
- **Temas de la app aplicados dentro del plugin**: el tema que elijas tiñe también estas páginas.

## Novedades v2

- **Velocidad**: caché local de portada, detalle, capítulos y búsquedas (la segunda visita pinta al instante), cargas en paralelo y plazo corto para los dominios gemelos para que no frenen nada.
- **Salida real**: Atrás del sistema y el botón ‹ de la barra desapilan (y en la portada cierran); ninguna ruta queda atrapada.
- **Colores por defecto**: el violeta de Multi-verso tiñe las páginas del plugin sin configurar nada; 8 temas de toda la app con botón para ponerlos.
- **Barra de navegación inferior** y **botón flotante de búsqueda** a la derecha: al bajar el contenido se esconden y al subir vuelven.

## Requisitos de versión

- `apiVersion` 20 → necesita una versión de Kino reciente (0.9.84 o más nueva; trae el navegador visual que usa la ventana del desafío).
- `storageLarge` (16 MB de storage) para la caché y el estado.
- `progress` (seguir leyendo) → Kino 0.9.83+; en versiones anteriores el plugin sigue funcionando y guarda el punto de lectura por su cuenta.

## Desarrollo

El código vive en `src/` (`src/plugin.js` solo reexporta); `npm run build` lo empaqueta en `plugin.js`, el único archivo que instala Kino. `plugin.js` se sube al repositorio y nunca se edita a mano.

```
npm install                # esbuild
npm run build              # src/ -> plugin.js
npm run check:built        # plugin.js es exactamente lo que src/ construye
node sdk/validate.mjs .    # el manifiesto, las exportaciones y las líneas de consentimiento
node sdk/run.mjs . screen  # la portada, como la dibuja Kino (añade --device tv)
npm test                   # tests offline contra test/fixtures.json
```

### Firma del autor

```
node sdk/seal.mjs --keygen                     # una vez: escribe kino-author-key.pem (NUNCA al repositorio)
node sdk/seal.mjs --sign --repo Lenoxlkz/multi-verso-kin
node sdk/validate.mjs . --repo Lenoxlkz/multi-verso-kin
```

Firma de nuevo después de cualquier cambio en `plugin.js` o en `version`: `validate` falla hasta que lo hagas. Si pierdes la clave, quien ya lo instaló tendría que desinstalarlo y volver a instalarlo.

## Fuentes: cómo las lee el plugin

- **ZonaTMO** (`zonatmo.js`): API JSON propia del sitio (`/wp-api/api/...`): `listing/manga` con `orderBy`/`search`/`genres`, `tops/views/yesterday`, `single/manga/{slug}`, `single/manga/{slug}/chapters`, `single/manga/{slug}/{capitulo}` (el `jit` de cada capítulo arma la ruta de página en `cdn.zonatmo.to`). Las imágenes no piden Referer.
- **ManhwaShot** (`manhwa.js`): búsqueda JSON (`/api/search/?q=`) y el resto del HTML renderizado del sitio Next.js (tarjetas `.s-card`, capítulos `.ch-row`, imágenes del lector `img/WP-manga/`). Tiene un parser de respaldo por regex para entornos sin el selector HTML de Kino (el kit de Node).
- **Skynovels** (`novels.js`): API JSON (`api.skynovels.net`): `/v1/home` por secciones (`featured`, `updated`, `trending`, `weekly_views`, `monthly_views`, `most_viewed`, `rising`, `top_rated`, `recent`, `finished`), `/v1/novels/{id}`, `/v1/novels/{id}/chapters`, `/v1/chapters/{id}` con `content.paragraphs`. Las imágenes viven en `/v1/media/novels/thumbs/{archivo}` (tarjetas) y `/v1/media/novels/{archivo}` (detalle).
- **MatchaNovels** (`novels.js`): API pública (`matchanovels.com/api/v1/public/novels`) por orden y estado; portadas `cover_image_url` absolutizadas.
- **Astral** (`novels.js`): WordPress.com (público + Jetpack para imágenes): catálogo por página, detalle, capítulos por `content`. Sus imágenes **sí** exigen `Referer` del propio host (mapa `IMG_REFERER`).
- **Anslid y DevilNovels** (`novels.js`): Madara estándar: archivo `/novela/?m_orderby=`, búsqueda XHR `wp-manga-search-manga`, detalle con `data-src` de portada (lazy-load: nunca el placeholder `dflazy.jpg`), capítulos `/ajax/chapters/`.

Si un sitio cambia su interfaz, el primer lugar que hay que revisar son esas rutas y selectores.
