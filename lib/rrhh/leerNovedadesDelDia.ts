import type { SupabaseClient } from "@supabase/supabase-js";
import { traerPaginado } from "./paginado";
import { instanteDeArgentina, sumarDias } from "@/lib/core/fechas";
import {
  cuantasSon,
  cuantosRenglones,
  juntarAusentesDelDia,
  repartirAusentesDelDia,
  repartirVacacionesYAusencias,
  soloLoQueCorrespondeAlDia,
  type AusentePorHoy,
  type NovedadesDelDia,
} from "./novedadesDelDia";

/**
 * Las novedades de un día, leídas de la base.
 *
 * ## Por qué vive acá y no adentro del cron
 *
 * Porque ahora hay **dos** caminos que mandan el mismo correo: el automático de
 * las 15:50 y el botón de `/rrhh/correo-novedades`, donde una persona elige a
 * quién mandárselo. Si cada uno armara sus consultas, la vista previa podría
 * mostrar algo distinto de lo que después sale, y eso es peor que no tener
 * vista previa: enseña a no creerle.
 *
 * Lo que decide **si** el correo sale sigue estando en cada ruta, que es lo
 * único en lo que se diferencian: el cron no manda nada si no hubo
 * movimientos, y el botón manda lo que haya porque alguien lo apretó.
 *
 * ## Las cinco consultas, y por qué son cinco
 *
 * Las tres primeras preguntan **qué se movió hoy** —ausencias, vacaciones y
 * francos por `created_at`, en hora de Argentina— y las dos últimas **quién no
 * viene hoy**, sin mirar cuándo se cargó. Son preguntas distintas y por eso no
 * se pueden juntar: una licencia de 29 días se cargó una sola vez y hace falta
 * los 29. El porqué de que «quién no viene» necesite dos tablas está en la
 * decisión 7 de `novedadesDelDia.ts`.
 */

/** Lo que trae un día, listo para armar el correo. */
export interface LoDelDia {
  dia: string;
  /** Lo que se cargó ese día y todavía corresponde: es lo que dispara el correo. */
  movimientos: NovedadesDelDia;
  empiezanOTerminan: AusentePorHoy[];
  siguenAusentes: AusentePorHoy[];
  cuenta: {
    ausencias: number;
    vacaciones: number;
    francosTomados: number;
    francosGenerados: number;
    /** Cuántas se leyeron y no se informan porque ya habían terminado. */
    sinInformarPorSerPasado: number;
  };
  /** De dónde salió cada ausente, para poder mirarlo sin consultar de nuevo. */
  ausentes: { deAusencias: number; deVacaciones: number };
}

const EMPLEADO = "empleados(apellido, nombre, legajo)";

type Fila = Record<string, unknown>;

/**
 * PostgREST devuelve un embed como objeto o como arreglo de uno según cómo
 * resuelva la cardinalidad; se aceptan las dos formas, como en el resto del
 * módulo.
 */
const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function leerNovedadesDelDia(
  db: SupabaseClient,
  dia: string
): Promise<LoDelDia> {
  // El día de Argentina en instantes reales, que es con lo que se compara un
  // `timestamptz`. El límite de arriba es `lt` y no `lte`: la medianoche del
  // día siguiente ya es del día siguiente.
  const desde = instanteDeArgentina(`${dia}T00:00`);
  const hasta = instanteDeArgentina(`${sumarDias(dia, 1)}T00:00`);

  const [ausencias, vacaciones, francos, ausentesDelDia, vacacionesEnCurso] = await Promise.all([
    traerPaginado(
      () =>
        db
          .from("ausencias")
          .select(`id, fecha_desde, fecha_hasta, tipo, justificada, observaciones, ${EMPLEADO}, usuarios:cargado_por_id(nombre, apellido)`)
          .gte("created_at", desde)
          .lt("created_at", hasta)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
      "ausencias del día"
    ),
    traerPaginado(
      () =>
        db
          .from("vacaciones")
          .select(`id, fecha_desde, fecha_hasta, dias_tomados, anio_correspondiente, ausencia_id, ${EMPLEADO}`)
          .gte("created_at", desde)
          .lt("created_at", hasta)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
      "vacaciones del día"
    ),
    // Los francos entran por dos puertas distintas y por eso se traen en una
    // sola consulta: `created_at` dice cuáles generó hoy el recálculo, y
    // `fecha_tomado` cuáles marcó hoy una persona. Un mismo franco puede
    // cumplir las dos —se generó y se tomó el mismo día— y entonces vale la
    // segunda, que es la que hizo alguien.
    traerPaginado(
      () =>
        db
          .from("francos")
          .select(`id, fecha_generado, fecha_tomado, horas, created_at, ${EMPLEADO}`)
          .or(`and(created_at.gte.${desde},created_at.lt.${hasta}),fecha_tomado.eq.${dia}`)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
      "francos del día"
    ),
    // Los que no vienen HOY, se haya cargado su ausencia cuando se haya
    // cargado. Las dos últimas consultas son las únicas que no miran
    // `created_at`.
    traerPaginado(
      () =>
        db
          .from("ausencias")
          .select(`id, fecha_desde, fecha_hasta, tipo, ${EMPLEADO}`)
          .lte("fecha_desde", dia)
          .gte("fecha_hasta", dia)
          .order("fecha_desde", { ascending: true })
          .order("id", { ascending: true }),
      "ausentes del día"
    ),
    // Y la segunda puerta: un período de vacaciones abierto. Hace falta porque
    // 20 de los 41 no tienen ausencia y por lo tanto no están en la consulta de
    // arriba de ninguna forma (decisión 7). El `ausencia_id` no es dato del
    // correo: es lo que después evita contar dos veces al mismo.
    traerPaginado(
      () =>
        db
          .from("vacaciones")
          .select(`id, fecha_desde, fecha_hasta, ausencia_id, ${EMPLEADO}`)
          .lte("fecha_desde", dia)
          .gte("fecha_hasta", dia)
          .order("fecha_desde", { ascending: true })
          .order("id", { ascending: true }),
      "vacaciones en curso"
    ),
  ]);

  const tomados = (francos as Fila[]).filter((f) => f.fecha_tomado === dia);
  const generados = (francos as Fila[]).filter((f) => f.fecha_tomado !== dia);

  // Una licencia cargada como vacaciones deja DOS filas —la ausencia y el
  // período— y el reparto decide cuál se escribe, para que no salga dos veces.
  const repartidas = repartirVacacionesYAusencias(
    (ausencias as Fila[]).map((a) => {
      const quien = uno(a.usuarios as { nombre?: string; apellido?: string } | null);
      return {
        id: a.id as string,
        empleado: uno(a.empleados as never),
        fecha_desde: a.fecha_desde as string,
        fecha_hasta: a.fecha_hasta as string,
        tipo: a.tipo as string,
        justificada: a.justificada as boolean,
        observaciones: a.observaciones as string | null,
        cargadaPor: quien ? [quien.nombre, quien.apellido].filter(Boolean).join(" ") : null,
      };
    }),
    (vacaciones as Fila[]).map((v) => ({
      empleado: uno(v.empleados as never),
      fecha_desde: v.fecha_desde as string,
      fecha_hasta: v.fecha_hasta as string,
      dias_tomados: v.dias_tomados as number,
      anio_correspondiente: v.anio_correspondiente as number,
      ausencia_id: (v.ausencia_id as string | null) ?? null,
    }))
  );

  const leidas: NovedadesDelDia = {
    ausencias: repartidas.ausencias,
    vacaciones: repartidas.vacaciones,
    francosTomados: tomados.map((f) => ({
      empleado: uno(f.empleados as never),
      fecha_generado: f.fecha_generado as string,
      fecha_tomado: f.fecha_tomado as string,
      horas: f.horas as number,
    })),
    francosGenerados: generados.map((f) => ({
      empleado: uno(f.empleados as never),
      fecha_generado: f.fecha_generado as string,
      horas: f.horas as number,
    })),
    empiezanOTerminan: [],
    siguenAusentes: [],
  };

  // Lo que se cargó hoy pero ya había terminado no se informa (decisión 4).
  const movimientos = soloLoQueCorrespondeAlDia(leidas, dia);

  const { empiezanOTerminan, siguenAusentes } = repartirAusentesDelDia(
    juntarAusentesDelDia(
      (ausentesDelDia as Fila[]).map((a) => ({
        id: a.id as string,
        empleado: uno(a.empleados as never),
        fecha_desde: a.fecha_desde as string,
        fecha_hasta: a.fecha_hasta as string,
        tipo: a.tipo as string,
      })),
      (vacacionesEnCurso as Fila[]).map((v) => ({
        empleado: uno(v.empleados as never),
        fecha_desde: v.fecha_desde as string,
        fecha_hasta: v.fecha_hasta as string,
        ausencia_id: (v.ausencia_id as string | null) ?? null,
      }))
    ),
    dia
  );

  return {
    dia,
    movimientos,
    empiezanOTerminan,
    siguenAusentes,
    cuenta: {
      ausencias: movimientos.ausencias.length,
      vacaciones: movimientos.vacaciones.length,
      francosTomados: movimientos.francosTomados.length,
      francosGenerados: movimientos.francosGenerados.length,
      sinInformarPorSerPasado: cuantasSon(leidas) - cuantasSon(movimientos),
    },
    ausentes: {
      deAusencias: (ausentesDelDia as Fila[]).length,
      deVacaciones: (vacacionesEnCurso as Fila[]).length,
    },
  };
}

/** Cuántos renglones de cada cosa entran. Por encima, el correo dice cuántos quedaron afuera. */
export const TOPE_POR_SECCION = 60;

/**
 * Recorta cada sección al tope y dice cuántos renglones quedaron sin listar.
 *
 * El tope es por sección y no por correo, así que una sección larga —50 francos
 * marcados tomados el mismo día, que ya pasó— no puede tapar a las otras.
 */
export function recortarParaElCorreo(lo: LoDelDia): {
  /**
   * Todo lo del día en un solo objeto y sin recortar. Es con lo que se arma el
   * **asunto**, y no con `movimientos`: ahí las dos listas de presencia van
   * vacías, así que un día sin movimientos pero con gente afuera salía diciendo
   * «sin novedades» con dos personas de licencia adentro del cuerpo. Sin
   * recortar porque el asunto cuenta cuántas hay, no cuántas se listaron.
   */
  conPresencia: NovedadesDelDia;
  recortadas: NovedadesDelDia;
  quedaronAfuera: number;
} {
  const conPresencia: NovedadesDelDia = {
    ...lo.movimientos,
    empiezanOTerminan: lo.empiezanOTerminan,
    siguenAusentes: lo.siguenAusentes,
  };
  const recortadas: NovedadesDelDia = {
    ausencias: conPresencia.ausencias.slice(0, TOPE_POR_SECCION),
    vacaciones: conPresencia.vacaciones.slice(0, TOPE_POR_SECCION),
    francosTomados: conPresencia.francosTomados.slice(0, TOPE_POR_SECCION),
    francosGenerados: conPresencia.francosGenerados.slice(0, TOPE_POR_SECCION),
    empiezanOTerminan: conPresencia.empiezanOTerminan.slice(0, TOPE_POR_SECCION),
    siguenAusentes: conPresencia.siguenAusentes.slice(0, TOPE_POR_SECCION),
  };
  // Con `cuantasSon` —que cuenta sólo movimientos— un recorte de las secciones
  // de presencia no se informaba: se cortaban en silencio.
  return {
    conPresencia,
    recortadas,
    quedaronAfuera: cuantosRenglones(conPresencia) - cuantosRenglones(recortadas),
  };
}
