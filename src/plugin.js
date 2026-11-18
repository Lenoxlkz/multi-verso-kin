// Multi-verso Kin: a Kino plugin. Docs: https://kinotvapp.github.io/kino-plugins/
// Every function is async, returns plain JSON and must not throw before its first await.
//
// The entry of the plugin: it only re-exports what Kino calls. `npm run build` bundles src/ into the shipped
// plugin.js (one ES module, the file Kino installs); never edit plugin.js by hand.

// Catálogo multi-fuente (catalogOnly: el plugin lista y describe; no reproduce).
export { search, home, browse, section, categories } from "./catalog.js";
// La pantalla propia (apiVersion 14).
export { screen, screenEvent } from "./screen.js";
// Ajustes: acciones de inicio de sesión, estado de las cuentas y validación.
export { action, settingsStatus, validateSettings } from "./action.js";
