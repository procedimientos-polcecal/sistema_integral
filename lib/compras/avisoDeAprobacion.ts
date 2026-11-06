import { createAdminClient } from "@/lib/supabase/admin";
import {
  avisarAQuienDecide,
  type ItemQueEspera,
  type ResultadoDelAviso,
} from "@/lib/core/avisoAlInstante";

/**
 * El aviso al instante de Compras, en un solo lugar.
 *
 * ── POR QUÉ ESTO NO VIVE EN `sheets.ts` ──────────────────────────────────────
 *
 * Porque **`lib/compras/sheets.ts` termina en el bundle del cliente**. El
 * camino es `SeguimientoClient.tsx` → `lib/compras/seguimiento.ts` →
 * `empresaParaPlanilla`, que es una función pura que vive ahí: importarla
 * arrastra el módulo entero. El ciclo está documentado a propósito en el
 * encabezado de `sheets.ts` y hoy funciona.
 *
 * Lo que no sobrevive a ese viaje es `web-push`, que es sólo de Node y depende
 * de `https-proxy-agent`. Poner el envío adentro de `sheets.ts` hace fallar
 * `next build` con un `Module not found` en la página de Seguimiento — y lo
 * importante es que **ni `tsc` ni los tests lo ven**: los dos pasan en verde.
 * Es la misma clase de rotura que `revisar-arbol-commiteado` busca por el otro
 * lado.
 *
 * Así que la sincronización sólo **calcula** quiénes nacieron esperando y los
 * devuelve; avisar es trabajo de las rutas, que no las importa ningún
 * componente de cliente. Las cuatro que lo hacen —el cron, el webhook, el
 * botón de sincronizar y el alta desde la app— pasan por acá para que el texto
 * y la lista de destinatarios sean uno solo.
 */
export async function avisarDeLosPedidosQueEsperan(
  items: ItemQueEspera[],
  /** Quien lo cargó, cuando lo cargó una persona: no se le avisa de lo suyo. */
  excepto: string | null = null
): Promise<ResultadoDelAviso> {
  return avisarAQuienDecide(createAdminClient(), {
    lista: "compras_aprobadores",
    items,
    nombre: { singular: "Un pedido", plural: "pedidos" },
    url: "/compras/aprobaciones",
    excepto,
  });
}
