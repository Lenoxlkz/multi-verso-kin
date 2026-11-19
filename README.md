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
| DevilNovels | `devilnovels.com` | WordPress propio: novelas en la raíz del dominio, capítulos con id de post, listado y finalizadas |

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

## Novedades v2.16

**El motor de capítulos de DevilNovels pasa al AJAX REAL del sitio** (RCA con captura de DevTools del problema #19):

- **La lista de capítulos nunca estuvo en el HTML de la ficha**: el sitio la trae por POST a `admin-ajax.php` con `action=dv_load_chapters&cat_id=<id>&page=<n>&search=` y responde `{ success, data: { chapters, total, pages } }` de 100 en 100. Por eso las novelas de 3.000+ capítulos mostraban solo 2. Ahora el plugin hace el mismo XHR: el `cat_id` sale de los data-attributes de la propia ficha (con marcadores de respaldo) y los capítulos con candado se marcan con el `LOCKED_IDS` que el tema guarda en la página.
- **Mapeo tolerante del capítulo**: la fila del AJAX puede traer la URL o el par slug+id — ambas formas dan el mismo slug interno `<cap>.<id>` y el número extraído del slug.
- **El servidor entrega la lista ASCENDENTE**: la última página AJAX es la de los capítulos más nuevos, y de ahí salen los vecinos Anterior/Siguiente del lector (1-2 peticiones, sin recorrer la obra; si el AJAX cae, la REST de WordPress y los extremos de la ficha siguen de respaldo).
- **El botón «Cargar más de la fuente» muestra el avance** («50 de 3.249») desde la primera respuesta, que ya trae el total real.
- La REST de WordPress (`wp-json/wp/v2/pages?parent=`) queda como plan B, y la paginación y las filas de la ficha como planes C/D — cuatro vías para la misma lista.
- Tests: 106 (envelope real del AJAX con 3.249 capítulos y 33 páginas, formas tolerantes, candados, vecinos por cola y respaldo REST).

## Novedades v2.15

**Capítulos completos con carga progresiva y filtro de orden de capítulos:**

- **DevilNovels mostraba solo 2 capítulos de novelas de 3.000**: la ficha del sitio lista los extremos y nada más. El motor nuevo enumera TODOS los capítulos por la REST de WordPress — los capítulos son páginas hijas de la novela (`wp-json/wp/v2/pages?parent=<id>`, 100 por página, con el total real en la cabecera `X-WP-Total`). Si la REST está cerrada, cae a la paginación de la propia ficha (`?cpage=N` / `page/N`) y por último a las filas de la ficha.
- **Carga progresiva en TODAS las fuentes de novela** (el detalle pinta el primer lote de 50 y «Cargar más de la fuente» pide lo siguiente): DevilNovels trae páginas REST de verdad; las API de una sola respuesta (Skynovels, Matcha, Astral, Anslid) cortan en lotes su lista ya cacheada, sin segundas descargas. El detalle de DevilNovels ya no baja la obra entera al abrirlo — antes la ficha incluía la lista completa.
- **El lector no paga la enumeración completa**: los vecinos Anterior/Siguiente salen de la REST en DESCENSO (la primera página trae los 100 capítulos más nuevos, donde casi siempre se está leyendo) o de los extremos de la ficha si la REST está cerrada; el resultado queda en caché 2 h.
- **Filtro de orden de capítulos** en el detalle de manga y novelas: «Antiguos primero» / «Recientes primero», se aplica al instante sobre la lista y queda guardado para las próximas visitas. «Primero» y «Último» siguen siendo cronológicos aunque la lista se muestre invertida (antes el orden de la fuente decidía, y en Anslid quedaban intercambiados).
- **Una sola descarga compartida**: el detalle y el primer lote de capítulos piden lo mismo a la vez y la caché de capítulos deduplica en vuelo (antes eran dos descargas idénticas en paralelo).
- Tests: 101 (motor REST con lotes y vecinos en descenso, lotes desde la caché para las API, filtro de orden instantáneo y persistido).

## Novedades v2.14

**La v2.13.0 dejó la fuente DevilNovels muerta («no respondió»)** y esta versión lo arregla conservando TODO lo bueno de la 2.13.0, unificando las dos:

- **Qué pasó**: el nuevo extractor de la 2.13.0 exigía la ancla completa «`<a …>…</a>`» (apertura + cierre en ≤ 4000 caracteres) para cada tarjeta. El HTML real de DevilNovels tiene anclas sin cerrar, cerradas con espacios («`</a >`»), en mayúsculas («`</A>`»), anidadas y elementos enormes — con él, la extracción se quedaba SIN tarjetas, el home llegaba vacío y la pantalla mostraba el error genérico «la fuente no respondió». La 2.12.1 funcionaba (con malos datos) porque su buscador toleraba ese HTML roto.
- **La unión (v2.14.0)**: el BUSCADOR vuelve a ser el de la 2.12.1 — cualquier href raíz con sus atributos y el primer texto, **sin exigir el cierre** — garantizando todo lo que la fuente mostraba antes. ENCIMA va la extracción rica de la 2.13.0: título desde el propio elemento (attr `title` → primer texto → encabezado dentro → encabezado justo debajo → `alt`), portada con `data-src` primero, sustitutos fuera, URLs absolutizadas, filtros de acciones de cuenta y el seguro anti-portadas-repetidas.
- **Contenido interno de fiar**: el tramo hasta el `</a>` solo se usa si no contiene OTRO enlace — una tarjeta real nunca anida enlaces; si el HTML está roto (ancla sin cerrar o anidadas), ese tramo alcanza a la tarjeta siguiente y se descarta, evitando mezclar títulos y portadas entre novelas (el defecto original que la 2.13.0 quería arreglar).
- **Marca Cloudflare renovada** (`cfseen2` → `cfseen3`): mismo truco que la 2.12.1 — al actualizar, cualquier marca que la 2.13.0 fallida hubiera dejado en el dispositivo se ignora y la fuente arranca limpia.
- Tests: 94 (nuevos casos de HTML roto real: ancla sin cerrar, «`</a >`», «`</A>`», anidadas, elemento de 5659 caracteres — todos con título propio y portada correcta).

## Novedades v2.13

RCA de las tres incidencias del home de DevilNovels (2026-11), con la estructura real del sitio verificada contra el índice de Google (el menú es Inicio · Lista de Novelas · Iniciar sesión · Registrarse; el tema usa un lazy-loader «dflazy»; las páginas de finalizadas firman «Título - Finalizada»):

- **Las primeras tarjetas ya no son Login/Sign Up**: la lista de rutas que nunca son novelas estaba incompleta — el sitio llama a sus páginas de cuenta «Mi Login», «Mi Registro», «Mi Recuperar…» (`/mi-login`, `/mi-registro`, `/mi-recuperar`) y tiene una página «Acortador»; ninguna estaba excluida y el menú del sitio, que es lo primero del HTML, salía como las primeras tarjetas. Ahora se excluyen todas las rutas de cuenta/membresía/herramientas y además un filtro de texto tumba frases cortas (≤ 4 palabras) de acciones de cuenta, por si el sitio añade rutas nuevas.
- **Cada tarjeta lleva su título y su portada (antes se mezclaban entre tarjetas)**: la extracción miraba 2600 caracteres HACIA ATRÁS para encontrar título y portada, y en una malla de tarjetas cogía los de la tarjeta ANTERIOR (títulos desplazados, duplicados y portadas repetidas). Ahora se extrae del enlace completo: título del atributo/encabezado/texto del propio enlace y portada de la imagen dentro del enlace o la más cercana por encima (1000 caracteres).
- **Portadas de verdad, no el sustituto del lazy-loader**: los atributos se prueban por nombre y en orden (`data-src`, `data-lazy-src`, `data-original`, `src`) — el sustituto (`dflazy`, un GIF de 1 px en `src` o un `data:` URI) se descarta y se sigue mirando; las URLs relativas se absolutizan contra el dominio. Además un seguro quita las portadas de una sección si la mitad o más comparten la misma URL (un sustituto que se coló, no diseño del sitio).
- **Las portadas cargan más rápido**: `devilnovels.com` entra en el mapa de hosts que exigen Referer propio en sus imágenes (WordPress con hotlink-check; sin Referer fallan y Kino reintenta). Los títulos firmados « - Finalizada» se limpian en el listado de finalizadas.

## Novedades v2.12.1

- **El Home de DevilNovels ya no se queda en «no respondió» por residuos de la versión pasada**: el adaptador viejo (madara) pidió rutas inexistentes durante días, recibió 403 y dejó `devilnovels.com` **marcado como bloqueado por Cloudflare 24 h** en `kino.storage` (que sobrevive a la actualización del plugin). La sonda del Home creía esa marca SIN lanzar peticiones, así que el adaptador nuevo nunca llegaba a correr. Arreglos:
  - la clave de las marcas cambia (`cfseen` → `cfseen2`): al actualizar, el estado Cloudflare arranca en blanco para todas las fuentes;
  - además, una marca solo se cree si es **fresca (< 15 min)**: si es vieja, se hace una petición de control y la propia respuesta renueva o borra la marca (`noteHttp` ya lo hace);
  - los plazos de DevilNovels suben de 12 s a **45 s** (los de zonatmo.org): el home y las fichas son páginas de WordPress pesadas (portadas, ranking, listas largas) y el plazo corto las daba por caídas.

## Novedades v2.12

- **DevilNovels vuelve a funcionar con el mismo método que ZonaTMO.org**: raspar el HTML por las URLs REALES del sitio. La fuente estaba muerta porque su adaptador la trataba como **Madara** (copiado de Anslid) y pedía `/novela/…`, `wp-manga-search-manga` y `/ajax/chapters/` — rutas que en `devilnovels.com` NO existen. El sitio es un WordPress propio con otra estructura, verificada contra las URLs que el propio sitio publica:
  - la novela vive en la **raíz del dominio** (`devilnovels.com/esclavo-de-las-sombras`) y el capítulo cuelga de su novela con la id de post (`devilnovels.com/esclavo-de-las-sombras/esclavo-de-las-sombras-capitulo-1889/124182`; también `shadow-slave-capitulo-1-2/116637` o `nine-star-hegemon-act/nine-star-hegemon-body-art-capitulo-6007/162105`);
  - búsqueda por la estándar de WordPress (`/?s=…`), con plan B por el listado completo filtrado por texto;
  - Home con las secciones nativas del sitio: **ranking del propio home**, **/listado-de-novelas** y **/novelas-finalizadas**;
  - la ficha saca título/portada/sinopsis de los metadatos OpenGraph y los géneros de la línea «Géneros: …»; los capítulos son los enlaces hijos de la novela, **ordenados por id de post** (el orden cronológico real) con el número extraído del slug (`-capitulo-1889` → 1889, `-capitulo-1-2` → 1.2);
  - el lector toma el cuerpo del capítulo del contenedor de contenido (`reading-content`, `entry-content`, `chapter-content`… con respaldo) y descarta el chrome del sitio (pie de novelaschinas.org, comentarios, navegación, avisos de membresía); los vecinos Anterior/Siguiente salen de la lista en caché (2 h).
- **El slug interno del capítulo guarda «&lt;slug&gt;.&lt;id&gt;»**: los slugs de WordPress no llevan punto, así que el último punto separa siempre la id de post; la ficha de la novela en el navegador abre la raíz del dominio.
- **Búsqueda global de Kino arreglada**: el despacho de `catalog.search` caía en ManhwaSS para las cinco fuentes de novelas (buscaba manhwa seis veces y ninguna novela); ahora cada novela va por su propio adaptador y la búsqueda de Kino alcanza Skynovels, Matcha, Astral, Anslid y DevilNovels.
- **Anterior/Siguiente corregidos en Anslid, Matcha y Astral**: las tres fuentes devolvían los vecinos invertidos («Siguiente» iba al capítulo ANTERIOR); ahora prev = el anterior y next = el siguiente, igual que ZonaTMO.org. Verificado el orden real: el AJAX de Madara y la API de Matcha devuelven los capítulos de más nuevo a más viejo / ascendente, respectivamente.

## Novedades v2.11

- **ZonaTMO.org vuelve a funcionar**: el sitio clásico de TMO en .org **no sirve la API JSON** `/wp-api/` (esa solo la tiene zonatmo.net, que sigue igual por API). La fuente `zo` ahora funciona como el sitio de verdad: raspa el HTML con la receta probada del plugin de referencia ZonaTM0 —
  - listados y búsqueda por la **/biblioteca AJAX** (X-Requested-With, responde `{html: fragmento}`), con órdenes «actualizados» (`created_at`) y «lo más visto» (`likes_count`);
  - la obra se lee de **/library/tipo/id/slug/**, que trae TODAS las filas de capítulos del HTML (sin paginar), ordenadas con comparación natural y el grupo de traducción en el título;
  - el lector abre **/view_uploads/&lt;id&gt;/** y toma las páginas del HTML en bruto solo de `…/chapters/&lt;id&gt;/&lt;n&gt;.webp` (así no se cuelan portadas ni banners), ordenadas por número, con plan B por `reader-image`; las imágenes viven en **storage.zonatmo.org**, ya declarado en el manifiesto («Se conectará a: zonatmo.org, storage.zonatmo.org»);
  - sin cuentas ni tokens: todo es público (el ajuste de cuentas sigue siendo de ZonaTMO .net).
- El slug interno de la fuente codifica el trío del sitio (`manga.12345.solo-leveling`) y el capítulo el id de subida y número (`up-456789.n200.5`), ambos admitidos por el validador de refs; el número normaliza ceros finales (200.50 → 200.5).
- Los vecinos Anterior/Siguiente del lector salen de la lista de la obra (caché de 10 obras, 10 min): cambiar de capítulo no vuelve a raspar la obra.
- Cloudflare: si .org pide desafío, la tarjeta «Pre-clearance de Cloudflare» de Ajustes sigue siendo la vía para resolverlo una vez (la cookie cubre sitio y storage).

## Novedades v2.10

- **Fin del «empieza a la mitad»**: al cambiar de capítulo, el lector reutilizaba el scroll del capítulo anterior (claves de widget constantes) y el nuevo capítulo arrancaba a media página. Ahora cada apertura lleva una clave única (token por apertura + capítulo): **cada capítulo empieza en su página 1**, en los tres modos (tira vertical, páginas RTL y novela). Es la misma corrección que el plugin de referencia ZonaTM0 documentó en su changelog v1.2.1 («clave única por apertura — el paginador arranca en la página 1, sin restaurar la última vista»), adoptada y verificada aquí.
- **Retomar la lectura**: al abrir «Seguir: Cap. N» en el capítulo guardado, el lector recupera la página donde te quedaste — el paginador RTL arranca en esa página (`initialPage`) y la tira muestra «Estabas por la página X de Y» (el contrato de Kino no ofrece posición inicial para el scroll vertical ni para la lista de novela, que arranca al inicio).
- **Progreso confiable**: regla del «punto más leído» por capítulo — reabrir el capítulo o el primer evento de scroll a cero **no borran** lo ya leído; avanzar siempre se guarda. `kino.progress` marca el capítulo como terminado (`done`) al llegar al final. El guardado por scroll se escribe con criterio (cambio de página, 2% de avance o 4 s) en vez de a cada píxel, y llega a storage de inmediato: sobrevive a cerrar el lector o la app.
- **Modo páginas ampliado**: los capítulos RTL pueden usar el paginador nativo hasta 250 páginas cuando Kino declara el widget `pages` (antes el corte duro era 8 y muchos capítulos caían a tira sin necesidad); en Kino viejos, la tira siempre.
- Orden numérico de páginas ya nativo en la fuente (por `page_number` de la API, mejor que el orden de archivo del plugin de referencia).

## Novedades v2.9

- **Pre-clearance de Cloudflare (Turnstile → cf_clearance)**: «Resolver» abre el sitio en la ventana embebida, la persona completa el desafío UNA VEZ y Kino entrega la cookie de sesión (cf_clearance); el plugin la guarda por host y `fetchText` la manda en cada petición siguiente, así que la fuente responde sin volver a retar mientras la cookie valga. Tras resolver, el plugin **verifica con una petición real** antes de anunciar nada y dice la verdad: «Pre-clearance activa», «el sitio volvió a retar» o «el sitio sigue bloqueando (regla por IP o firma)».
- **Entrada manual siempre disponible**: tarjeta «Pre-clearance de Cloudflare» en Ajustes con el estado real por fuente (cookie guardada, edad, tipo de muro) y botones Resolver/Borrar; el panel del Home ya no depende de una marca de 20 s en memoria: el estado es **persistente** (24 h) y sobrevive al cierre del plugin.
- **Desafío soluble ≠ bloqueo**: la clasificación separa el desafío interactivo («Just a moment», `challenge-platform`, Turnstile — resolvable, la cookie sirve) del **bloqueo de firewall** (1010 «Access denied… used Cloudflare», 1020 «Sorry, you have been blocked» — la regla corre ANTES del desafío y cf_clearance no lo salta). Hoy: zonatmo.org responde 1010 y devilnovels.com 1020 a las peticiones del plugin; el panel lo explica y sugiere otra red (Wi-Fi o datos móviles) o más tarde, sin prometer una ventana que no puede arreglarlo. El intento de pre-clearance sigue disponible por si el trato cambia por red o país.
- **Corregido el bug que escondía la ventana**: la sonda de Cloudflare llamaba a `fetchText` sin importarlo (ReferenceError silencioso), así que el panel «Resolver desafío» casi nunca aparecía; con el import arreglado la sonda funciona y el desafío servido con 200 (página retadora y su JS) también se reconoce.
- Disponibilidad del navegador visual relajada (`available !== false`): una versión de Kino que no publique el campo ya no bloquea la ventana (necesita Kino 0.9.81+; el mensaje lo dice).

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
- **Anslid** (`novels.js`): Madara estándar: archivo `/novela/?m_orderby=`, búsqueda XHR `wp-manga-search-manga`, detalle con `data-src` de portada (lazy-load: nunca el placeholder `dflazy.jpg`), capítulos `/ajax/chapters/`.
- **DevilNovels** (`devilnovels.js`, desde v2.12): WordPress PROPIO, no Madara: novela en la raíz (`/<slug>/`), capítulo hijo con id de post (`/<slug>/<capitulo>/<id>/`), búsqueda `/?s=`, listados `/listado-de-novelas` y `/novelas-finalizadas`, capítulos ordenados por id de post y texto del contenedor de contenido con plan B.

Si un sitio cambia su interfaz, el primer lugar que hay que revisar son esas rutas y selectores.
