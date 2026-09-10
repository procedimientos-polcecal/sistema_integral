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
   * `pdfjs` queda afuera: es el worker de pdf.js que Facturación baja para
   * rasterizar un PDF y buscarle el QR. Son 1,2 MB de un paquete público, así
   * que no hay nada que proteger, y hacerlo pasar por acá tendría dos costos: un
   * `getUser()` contra Supabase por cada carga, y —si por cualquier motivo la
   * cookie no viajara en el pedido del Worker— un 307 al login que del lado del
   * navegador aparece como un error opaco de pdf.js, justo en medio de la carga
   * de una factura.
   */
  matcher: [
    "/((?!_next/static|_next/image|pdfjs|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
