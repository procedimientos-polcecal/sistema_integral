import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CABECERA_DEL_DISPARO,
  CAMPO_DEL_CUERPO,
  CAMPO_DE_LA_FOTO,
  DISPARO,
  RUTA_DE,
} from "@/public/cola/colaOffline.js";
import { mandarALaRuta } from "@/app/cargar/envio";

/**
 * Cómo arma el pedido la **pantalla** (`app/cargar/envio.tsx`), que es la
 * gemela de la `mandarALaRuta` de `public/sw.js`.
 *
 * ── POR QUÉ EXISTE ESTE ARCHIVO, QUE ES UNA EXCEPCIÓN ──────────────────────
 *
 * En este repo las pantallas no tienen tests: la lógica se saca a `lib/` y se
 * prueba ahí. `envio.tsx` ya hizo eso —no decide nada, todo lo decide
 * `comoContesto`— y lo que le queda es **la forma del pedido HTTP**, que es
 * justamente lo que el 30/10/2026 se tocó para que la foto de una condición
 * insegura pudiera viajar.
 *
 * Esa forma se probaba de un solo lado. `lib/core/sw.test.ts` cubre la del
 * service worker porque evalúa `public/sw.js` entero; la de la pantalla no
 * tenía nada, y es la que corre cuando alguien carga un aviso con señal, que
 * es el camino que usa todo el mundo todos los días. **La promesa del cambio
 * es que el aviso y la orden de trabajo salgan byte por byte como salían**, y
 * una promesa que sólo se comprueba en una de las dos gemelas es media
 * promesa.
 *
 * Importa el `.tsx` y no un módulo intermedio a propósito: lo que se quiere
 * probar es el archivo que corre, no una copia de su contenido.
 */

/** El `fetch` que el navegador le presta a la pantalla, acá doblado. */
function conFetch(respuesta: Partial<Response> & { json?: () => Promise<unknown> }) {
  const doble = vi.fn(async () => respuesta as Response);
  vi.stubGlobal("fetch", doble);
  return doble;
}

/** Lo que la ruta contesta cuando todo salió bien. */
function contesta(cuerpo: Record<string, unknown>) {
  return { status: 200, redirected: false, json: async () => cuerpo };
}

/** El `init` del pedido, tal como lo recibió `fetch`. */
function pedido(doble: { mock: { calls: unknown[][] } }) {
  const [url, init] = doble.mock.calls[0] as [
    string,
    { method: string; headers: Record<string, string>; body: unknown },
  ];
  return { url, ...init };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mandarALaRuta, desde la pantalla", () => {
  it("el aviso sale igual que siempre: JSON, con su Content-Type", async () => {
    const doble = conFetch(contesta({ oa_number: "OA-77" }));
    const cuerpo = { descripcion: "pérdida de aceite", clave: "k1", fecha: "2026-10-30" };

    const r = await mandarALaRuta("aviso", cuerpo);

    const salio = pedido(doble);
    expect(salio.url).toBe(RUTA_DE.aviso);
    expect(salio.method).toBe("POST");
    // Las cabeceras **completas** y no un `objectContaining`: lo que este test
    // cuida es que no aparezca ni se vaya ninguna.
    expect(salio.headers).toEqual({
      "Content-Type": "application/json",
      [CABECERA_DEL_DISPARO]: DISPARO.pantalla,
    });
    expect(salio.body).toBe(JSON.stringify(cuerpo));
    expect(r).toEqual({ ok: true, numero: "OA-77", advertencia: null });
  });

  it("la orden de trabajo también", async () => {
    const doble = conFetch(contesta({ ot_number: "OT-12" }));
    const cuerpo = { descripcion: "cambiar correa", horas: 3, clave: "k2" };

    const r = await mandarALaRuta("orden", cuerpo);

    const salio = pedido(doble);
    expect(salio.url).toBe(RUTA_DE.orden);
    expect(salio.headers).toEqual({
      "Content-Type": "application/json",
      [CABECERA_DEL_DISPARO]: DISPARO.pantalla,
    });
    // `horas` sale como número y no como "3": es lo que pierde un `FormData`, y
    // por eso el aviso y la OT no pasaron a mandarse así.
    expect(JSON.parse(String(salio.body))).toEqual(cuerpo);
    expect(r).toEqual({ ok: true, numero: "OT-12", advertencia: null });
  });

  it("la condición sale como FormData, sin Content-Type, y la foto va aparte", async () => {
    const doble = conFetch(contesta({ numero: "7" }));
    const foto = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

    const r = await mandarALaRuta("condicion", {
      descripcion: "falta la guarda del cardán",
      prioridad: 2,
      peligro_id: null,
      foto,
    });

    const salio = pedido(doble);
    expect(salio.url).toBe(RUTA_DE.condicion);
    // **SIN `Content-Type`**: lo pone el navegador con su `boundary`. Escrito a
    // mano, el servidor no puede partir el cuerpo y contesta que falta todo —un
    // 400, que para la cola es definitivo— sobre una carga que estaba bien.
    expect(salio.headers).toEqual({ [CABECERA_DEL_DISPARO]: DISPARO.pantalla });

    const forma = salio.body as FormData;
    expect(forma).toBeInstanceOf(FormData);
    // El cuerpo entero en un campo de JSON: así la ruta valida exactamente el
    // mismo objeto que en el camino JSON, con `prioridad` todavía número y
    // `peligro_id` todavía null.
    expect(JSON.parse(String(forma.get(CAMPO_DEL_CUERPO)))).toEqual({
      descripcion: "falta la guarda del cardán",
      prioridad: 2,
      peligro_id: null,
    });
    expect(forma.get(CAMPO_DE_LA_FOTO)).toBeInstanceOf(Blob);
    expect(r).toEqual({ ok: true, numero: "7", advertencia: null });
  });

  it("una condición sin foto sale igual, y sin el campo de la foto", async () => {
    // Una condición se puede cargar sin foto, y entonces el campo **no va**:
    // que no esté es inequívoco, un campo vacío habría que interpretarlo.
    const doble = conFetch(contesta({ numero: "8" }));
    await mandarALaRuta("condicion", { descripcion: "x", prioridad: 1, foto: null });

    const forma = pedido(doble).body as FormData;
    expect(forma.has(CAMPO_DE_LA_FOTO)).toBe(false);
    expect(JSON.parse(String(forma.get(CAMPO_DEL_CUERPO)))).toEqual({
      descripcion: "x",
      prioridad: 1,
    });
  });

  it("un fetch que tira es pasajero y no salió de la ruta", async () => {
    // No cambió con esta tarea y por eso está: es el camino de «sin señal», que
    // es el que más corre en esta pantalla.
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("Failed to fetch");
    }));
    expect(await mandarALaRuta("aviso", { descripcion: "x" })).toEqual({
      ok: false,
      status: null,
      deLaRuta: false,
      error: "Failed to fetch",
    });
  });
});
