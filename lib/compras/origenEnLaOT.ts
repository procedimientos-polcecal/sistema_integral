/**
 * De qué orden de trabajo nació un requerimiento, ya resuelto para la pantalla.
 *
 * El RI guarda sólo `ot_id` y `ot_repuesto_id`; lo demás se lee de la orden y
 * de su renglón de repuesto. Que un RI recuerde su origen **no dice que el
 * repuesto se haya aplicado**: eso es otra pregunta.
 */
export type OrigenEnLaOT = {
  ot_number: number | null;
  descripcion: string | null;
  equipo_raw: string | null;
  repuesto_nombre: string | null;
};

/**
 * La línea «OT #2983 · Molino 2 · «Cambio de rodamiento»».
 *
 * Devuelve null sin número de OT: las columnas son `on delete set null`, así
 * que el RI sobrevive a la orden y mostrar «OT #» con el resto vacío sería una
 * línea que no dice nada. El nombre del repuesto no entra acá: va en una
 * segunda línea de la pantalla.
 */
export function textoDelOrigen(origen: OrigenEnLaOT | null): string | null {
  if (!origen || origen.ot_number == null) return null;
  const partes = [`OT #${origen.ot_number}`];
  const equipo = origen.equipo_raw?.trim();
  if (equipo) partes.push(equipo);
  const descripcion = origen.descripcion?.trim();
  if (descripcion) partes.push(`«${descripcion}»`);
  return partes.join(" · ");
}
