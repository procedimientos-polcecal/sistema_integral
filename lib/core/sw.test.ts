import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Prueba `public/sw.js` de verdad: es JavaScript plano que usa `self`, así que
 * se lee el archivo, se evalúa contra un `self` falso que guarda los handlers
 * que registra, y después se disparan los eventos a mano.
 *
 * Qué NO prueba: que el navegador llame al handler, ni que Chrome ofrezca
 * instalar. Prueba lo que el archivo hace cuando lo llaman, y que está
 * registrado para que lo llamen.
 */

const ORIGEN = "https://sdg.test";
const CODIGO = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

type Ventana = {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
};

/** La respuesta que devuelve el `fetch` doble: alcanza con que sea identificable. */
const RESPUESTA = { ok: true } as const;

/** Evalúa el service worker y devuelve sus handlers y las dobles con que corrió. */
function cargarSW(ventanas: Ventana[] = []) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const openWindow = vi.fn(async () => undefined);
  const showNotification = vi.fn(async () => undefined);
  const matchAll = vi.fn(async () => ventanas);
  const clients = { matchAll, openWindow };
  const self = {
    addEventListener: (tipo: string, fn: (event: unknown) => void) => {
      handlers[tipo] = fn;
    },
    location: { origin: ORIGEN },
    registration: { showNotification },
    clients,
  };
  // `fetch` entra como parámetro y no como global: así el handler de navegación
  // se prueba contra una doble en vez de salir a la red de verdad.
  const fetchDoble = vi.fn(async () => RESPUESTA);
  // `clients` aparece suelto en el archivo, como global del service worker.
  new Function("self", "clients", "fetch", CODIGO)(self, clients, fetchDoble);
  return { handlers, openWindow, showNotification, matchAll, fetchDoble };
}

/** Dispara `notificationclick` y espera lo que el handler le pasó a `waitUntil`. */
async function clickear(
  handlers: Record<string, (event: unknown) => void>,
  data?: { url?: string } | undefined
) {
  const esperas: Promise<unknown>[] = [];
  const close = vi.fn();
  handlers["notificationclick"]({
    notification: { close, data },
    waitUntil: (p: Promise<unknown>) => esperas.push(p),
  });
  await Promise.all(esperas);
  return { close };
}

describe("public/sw.js", () => {
  it("el service worker registra un handler de fetch", () => {
    // Sin handler de fetch Chrome no dispara `beforeinstallprompt` y el botón de
    // instalar de Android no aparece nunca, sin ningún error. Es la línea que
    // alguien borraría por parecer inútil.
    const { handlers } = cargarSW();
    expect(typeof handlers["fetch"]).toBe("function");
  });

  it("una navegación se responde con la misma petición, contra la red", async () => {
    // El handler tiene que hacer algo observable: un `() => {}` es el patrón que
    // Chrome documenta como gameado y dejó de aceptar. Esto es el mínimo
    // honesto, y lo que prueba este test es que efectivamente responde.
    const { handlers, fetchDoble } = cargarSW();
    const respondWith = vi.fn();
    const request = { url: `${ORIGEN}/compras`, mode: "navigate" };
    handlers["fetch"]({ respondWith, request });

    expect(respondWith).toHaveBeenCalledTimes(1);
    expect(fetchDoble).toHaveBeenCalledWith(request);
    // Lo que se responde es lo que devolvió `fetch`, sin tocarlo: ni caché ni
    // página de reemplazo, que es la fase 3.
    const [respondido] = respondWith.mock.calls[0] as unknown as [Promise<unknown>];
    await expect(respondido).resolves.toBe(RESPUESTA);
  });

  it("lo que no es navegación no se toca", () => {
    // Las imágenes, el JSON de las rutas y el bundle siguen su camino normal:
    // meterse en el medio de todo el tráfico no compra nada todavía.
    const { handlers, fetchDoble } = cargarSW();
    for (const mode of ["cors", "no-cors", "same-origin", undefined]) {
      const respondWith = vi.fn();
      handlers["fetch"]({ respondWith, request: { url: `${ORIGEN}/icon-192.png`, mode } });
      expect(respondWith).not.toHaveBeenCalled();
    }
    expect(fetchDoble).not.toHaveBeenCalled();
  });

  describe("notificationclick", () => {
    it("abre la url que viene en el payload", async () => {
      const { handlers, openWindow } = cargarSW();
      await clickear(handlers, { url: "/compras/aprobaciones" });
      expect(openWindow).toHaveBeenCalledTimes(1);
      expect(openWindow).toHaveBeenCalledWith("/compras/aprobaciones");
    });

    it("conserva la query y el hash de la url", async () => {
      const { handlers, openWindow } = cargarSW();
      await clickear(handlers, { url: "/compras?estado=pendiente#fila-3" });
      expect(openWindow).toHaveBeenCalledWith("/compras?estado=pendiente#fila-3");
    });

    it("sin url abre la raíz", async () => {
      const { handlers, openWindow } = cargarSW();
      await clickear(handlers, {});
      expect(openWindow).toHaveBeenCalledWith("/");
    });

    it("sin data en la notificación tampoco tira y abre la raíz", async () => {
      const { handlers, openWindow } = cargarSW();
      await clickear(handlers, undefined);
      expect(openWindow).toHaveBeenCalledWith("/");
    });

    it("una url de otro origen no se abre: va a la raíz", async () => {
      // El payload lo arma nuestro servidor, pero una notificación no tiene
      // por qué poder llevar a nadie fuera del SdG.
      const { handlers, openWindow } = cargarSW();
      await clickear(handlers, { url: "https://otro-sitio.test/phishing" });
      expect(openWindow).toHaveBeenCalledWith("/");
    });

    it("cierra la notificación", async () => {
      const { handlers } = cargarSW();
      const { close } = await clickear(handlers, { url: "/" });
      expect(close).toHaveBeenCalled();
    });

    it("si ya hay una ventana abierta la enfoca en vez de abrir otra", async () => {
      const ventana: Ventana = {
        url: `${ORIGEN}/`,
        focus: vi.fn(async () => undefined),
      };
      const { handlers, openWindow, matchAll } = cargarSW([ventana]);
      await clickear(handlers, { url: "/" });
      expect(matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
      expect(ventana.focus).toHaveBeenCalledTimes(1);
      expect(openWindow).not.toHaveBeenCalled();
    });

    it("la ventana que ya estaba abierta se lleva a la url del aviso", async () => {
      // Enfocar sin navegar dejaría a la persona mirando otra pantalla que la
      // que le avisaron.
      const enfocada = { url: `${ORIGEN}/compras/aprobaciones`, focus: vi.fn(async () => undefined) };
      const ventana: Ventana = {
        url: `${ORIGEN}/rrhh`,
        focus: vi.fn(async () => undefined),
        navigate: vi.fn(async () => enfocada),
      };
      const { handlers, openWindow } = cargarSW([ventana]);
      await clickear(handlers, { url: "/compras/aprobaciones" });
      expect(ventana.navigate).toHaveBeenCalledWith(`${ORIGEN}/compras/aprobaciones`);
      expect(enfocada.focus).toHaveBeenCalledTimes(1);
      expect(openWindow).not.toHaveBeenCalled();
    });

    it("si la ventana no se deja navegar, igual la enfoca", async () => {
      // `navigate` rechaza con ventanas que el service worker no controla.
      const ventana: Ventana = {
        url: `${ORIGEN}/rrhh`,
        focus: vi.fn(async () => undefined),
        navigate: vi.fn(async () => {
          throw new Error("no controlada");
        }),
      };
      const { handlers, openWindow } = cargarSW([ventana]);
      await clickear(handlers, { url: "/compras" });
      expect(ventana.focus).toHaveBeenCalledTimes(1);
      expect(openWindow).not.toHaveBeenCalled();
    });
  });

  describe("push", () => {
    it("guarda data en la notificación para que el click la encuentre", async () => {
      const { handlers, showNotification } = cargarSW();
      const esperas: Promise<unknown>[] = [];
      handlers["push"]({
        data: {
          json: () => ({ title: "Compras", body: "Hay una para aprobar", data: { url: "/compras/aprobaciones" } }),
        },
        waitUntil: (p: Promise<unknown>) => esperas.push(p),
      });
      await Promise.all(esperas);
      expect(showNotification).toHaveBeenCalledTimes(1);
      const [titulo, opciones] = showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(titulo).toBe("Compras");
      expect(opciones.data).toEqual({ url: "/compras/aprobaciones" });
    });

    it("usa el ícono chico y no el logo de 2 MB", async () => {
      const { handlers, showNotification } = cargarSW();
      const esperas: Promise<unknown>[] = [];
      handlers["push"]({
        data: { json: () => ({ title: "SdG", body: "x" }) },
        waitUntil: (p: Promise<unknown>) => esperas.push(p),
      });
      await Promise.all(esperas);
      const [, opciones] = showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(opciones.icon).toBe("/icon-192.png");
      expect(opciones.badge).toBe("/icon-192.png");
    });

    it("un push sin data no rompe: guarda data vacía", async () => {
      const { handlers, showNotification } = cargarSW();
      const esperas: Promise<unknown>[] = [];
      handlers["push"]({
        data: { json: () => ({ title: "SdG", body: "x" }) },
        waitUntil: (p: Promise<unknown>) => esperas.push(p),
      });
      await Promise.all(esperas);
      const [, opciones] = showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(opciones.data ?? {}).toEqual({});
    });
  });
});
