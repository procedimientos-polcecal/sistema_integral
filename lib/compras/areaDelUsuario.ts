/**
 * Con qué área arranca un pedido de material.
 *
 * El área la trae puesta quien pide, y **se puede cambiar**: lo que decide
 * quién ve el pedido en «Mis pedidos» es el área que quede, no la de quien lo
 * escribe, y alguien de Mantenimiento pidiendo algo para Producción es un caso
 * legítimo. Esto sólo elige con cuál empezar.
 *
 * Con más de una no se elige ninguna. La pantalla de administración permite
 * asignar varias, y adivinar cuál de dos es peor que preguntar: un área
 * equivocada no se nota —el pedido se guarda igual— y le esconde el
 * requerimiento justo a quien tenía que verlo.
 */
export function areaPorDefecto(areas: readonly string[]): string {
  const unicas = [...new Set(areas.map((a) => String(a ?? "").trim()).filter(Boolean))];
  return unicas.length === 1 ? unicas[0] : "";
}
