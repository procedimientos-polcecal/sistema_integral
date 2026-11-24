/**
 * Cuántas veces paró cada sector y cuánto tiempo estuvo fuera de servicio.
 *
 * Es el resumen por sector de lo que `historialDeSectores.ts` resuelve por
 * fila: `conPermanencia()` cruza cada cambio con el siguiente del mismo sector
 * para saber cuánto duró el estado que dejó puesto, y esto lo suma.
 *
 * ── LO QUE HAY QUE SABER ANTES DE DIBUJAR ESTO ───────────────────────────
 *
 * **La tabla está casi vacía y eso no es un error.** Medido el 19/11/2026,
 * `sectores_status_log` tiene **3 filas**, la más vieja del 12/11: una parada
 * cerrada de Trituración 2 que duró 4 días y una de Hidratación abierta ese
 * mismo día. Por eso lo que devuelve esto no alimenta ningún gráfico de doce
 * meses —dibujaría once meses planos y haría creer que la planta no para
 * nunca— y por eso devuelve `desde`: la pantalla tiene que poder decir desde
 * cuándo se registra, con la fecha de la base y no escrita a mano, para no
 * prometer una historia que todavía no existe. El día que haya un año de
 * datos, ese renglón deja de llamar la atención solo.
 *
 * **«Fuera de servicio» suma `PARADA` y `EN_REPARACION`**, igual que
 * `resumirHistorial()`: desde el lado de producción las dos son lo mismo —la
 * planta no produce— y separarlas daría dos números que nadie suma de cabeza.
 * La diferencia entre una y otra se ve en la fila del historial.
 *
 * **El estado abierto cuenta hasta ahora.** Si Hidratación está parada desde
 * hace cuatro días, esos cuatro días son parte de la cuenta: dejarlos afuera
 * haría que el número bajara justo cuando hay una planta parada, que es
 * cuando se mira.
 */
import {
  conPermanencia, type CambioDeSector, type CambioConPermanencia,
} from "./historialDeSectores";

export interface ParadaDeSector {
  /** `null` cuando el sector se borró y la fila quedó huérfana. */
  sectorId: string | null;
  /** Cómo se llama, o «Sector sin nombre» si ni eso quedó. */
  sector: string;
  /** Cuántas veces pasó a un estado distinto de ACTIVA. */
  veces: number;
  fueraDeServicioMs: number;
  /**
   * Desde cuándo está parado **ahora**, o `null` si está activo.
   *
   * Es el `changed_at` del último cambio, y sólo cuando ese último dejó al
   * sector fuera de servicio. Sirve para que la pantalla diga «parada desde el
   * martes» en vez de «paró una vez».
   */
  paradoDesde: string | null;
}

/** Un cambio que deja al sector sin producir. */
const estaFueraDeServicio = (estado: string): boolean => estado !== "ACTIVA";

export function paradasPorSector(
  cambios: CambioDeSector[],
  ahoraIso: string
): { sectores: ParadaDeSector[]; desde: string | null } {
  if (cambios.length === 0) return { sectores: [], desde: null };

  const conDuracion = conPermanencia(cambios, ahoraIso);

  // Una fila huérfana no se junta con las demás: su `sector_id` es null y dos
  // null no son el mismo sector. Es la misma clave que usa `conPermanencia`.
  const claveDe = (c: CambioConPermanencia) => c.sector_id ?? `huerfana:${c.id}`;

  const porSector = new Map<string, CambioConPermanencia[]>();
  for (const c of conDuracion) {
    const clave = claveDe(c);
    const suyos = porSector.get(clave) ?? [];
    suyos.push(c);
    porSector.set(clave, suyos);
  }

  const sectores: ParadaDeSector[] = [...porSector.values()].map((suyos) => {
    // El último en el tiempo es el que dice cómo está ahora, y el desempate por
    // `id` existe por lo mismo que el de `conPermanencia`: dos cambios pueden
    // compartir marca de tiempo y dos corridas tienen que devolver lo mismo.
    // **No es la misma comparación**: allá es `localeCompare` y acá `>`. Con
    // los UUID que escribe la base coinciden, pero si alguna vez hiciera falta
    // que las dos ordenaran igual de verdad, hay que unificarlas.
    const ultimo = suyos.reduce((max, c) =>
      Date.parse(c.changed_at) > Date.parse(max.changed_at) ||
      (c.changed_at === max.changed_at && c.id > max.id)
        ? c
        : max
    );
    const paradas = suyos.filter((c) => estaFueraDeServicio(c.new_status));

    return {
      sectorId: ultimo.sector_id,
      sector: ultimo.sector ?? "Sector sin nombre",
      veces: paradas.length,
      fueraDeServicioMs: paradas.reduce((a, c) => a + c.duracionMs, 0),
      paradoDesde: estaFueraDeServicio(ultimo.new_status) ? ultimo.changed_at : null,
    };
  });

  sectores.sort(
    (a, b) => b.fueraDeServicioMs - a.fueraDeServicioMs || a.sector.localeCompare(b.sector)
  );

  const desde = cambios.reduce(
    (min, c) => (c.changed_at < min ? c.changed_at : min),
    cambios[0].changed_at
  );

  return { sectores, desde };
}
