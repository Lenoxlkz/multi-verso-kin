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

Si un sitio cambia su interfaz, el primer lugar que hay que revisar son esas rutas y selectores.
