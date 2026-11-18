# Multi-verso Kin

Un plugin de [Kino](https://kinotvapp.github.io/kino-plugins/) para leer **manga y manhwa en español** de cuatro fuentes:

| Fuente | Sitio | Qué da |
| --- | --- | --- |
| ZonaTMO | `zonatmo.net` | API JSON: recientes, lo más visto, mejor valorados, géneros, búsqueda |
| ZonaTMO.org | `zonatmo.org` | El mismo software que zonatmo.net (gemelo: si uno falla, prueba el otro) |
| ManhwaSS | `manhwass.lat` | Webtoon: últimas actualizaciones, en emisión, completados, búsqueda |
| ManhwaShot | `manhwashot.lat` | La misma aplicación que manhwass.lat (gemelo) |

Instalación en Kino: **Ajustes ▸ Plugins ▸ Agregar plugin** y pega `Lenoxlkz/multi-verso-kin`.

## Qué hace

- **Búsqueda global** en las cuatro fuentes a la vez (quita repetidos entre gemelas).
- **Filas en el Home de Kino** y una sección propia «Multi-verso» con pestañas por fuente.
- **Pantalla propia** (menú de Kino): portada con filas por fuente, búsqueda, detalle del manga con la lista de capítulos, ajustes y lectura sin conexión.
- **Lector propio**: manga japonés (RTL) a páginas volteadas con barra de progreso; webtoon en tira vertical con zoom. Botones de capítulo anterior y siguiente.
- **Seguir leyendo**: guarda en qué capítulo y página quedaste (kino.progress, Kino 0.9.83+) y muestra la fila «Seguir leyendo» en el Home y en la portada del plugin.
- **Lectura sin conexión** (Kino 0.9.82+): elige una carpeta de imágenes (un capítulo por carpeta) o imágenes sueltas y léelas sin internet. Límite de Kino: cada página debe caber en una imagen `data:` (~150 KB); las páginas más pesadas se saltan con un aviso.
- **Cuentas (opcional)**: el plugin funciona sin cuenta. Para entrar, lo cómodo es **«Entrar con ventana»**: Kino abre la web del sitio, inicias sesión tú, y Kino guarda el token (ZonaTMO, del localStorage `auth:tokens`) o las cookies (Manhwa) en ajustes de tipo contraseña; el plugin nunca ve esos valores. El inicio con usuario y contraseña escrito a mano existe, pero los dos sitios pueden pedir su verificación anti-bot (Turnstile) y entonces el mensaje manda a la ventana.
- **Temas de toda la app**: cuatro temas (uno por fuente), con un botón para ponerlos desde la pestaña de ajustes del plugin.
- **Compartir**: botón en la barra y en el detalle (teléfono), con la tarjeta del título.
- **Solo catálogo** (`catalogOnly`): el plugin no reproduce video y Kino nunca lo pide como fuente de reproducción.

## Novedades v2.3

- **«Leer archivos locales» retirado por completo** (vista, ruta, eventos y capacidad `files` del manifiesto): la app es de lectura online. El primer arranque también purga su clave vieja del storage.
- **Filtros de búsqueda**: chips «Todas» o una fuente concreta (ZonaTMO/ZonaTMO.org/ManhwaSS/ManhwaShot). Cambiar el filtro con texto en el campo repite la búsqueda al momento; solo la fuente elegida = respuesta más rápida.
- **«Abrir en el navegador»** en el detalle: abre la ficha del manga en la web de la fuente (Kino muestra su propia hoja de confirmación; en TV, un QR).
- **Regreso del lector arreglado**: se quitó el botón «Salir del capítulo» y todo enlace profundo («Seguir leyendo») abre ahora el DETALLE del manga. El lector solo se apila desde el detalle, así que el botón de atrás lleva siempre a la ficha del manga, nunca al Home.
- Optimización: menos código (67 KB), sin capacidades muertas, búsqueda por fuente sin tráfico de las otras.

## Novedades v2.2

- **La descarga de capítulos se retiró por completo** (motor, cola, tics, ruta y botones): no era sostenible con los límites de la plataforma (2 MB por árbol, cuota de storage). Al abrir el plugin se purgan los restos viejos de storage y se libera la cuota. Queda «Leer archivos locales» (carpetas o imágenes del aparato) en la portada y en Ajustes.
- **Lector en inmersión**: sin barra de navegación; conserva anterior/siguiente y el capítulo actual, y añade el botón «Salir del capítulo» para volver al detalle.
- **Tema «Modo Oscuro AMOLED»** (negro puro) entre los 8 temas (se retiró «ZonaTMO Ámbar», casi idéntico a Naranja: la plataforma limita a 8).
- **Descripciones con «Ver más»/«Ver menos»** cuando la sinopsis es larga.
- **Capítulos de pago**: detección por texto/clase de la fila (candado en la lista), aviso de cuántos hay, apertura normal (si tu cuenta premium de la fuente da acceso funciona) y ajuste «Ocultar capítulos de pago» para esconderlos. Hoy ninguna fuente publica el marcado de forma fiable: es mejor esfuerzo y se activará solo cuando una fuente lo marque.
- **Cero trabajo de fondo**: sin temporizadores, cada toque se atiende al instante.

## Novedades v2.1

- **Descargas que no estorban**: el motor baja unas páginas por turno (tics de 1-3 s) en cualquier ruta del plugin, no solo en Descargas; los toques nunca esperan un capítulo entero. Página lenta = reintento (hasta 3), ya no mata la descarga ni el temporizador.
- **Barra con sección Inicio**: Inicio / Ajustes / Descargas, con la sección activa marcada según la ruta de verdad; tocar Inicio vuelve hacia la portada y tocar Ajustes entra de verdad a la configuración de cuentas.
- **Temas de la app aplicados dentro del plugin**: se quitó el tema propio del plugin, así que el tema que elijas (los 8) tiñe también estas páginas; el violeta es «Manhwa Violeta».

## Novedades v2

- **Velocidad**: caché local de portada, detalle, capítulos y búsquedas (la segunda visita pinta al instante), cargas en paralelo y plazo corto para los dominios gemelos para que no frenen nada.
- **Salida real**: Atrás del sistema y el botón ‹ de la barra desapilan (y en la portada cierran); ninguna ruta queda atrapada.
- **Colores por defecto**: el violeta de Multi-verso tiñe las páginas del plugin sin configurar nada; 8 temas de toda la app (Naranja, Ámbar, Violeta, Esmeralda, Índigo, Cian, Rosa y Lima) con botón para ponerlos.
- **Barra de navegación inferior** (Ajustes + Descargas) y **botón flotante de búsqueda** a la derecha: al bajar el contenido se esconden y al subir vuelven.
- **Descargas de capítulos**: botón de descarga a la derecha de cada capítulo, lote de 5/10/20/30 con selector (se recuerda), cola con progreso en vivo, reintentos, cuota de 14 MB y borrado. Se descargan las páginas tal cual las sirve el sitio; el lector sin conexión las muestra una a una (las que pesen más de ~150 KB, el límite de Kino para imágenes `data:`, se avisan).

## Requisitos de versión

- `apiVersion` 18 → necesita **Kino 0.9.81 o más nuevo**.
- `files` (sin conexión) → Kino 0.9.82+.
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

Para grabar fixtures de nuevo (necesita red):

```
node sdk/run.mjs --record /tmp/f1.json . search "solo leveling"
node sdk/run.mjs --record /tmp/f2.json . home
node sdk/run.mjs --record /tmp/f3.json . browse "zt:new"
node sdk/run.mjs --record /tmp/f4.json . browse "ms:all"
```

y junta los archivos JSON (listas de entradas con `key`) en `test/fixtures.json`.

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

Si un sitio cambia su interfaz, el primer lugar que hay que revisar son esas rutas y selectore
s.
