/**
 * Lo que la tarjeta de RRHH del Inicio decide mostrar, sin tocar la base ni la
 * pantalla: las dos cosas que se pueden equivocar —cuánta gente cuenta como
 * presente, y qué número va de titular— son puras y se prueban acá.
 */

/** Lo que `/api/home/resumen` contesta para RRHH. */
export interface ResumenRrhh {
  empleadosActivos: number;
  /** Último día hábil con fichadas ("YYYY-MM-DD"), o `null` si no hay ninguno. */
  dia: string | null;
  diaLegible: string | null;
  ausentes: number;
  sinClasificar: number;
  /**
   * Empleados activos con al menos una fichada de hoy.
   *
   * `null` es "no se pudo leer `fichadas`", y **no es lo mismo que 0**: el 0 dice
   * "todavía no entró ninguna marcación" y el `null` dice "no sé". La tarjeta
   * muestra lo mismo en los dos casos —el titular de siempre—, pero sólo el 0
   * se anuncia como un hecho.
   */
  presentesHoy: number | null;
}

export interface TarjetaRrhh {
  hero: { label: string; valor: string | number };
  secundarias: { label: string; valor: string | number }[];
}

/**
 * Cuántos de los activos marcaron hoy.
 *
 * Cuenta **empleados distintos** y no fichadas: quien sale a almorzar y vuelve
 * tiene dos filas y es una persona. Y sólo cuenta a los activos: una baja con una
 * marca suelta haría "69 de 68", que es un número que nadie sabe leer.
 */
export function contarPresentes(
  empleadoIdsConFichadaHoy: readonly string[],
  idsActivos: Iterable<string>
): number {
  const activos = new Set(idsActivos);
  const presentes = new Set<string>();
  for (const id of empleadoIdsConFichadaHoy) {
    if (activos.has(id)) presentes.add(id);
  }
  return presentes.size;
}

/** "42 de 68". */
export function presentesDeTotal(presentes: number, total: number): string {
  return `${presentes} de ${total}`;
}

/**
 * Qué muestra la tarjeta de RRHH.
 *
 * **El titular es adaptativo y no es un capricho.** "Presentes hoy" es un
 * conteo que *crece* —12 a las 7, 55 a las 9— y cada valor es verdadero a su
 * hora, así que sirve desde la primera marcación. Pero antes de la primera no
 * hay nada que decir: un "0 de 68" a las 6 de la mañana, o mientras la
 * integración con Lenox no está activada, leería como "no vino nadie", que es
 * una conclusión y no un hecho. Entonces, **sin marcaciones de hoy** el titular
 * vuelve a ser el de antes, "Ausentes el <día>", que mira un día ya cerrado.
 *
 * Nunca se muestra "0 de N" como titular, justamente para que cero marcaciones
 * no se lea como cero presentes. Esa diferencia se dice con palabras en una
 * secundaria ("Marcaciones de hoy: Ninguna todavía"), salvo que `presentesHoy`
 * sea `null`: ahí no se sabe, y no se afirma nada.
 *
 * Cuando el titular pasa a ser los presentes, "Ausentes el <día>" baja a
 * secundaria: no se pierde ningún dato que antes se veía.
 */
export function armarTarjetaRrhh(r: ResumenRrhh): TarjetaRrhh {
  const ausentesDelDia = {
    label: r.diaLegible ? `Ausentes el ${r.diaLegible}` : "Sin fichadas importadas",
    valor: r.diaLegible ? r.ausentes : "—",
  };

  if (r.presentesHoy !== null && r.presentesHoy > 0) {
    return {
      hero: { label: "Presentes hoy", valor: presentesDeTotal(r.presentesHoy, r.empleadosActivos) },
      // `empleadosActivos` ya está dentro del titular ("de 68"). "Sin clasificar"
      // sigue siendo del día de referencia, no de hoy: se nombra, porque al lado
      // del titular nuevo se leería como de hoy.
      secundarias: [
        ausentesDelDia,
        { label: r.diaLegible ? `Sin clasificar el ${r.diaLegible}` : "Sin clasificar", valor: r.sinClasificar },
      ],
    };
  }

  const secundarias: TarjetaRrhh["secundarias"] = [
    { label: "Empleados activos", valor: r.empleadosActivos },
    { label: "Sin clasificar", valor: r.sinClasificar },
  ];
  if (r.presentesHoy === 0) {
    secundarias.push({ label: "Marcaciones de hoy", valor: "Ninguna todavía" });
  }
  return { hero: ausentesDelDia, secundarias };
}
