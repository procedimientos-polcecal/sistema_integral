import { diaDeLaSemana } from "@/lib/core/fechas";

/**
 * Las cuatro tarjetas de arriba del dashboard de RRHH, sin tocar la base ni la
 * pantalla: qué cuenta como presente, ausente, tarde o de vacaciones, y cómo se
 * escribe cada una. Es todo puro para poder probarlo; las consultas están en
 * `resumenHoy.ts` y las comparten la pantalla y la ruta de los filtros.
 *
 * LA REGLA QUE ORDENA LAS CUATRO
 *
 * Un conteo que **suma** desde cada marcación sirve a media mañana; una
 * conclusión que necesita el día cerrado, no. Es la misma que ya aplican la
 * tarjeta del Inicio (`lib/home/tarjetaRrhh.ts`) y `resumenRrhh` en
 * `app/api/home/resumen/route.ts`, y viene de la misma cicatriz: el 06/10/2026
 * "Ausentes hoy" decía 1 porque `calculos_diarios` tenía 2 filas de 68.
 *
 *   - Presentes: `fichadas` de hoy. Alguien marcó o no marcó; cada marca suma.
 *   - Tardanzas: se sabe en el momento de fichar, así que también es de hoy.
 *     Pero sale de `calculos_diarios.tarde`, que sólo existe si el día se
 *     recalculó: ver `ResumenHoy.tardes`.
 *   - Vacaciones: la tabla `vacaciones`; no depende de que alguien fiche.
 *   - Ausentes: "ausente" es una conclusión, y a las 08:07 nadie sabe si el que
 *     no marcó va a llegar a las 12 o a las 20 (el turno Tarde entra a las
 *     12:00 y el Noche a las 20:00). Se mira el último día hábil con fichadas.
 *
 * Antes `presentes = activos − ausentes`. Daba bien sólo porque la
 * sincronización con Lenox había recalculado a los 68 para hoy; sin recálculo,
 * `calculos_diarios` queda vacía, los ausentes dan 0 y la tarjeta diría 68
 * presentes, 100%, a las siete de la mañana.
 */

export type ClaveTarjeta = "presentes" | "ausentes" | "tardes" | "vacaciones";

export interface ResumenHoy {
  /** "YYYY-MM-DD" en Argentina: el día al que se refieren presentes, tardes y vacaciones. */
  hoy: string;
  totalActivos: number;
  /**
   * Activos con al menos una marcación hoy. `null` es "no se pudo leer
   * `fichadas`", y **no es lo mismo que 0**: el 0 dice "todavía no marcó nadie"
   * y el `null` dice "no sé".
   */
  presentes: number | null;
  ausentes: {
    /**
     * Ausentes del `dia`. `null` si no hay día de referencia o ese día no tiene
     * cálculo: "—", nunca un 0 que se lea como "no faltó nadie".
     */
    cantidad: number | null;
    /** Último día hábil con fichadas ("YYYY-MM-DD"), o `null` si no hay ninguno. */
    dia: string | null;
  };
  tardes: {
    /** Con tardanza por el reloj o cargada a mano, contados una sola vez. */
    cantidad: number;
    /** Activos que tienen fila de hoy en `calculos_diarios`. 0 = no se calculó el día. */
    calculados: number;
    /**
     * Activos que marcaron hoy pero cuya fila no lo refleja (no hay fila, o dice
     * `ausente`): el cálculo es anterior a su marca. Si llegó tarde, todavía no
     * figura. Es lo que distingue "cero tardanzas" de "cero hasta el último
     * recálculo".
     */
    sinCalcular: number;
    /** Tardanzas cargadas a mano, que no dependen del cálculo. */
    manuales: number;
  };
  vacaciones: number;
}

/** Lo que leyeron las consultas, tal cual, para que `clasificarHoy` decida. */
export interface DatosDeHoy {
  /** Los empleados que entran en el tablero (activos, con los filtros ya aplicados). */
  empleadoIds: readonly string[];
  /** `empleado_id` de cada fichada de hoy (con repetidos); `null` si no se pudo leer. */
  fichadasHoy: readonly string[] | null;
  calculosHoy: readonly { empleado_id: string; ausente: boolean; tarde: boolean }[];
  tardanzasManualesIds: readonly string[];
  vacacionesIds: readonly string[];
  /** Último día hábil con fichadas, o `null`. */
  dia: string | null;
  calculosDia: readonly { empleado_id: string; ausente: boolean }[];
}

/** Quién cae en cada tarjeta. La ruta del detalle necesita las personas, no sólo el número. */
export interface ClasificacionHoy {
  presentes: Set<string> | null;
  ausentes: Set<string>;
  tardes: Set<string>;
  vacaciones: Set<string>;
  dia: string | null;
  calculados: number;
  sinCalcular: number;
  manuales: number;
  /** Cuántos empleados del tablero tienen fila en `calculos_diarios` el `dia`. */
  calculadosDelDia: number;
}

/**
 * Reparte a los empleados entre las cuatro tarjetas.
 *
 * Todo se cruza en memoria con `empleadoIds` en vez de pasarle la lista a
 * PostgREST con un `.in()`: con muchos ids la URL se pasa de largo y vuelve un
 * 400 sin explicación. Y es lo que mantiene los dos caminos —la carga inicial y
 * los filtros de empresa y sector— iguales: el filtro sólo cambia quién está en
 * `empleadoIds`.
 */
export function clasificarHoy(d: DatosDeHoy): ClasificacionHoy {
  const permitidos = new Set(d.empleadoIds);
  const esPermitido = (id: string) => permitidos.has(id);

  const presentes = d.fichadasHoy === null ? null : new Set(d.fichadasHoy.filter(esPermitido));

  const calculoDeHoy = new Map<string, { ausente: boolean; tarde: boolean }>();
  for (const c of d.calculosHoy) if (esPermitido(c.empleado_id)) calculoDeHoy.set(c.empleado_id, c);

  const manuales = new Set(d.tardanzasManualesIds.filter(esPermitido));
  // Un empleado puede figurar tarde por el reloj y además tener una tardanza
  // cargada a mano: se cuenta una vez.
  const tardes = new Set<string>(manuales);
  for (const [id, c] of calculoDeHoy) if (c.tarde) tardes.add(id);

  // Marcó, pero el cálculo no se enteró: no hay fila o la fila lo da por ausente.
  // Si no se pudo leer `fichadas` no hay forma de saberlo, y se queda en 0.
  let sinCalcular = 0;
  if (presentes) {
    for (const id of presentes) {
      const c = calculoDeHoy.get(id);
      if (!c || c.ausente) sinCalcular++;
    }
  }

  const ausentes = new Set<string>();
  let calculadosDelDia = 0;
  for (const c of d.calculosDia) {
    if (!esPermitido(c.empleado_id)) continue;
    calculadosDelDia++;
    if (c.ausente) ausentes.add(c.empleado_id);
  }

  return {
    presentes,
    ausentes,
    tardes,
    vacaciones: new Set(d.vacacionesIds.filter(esPermitido)),
    dia: d.dia,
    calculados: calculoDeHoy.size,
    sinCalcular,
    manuales: manuales.size,
    calculadosDelDia,
  };
}

export function armarResumenHoy(hoy: string, totalActivos: number, c: ClasificacionHoy): ResumenHoy {
  return {
    hoy,
    totalActivos,
    presentes: c.presentes ? c.presentes.size : null,
    ausentes: {
      // Un día con fichadas pero sin una sola fila de cálculo no tiene ausentes:
      // no tiene nada calculado, que es otra cosa.
      cantidad: c.dia && c.calculadosDelDia > 0 ? c.ausentes.size : null,
      dia: c.dia,
    },
    tardes: {
      cantidad: c.tardes.size,
      calculados: c.calculados,
      sinCalcular: c.sinCalcular,
      manuales: c.manuales,
    },
    vacaciones: c.vacaciones.size,
  };
}

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "2026-10-10" → "sáb 10/10". Sin año: el día de referencia nunca es de hace más de dos meses. */
export function diaCorto(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${DIAS[diaDeLaSemana(iso)]} ${d}/${m}`;
}

/** 33.8 → "33,8%". */
export function comoPorcentaje(cantidad: number, total: number): string {
  const p = total > 0 ? Math.round((cantidad / total) * 1000) / 10 : 0;
  return `${String(p).replace(".", ",")}%`;
}

export interface TarjetaHoy {
  clave: ClaveTarjeta;
  label: string;
  valor: string | number;
  sub: string | undefined;
}

/**
 * Cómo se escribe cada tarjeta.
 *
 * **Dónde NO se muestra un número.** Cuando el dato no existe la tarjeta dice
 * "—" y por qué, no 0: cero tardanzas y "todavía no se calculó" son cosas
 * distintas, y también lo son cero presentes y "no pude leer las marcaciones".
 *
 * **Los ausentes no llevan porcentaje.** Los de otro día no se pueden dividir
 * por los activos de hoy sin mentir: el padrón de aquel día pudo ser otro, y
 * además los sábados sólo cuentan los que tenían que trabajar, así que "4 de
 * 68" daría un 5,9% que no es el ausentismo de nadie. En su lugar, la tarjeta
 * dice de qué día es.
 */
export function armarTarjetasHoy(r: ResumenHoy): TarjetaHoy[] {
  const presentes: TarjetaHoy =
    r.presentes === null
      ? { clave: "presentes", label: "Presentes", valor: "—", sub: "No se pudieron leer las marcaciones" }
      : {
          clave: "presentes",
          label: "Presentes",
          valor: r.presentes,
          sub: r.presentes === 0 ? "Sin marcaciones todavía" : comoPorcentaje(r.presentes, r.totalActivos),
        };

  let ausentes: TarjetaHoy;
  if (r.ausentes.dia === null) {
    ausentes = { clave: "ausentes", label: "Ausentes", valor: "—", sub: "Sin fichadas importadas" };
  } else if (r.ausentes.cantidad === null) {
    ausentes = { clave: "ausentes", label: "Ausentes", valor: "—", sub: `Sin cálculo del ${diaCorto(r.ausentes.dia)}` };
  } else {
    ausentes = { clave: "ausentes", label: "Ausentes", valor: r.ausentes.cantidad, sub: `el ${diaCorto(r.ausentes.dia)}` };
  }

  const t = r.tardes;
  let tardes: TarjetaHoy;
  if (t.calculados === 0) {
    // Las manuales sí se saben sin cálculo: se nombran, pero no se hacen pasar
    // por el total.
    tardes = {
      clave: "tardes",
      label: "Tardes",
      valor: "—",
      sub: t.manuales > 0 ? `Sin calcular todavía · ${t.manuales} cargadas a mano` : "Todavía no se calculó el día",
    };
  } else {
    const pct = comoPorcentaje(t.cantidad, r.totalActivos);
    tardes = {
      clave: "tardes",
      label: "Tardes",
      valor: t.cantidad,
      sub: t.sinCalcular > 0 ? `${pct} · ${t.sinCalcular} marcaciones sin calcular` : pct,
    };
  }

  const vacaciones: TarjetaHoy = {
    clave: "vacaciones",
    label: "Vacaciones",
    valor: r.vacaciones,
    sub: comoPorcentaje(r.vacaciones, r.totalActivos),
  };

  return [presentes, ausentes, tardes, vacaciones];
}

/** El título del detalle que abre cada tarjeta: el de los ausentes nombra su día. */
export function tituloDeDetalle(clave: ClaveTarjeta, r: ResumenHoy): string {
  switch (clave) {
    case "presentes":
      return "Presentes hoy";
    case "ausentes":
      return r.ausentes.dia ? `Ausentes el ${diaCorto(r.ausentes.dia)}` : "Ausentes";
    case "tardes":
      return "Tardanzas hoy";
    case "vacaciones":
      return "Vacaciones hoy";
  }
}
