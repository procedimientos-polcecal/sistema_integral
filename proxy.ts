import { type NextRequest } from "next/server";
// Sigue llamándose `middleware.ts` del lado de Supabase a propósito: es el
// nombre que usa su documentación de SSR para este helper, y es con lo que se
// compara cualquiera que venga de ahí. Lo que se renombró es la convención de
// Next, que es otra cosa.
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Antes era `middleware.ts` con una función `middleware`.
 *
 * Next 16 deprecó ese nombre y pide `proxy.ts` con una función `proxy`, para
 * separar "esto corre en el borde de la red y decide routing" de la idea más
 * amplia de un middleware. El dev server lo avisaba en cada arranque.
 *
 * Lo único que cambia de comportamiento es el runtime: `proxy` corre siempre en
 * `nodejs` y no se puede configurar. Acá no importa —nunca se pidió `edge`— pero
 * si alguna vez hiciera falta, hay que volver a `middleware.ts`: el `edge` no
 * está soportado en `proxy`.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  /*
   * `pdfjs` queda afuera: ahí viven los dos archivos que el lector de facturas
   * baja por su cuenta —el worker de pdf.js, que rasteriza el PDF para buscarle
   * el QR, y el wasm de ZXing, que es el segundo decodificador—. Son 2,2 MB de
   * dos paquetes públicos, así que no hay nada que proteger, y hacerlos pasar
   * por acá tendría dos costos: un `getUser()` contra Supabase por cada carga,
   * y —si por cualquier motivo la cookie no viajara en el pedido del Worker— un
   * 307 al login que del lado del navegador aparece como un error opaco, justo
   * en medio de la carga de una factura.
   *
   * `manifest.webmanifest` y `sw.js` quedan afuera por el mismo motivo, y acá
   * el 307 no es un detalle: el manifest lo lee el navegador antes de que haya
   * sesión (es lo que ofrece «Agregar a inicio» desde la pantalla de login), y
   * `sw.js` tiene que registrarse para todo el origen. Con el redirect, el
   * manifest llega como HTML donde se esperaba JSON y el service worker no se
   * registra. Los dos son públicos por definición y no hay nada que proteger.
   *
   * `cola` queda afuera por el mismo motivo que `sw.js`, y esto **está
   * medido**: el 19/10/2026, contra producción, pedir `/cola/cualquier-cosa.js`
   * desde el registro de un service worker devolvía *«The script resource is
   * behind a redirect, which is disallowed»* —el 307 al login de acá abajo—.
   * `public/sw.js` importa de `/cola/colaOffline.js` y `/cola/idb.js` las
   * reglas de la cola de cargas sin señal, para que sean las mismas que corre
   * la pantalla; el navegador baja esos dos archivos cuando registra o
   * actualiza el worker, y si no cargan **el service worker entero no se
   * registra**: se van con él el push y la oferta de instalar. No es una
   * precaución. Son funciones de decisión: no leen la base, no tienen datos ni
   * secretos adentro.
   *
   * `/cargar` —la pantalla que se dibuja entera en el navegador para poder
   * cargar un aviso o una OT sin señal— **NO queda afuera, y eso es a
   * propósito**: con señal tiene que pedir sesión como cualquier otra pantalla.
   * No la necesita para dibujarse, pero sí para que lo que se cargue ahí llegue
   * a algún lado, y excluirla sólo lograría que alguien sin sesión la abriera,
   * cargara, y se quedara con la carga adentro del teléfono. Sin señal este
   * código no corre —no hay servidor— y la va a servir el service worker desde
   * el caché, que es la tarea 7 del plan.
   *
   * Cuidado con el regex: las alternativas van separadas por `|` y el punto
   * de los nombres con extensión se escapa con doble barra, porque esto es un
   * string JS y un `\.` a secas se evalúa como `.` y no escapa nada.
   */
  matcher: [
    "/((?!_next/static|_next/image|pdfjs|cola/|favicon.ico|manifest\\.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
