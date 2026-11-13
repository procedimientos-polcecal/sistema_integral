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
 * Las **familias** cuyo número tampoco cuenta cosas, nombradas por prefijo
 * porque sus ids no se pueden teclear: hay uno por módulo (`ritmo-`) y uno por
 * recurso del registro de salud (`salud-`), y las dos listas crecen solas.
 *
 *  - `ritmo-`: su cantidad son los umbrales enteros que lleva el módulo sin
 *    cargarse —`cantidadDelAviso` en `./ritmo.ts`—. «9 · Trituración: hace 36
 *    días que no se carga» no quiere decir nueve de nada.
 *  - `salud-`: su cantidad es cuánto hace que ese recurso viene mal —corridas
 *    fallidas seguidas, o tolerancias de silencio si dejó de correr; ver
 *    `cuantoLlevaMal` en `@/lib/core/saludDeLasSincronizaciones`—.
 */
const SIN_NUMERO_POR_PREFIJO = ["ritmo-", "salud-"] as const;

/**
 * Si el número de este aviso se puede **mostrar y sumar**.
 *
 * Son dos clases de número que no se muestran, y las dos por lo mismo: no
 * cuentan cosas. Un **reloj** —«20763», el día de la época— no significa nada
 * al lado de un título y sumado al total deja la campanita diciendo veinte mil;
 * y las **familias de `SIN_NUMERO_POR_PREFIJO`** llevan un número que existe
 * sólo para que `filtrarDescartadas` suelte el aviso. En las tres el título ya
 * es la frase completa.
 *
 * **Esto lo decidía el push solo, y por eso está acá.** `sinNumero`, en
 * `./resumenDeAvisos.ts`, callaba el ritmo y la salud mientras la campana
 * seguía dibujando esas insignias y sumándolas: antes el aporte de la salud a
 * la campana estaba acotado a 2 —`agenda-pasos-caidos`, dos pasos—, pero con un
 * aviso por recurso pasó a ser la suma de las rachas, y el 11/11/2026 eso le
 * ponía **+17** al ícono (8 de `carbonilla-odoo` más 9 de `molinos`) y un «8» y
 * un «9» al lado de dos títulos. Diecisiete de nada. Ahora el criterio se
 * escribe una vez y lo usan las dos superficies.
 */
export const suNumeroSeMuestra = (n: Notificacion) =>
  !CRECE_CON_EL_DIA.has(n.id) && !SIN_NUMERO_POR_PREFIJO.some((p) => n.id.startsWith(p));

/**
 * El número de la insignia del ícono de la campana.
 *
 * Suma las cantidades, **salvo las que no cuentan cosas, que cuentan como 1**.
 * No es un detalle: con 0 el total se iría a cero y la campana no dibujaría
 * insignia —se dibuja con `total > 0`—, así que el aviso de que **el vigilante
 * quedó ciego** quedaría invisible salvo que alguien abriera el panel. Entre un
 * número que miente y uno que no se ve, no se elige ninguno: el aviso existe y
 * vale 1.
 *
 * Con eso, la insignia vuelve a ser **cuántas cosas hay para mirar** y no la
 * suma de unas rachas: los dos recursos caídos del 11/11/2026 aportan 2 y no 17.
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
