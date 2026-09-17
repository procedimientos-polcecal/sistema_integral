export interface Notificacion {
  id: string;
  titulo: string;
  cantidad: number;
  href: string;
}

export interface DescarteNotificacion {
  notificacion_id: string;
  cantidad_vista: number;
}

/**
 * Saca del globo las notificaciones que el usuario ya descartó y que no
 * crecieron desde entonces. Si la cantidad actual superó a la que tenía al
 * descartarla, vuelve a mostrarse: hay casos nuevos que sí ameritan aviso.
 */
export function filtrarDescartadas(
  notificaciones: Notificacion[],
  descartes: DescarteNotificacion[]
): Notificacion[] {
  const vistaPorId = new Map(descartes.map((d) => [d.notificacion_id, d.cantidad_vista]));
  return notificaciones.filter((n) => {
    const vista = vistaPorId.get(n.id);
    return vista === undefined || n.cantidad > vista;
  });
}
