/**
 * Un aviso del globo de la campana.
 *
 * **Este archivo es el único de `lib/home` que puede importar un componente de
 * cliente**, y esa es su responsabilidad: no importa nada —ni Supabase, ni
 * fechas, ni el registro de salud— así que `NotificationsBell` puede usarlo sin
 * arrastrarse medio sistema al bundle. Lo que las dos superficies tengan que
 * decidir igual va acá; ver `suNumeroSeMuestra`.
 */
export interface Notificacion {
  id: string;
  titulo: string;
  cantidad: number;
  href: string;
}

/**
 * Los avisos cuya `cantidad` es un **reloj**: crece sola con el paso del tiempo
 * y no cuenta ninguna cosa.
 *
 * Hoy es uno: `salud-sin-comprobar`, cuyo número es el día de la época —20.763
 * el 05/11/2026— y existe sólo para que descartarlo dure una jornada (ver
 * `elDiaComoNumero` en `./avisos.ts`). No hay de dónde sacarle una racha,
 * porque lo que falló es justamente la lectura.
 *
 * Vive acá y no en `./avisos.ts` por el párrafo de arriba: **lo necesitan las
 * dos superficies**, el push y la campana, y la campana no puede importar
 * `avisos.ts`.
 */
export const CRECE_CON_EL_DIA: ReadonlySet<string> = new Set(["salud-sin-comprobar"]);

/**
 * Si el número de este aviso se puede **mostrar y sumar**.
 *
 * Un reloj no: «20763» al lado de un título no significa nada, y sumado al
 * total de la campanita la deja diciendo veinte mil. Lo escribió la campana una
 * vez y el push otra, hasta que el push aprendió a callarlo y la campana no
 * —son dos superficies que comen lo mismo de `avisosDeSalud`—; por eso ahora el
 * criterio está acá, en un solo lugar, y lo usan las dos.
 *
 * **Es el piso y no el techo.** `sinNumero`, en `./resumenDeAvisos.ts`, calla
 * además los de ritmo y los de salud, que tampoco cuentan cosas; la campana
 * todavía muestra esas insignias y cambiarlo es otra decisión, que se toma
 * sustituyendo esta función allá.
 */
export const suNumeroSeMuestra = (n: Notificacion) => !CRECE_CON_EL_DIA.has(n.id);

/**
 * El número de la insignia del ícono de la campana.
 *
 * Suma las cantidades, **salvo las que son un reloj, que cuentan como 1**. No
 * es un detalle: con 0 el total se iría a cero y la campana no dibujaría
 * insignia —se dibuja con `total > 0`—, así que el aviso de que **el vigilante
 * quedó ciego** quedaría invisible salvo que alguien abriera el panel. Entre un
 * número que miente y uno que no se ve, no se elige ninguno: el aviso existe y
 * vale 1.
 *
 * Vive acá, y no en el JSX de `NotificationsBell`, porque es una decisión y las
 * decisiones se prueban.
 */
export function totalDeLaCampana(avisos: Notificacion[]): number {
  return avisos.reduce((total, n) => total + (suNumeroSeMuestra(n) ? n.cantidad : 1), 0);
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
