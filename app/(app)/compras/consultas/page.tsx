import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import ConsultasClient from "./ConsultasClient";

/**
 * Las preguntas que Mantenimiento le hizo a Compras por un repuesto.
 *
 * Esta página casi no hace nada a propósito: **la bandeja la trae
 * `GET /api/compras/consultas` y no un `select` de acá.** Qué preguntas siguen
 * esperando es una regla con varias puntas —las notas de cada orden, el estado de
 * esa orden, el repuesto que sigue en la lista— y el cliente tiene que volver a
 * pedirla después de cada respuesta. Leyéndola también acá habría dos lecturas que
 * tienen que decir lo mismo, y dos definiciones se separan sin avisar.
 *
 * Lo único que resuelve el servidor es **si esta persona puede abrir la OT**. El
 * enlace a la orden lleva a `/mantenimiento/ordenes`, cuyo layout manda a `/` a
 * quien no tenga ese módulo, y quien compra justamente no lo tiene: es la misma
 * razón por la que el atajo a Órdenes de servicio del menú de Compras está gateado
 * por `mantenimiento`. Un enlace que rebota es peor que no mostrarlo, así que
 * cuando no se puede abrir, la OT se nombra como texto.
 */
export default async function ConsultasPage() {
  const user = await usuarioActual();
  if (!user) redirect("/login");

  // El layout de Compras ya manda a /mis-pedidos a quien no tenga el módulo; esto es
  // la misma regla dicha donde se ejerce, como en el resto de las páginas de acá.
  const { tieneAcceso } = await permisosComprasActuales();
  if (!tieneAcceso) redirect("/mis-pedidos");

  const supabase = await createClient();
  const puedeAbrirLaOrden = await puedeVerMantenimiento(supabase, user.id);

  return <ConsultasClient puedeAbrirLaOrden={puedeAbrirLaOrden} />;
}
