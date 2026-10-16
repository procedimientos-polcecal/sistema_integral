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
  // `clients` aparece suelto en el archivo, como global del service worker.
  new Function("self", "clients", CODIGO)(self, clients);
  return { handlers, openWindow, showNotification, matchAll };
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

  it("el handler de fetch no intercepta nada", () => {
    // No llama a `respondWith`: la petición sigue su camino normal a la red.
    const { handlers } = cargarSW();
    const respondWith = vi.fn();
    handlers["fetch"]({ respondWith, request: { url: `${ORIGEN}/compras` } });
    expect(respondWith).not.toHaveBeenCalled();
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
