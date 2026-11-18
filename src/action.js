// action.js — las acciones de los ajustes: entrar con ventana visible (visualBrowser), entrar con
// usuario y contraseña, el estado de las cuentas y la validación de los ajustes.
//
// Dos caminos de inicio de sesión por sitio:
//  1. «Entrar con ventana» (recomendado): Kino abre una ventana que la persona conduce; en ZonaTMO se
//     recolecta el token del localStorage (auth:tokens) y en Manhwa las cookies de la sesión. El plugin
//     nunca ve los valores: Kino los escribe en ajustes de tipo password.
//  2. Usuario y contraseña escritos a mano: se intenta el POST de login del sitio; los dos sitios pueden
//     pedir su verificación anti-bot (Turnstile) y entonces el mensaje manda a la ventana.

import { ztToken, msCookie } from "./env.js";
import * as zt from "./zonatmo.js";
import * as ms from "./manhwa.js";

const VISUAL = () => typeof kino.visualBrowser === "object" && kino.visualBrowser && kino.visualBrowser.available === true;

export async function settingsStatus() {
  const hasZt = Boolean(ztToken() || (kino.config.get("zt_user") && kino.config.get("zt_pass")));
  const hasMs = Boolean(msCookie() || (kino.config.get("ms_user") && kino.config.get("ms_pass")));
  return {
    cuentas: "ZonaTMO: " + (hasZt ? "cuenta lista" : "sin cuenta") + " · Manhwa: " + (hasMs ? "cuenta lista" : "sin cuenta"),
  };
}

export async function action(key) {
  const en = kino.lang && String(kino.lang).startsWith("en") ? "en" : "es";
  const t = (es, enS) => (en === "en" ? enS : es);

  if (key === "win_zt") {
    if (!VISUAL()) return { message: t("Esta ventana no está disponible en este aparato: hazlo desde el teléfono.", "This window is not available on this device: do it from the phone.") };
    try {
      const r = await kino.visualBrowser.open({
        url: "https://zonatmo.net/login",
        title: "ZonaTMO",
        doneWhen: { localStorage: ["auth:tokens"] },
        collect: { localStorage: ["auth:tokens"], storeAs: { setting: "zt_token", format: "json" } },
        userAgent: "browser",
        timeoutMs: 300000,
      });
      if (r.status === "done") return { message: t("Cuenta de ZonaTMO vinculada.", "ZonaTMO account linked.") };
      if (r.status === "timeout") return { message: t("Se cerró la ventana por tiempo: inténtalo otra vez.", "The window timed out: try again.") };
      return { message: t("Cerraste la ventana sin terminar el paso.", "You closed the window without finishing.") };
    } catch (e) {
      return { message: t("No se pudo abrir la ventana: " + String((e && e.message) || "error").slice(0, 120), "Could not open the window: " + String((e && e.message) || "error").slice(0, 120)) };
    }
  }

  if (key === "win_ms") {
    if (!VISUAL()) return { message: t("Esta ventana no está disponible en este aparato: hazlo desde el teléfono.", "This window is not available on this device: do it from the phone.") };
    try {
      const r = await kino.visualBrowser.open({
        url: "https://manhwass.lat/iniciar-sesion/",
        title: "Manhwa",
        userAgent: "browser",
        timeoutMs: 300000,
      });
      if (r.status !== "done") {
        if (r.status === "timeout") return { message: t("Se cerró la ventana por tiempo: inténtalo otra vez.", "The window timed out: try again.") };
        return { message: t("Cerraste la ventana sin terminar el paso.", "You closed the window without finishing.") };
      }
      const cookies = r.cookies && Object.keys(r.cookies).length ? r.cookies : null;
      if (!cookies) return { message: t("Entraste, pero el sitio no dejó cookies que guardar: lee leyendo sin cuenta.", "You signed in, but the site left no cookies to keep: reading works without an account.") };
      return {
        message: t("Cuenta de Manhwa vinculada (" + Object.keys(cookies).length + " cookies).", "Manhwa account linked (" + Object.keys(cookies).length + " cookies)."),
        setSettings: { ms_cookie: JSON.stringify(cookies) },
      };
    } catch (e) {
      return { message: t("No se pudo abrir la ventana: " + String((e && e.message) || "error").slice(0, 120), "Could not open the window: " + String((e && e.message) || "error").slice(0, 120)) };
    }
  }

  if (key === "log_zt") {
    const user = kino.config.get("zt_user");
    const pass = kino.config.get("zt_pass");
    if (!user || !pass) return { message: t("Escribe primero tu correo y contraseña de ZonaTMO arriba.", "Type your ZonaTMO email and password above first.") };
    const r = await zt.login("zt", user, pass);
    if (r.ok && r.token) {
      return {
        message: t("Entraste en ZonaTMO.", "Signed in to ZonaTMO."),
        setSettings: { zt_token: JSON.stringify({ access_token: r.token }) },
      };
    }
    return { message: r.message || t("No se entró.", "Sign-in failed.") };
  }

  if (key === "log_ms") {
    const user = kino.config.get("ms_user");
    const pass = kino.config.get("ms_pass");
    if (!user || !pass) return { message: t("Escribe primero tu usuario y contraseña de Manhwa arriba.", "Type your Manhwa user and password above first.") };
    const r = await ms.login("ms", user, pass);
    if (r.ok) return { message: t("Entraste en Manhwa: la sesión quedó en las cookies del plugin.", "Signed in to Manhwa: the session is in the plugin's cookies.") };
    return { message: r.message || t("No se entró.", "Sign-in failed.") };
  }

  if (key === "salir") {
    return { message: t("Datos de cuentas borrados.", "Account data cleared.") };
  }

  return null;
}

export async function validateSettings(values) {
  // Se acepta todo: los ajustes son optativos y solo el sitio juzga las credenciales.
  return null;
}
