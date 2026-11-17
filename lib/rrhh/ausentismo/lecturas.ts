import type { SupabaseClient } from "@supabase/supabase-js";
import { rangoDelMes } from "@/lib/core/fechas";
import { traerTodo } from "@/lib/core/paginado";
import type { AusenciaCruda } from "@/lib/mantenimiento/disponibilidad";
import { armarReportes } from "./armarReportes";
import { ausentesPublicos, type EmpleadoParaDisponibilidad } from "./disponibilidadPublica";
import type { EmpleadoDelReporte, HorasDeSector } from "./reportes";

/**
 * Las lecturas de la base detrás de `/api/disponibilidad` y de
 * `/api/disponibilidad/reportes`.
 *
 * Reciben el cliente **admin**: `ausencias` está cerrada con
 * `tiene_acceso_rrhh()` y las dos rutas están abiertas a gente que no lo
 * tiene. (`francos` no se lee acá: eso es de la programación del taller.) Con el cliente admin RLS no corre, así que el permiso lo comprueba la
 * ruta ANTES de llamar acá, y lo que sale de cada función es lo que puede
 * verse: la disponibilidad ya proyectada, los reportes sólo para quien pasó el
 * control.
 *
 * Viven acá y no en la ruta para poder ejercitarlas contra la base real desde
 * un script (`scripts/probar-rutas-de-disponibilidad.mts`): las rutas necesitan
 * una sesión, y lo que hay que comprobar —qué sale en el JSON— no depende de
 * ella.
 *
 * Todo lo que puede pasar de 1000 filas va por `traerTodo()`: PostgREST corta
 * ahí y no avisa. Y nada filtra con `.in()`, que con muchos ids arma una URL
 * que PostgREST rechaza con un 400 mudo.
 */

/** Una fecha que vino de la base, como `YYYY-MM-DD` pelado. Ver `soloElDia` de la programación. */
function soloElDia(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

/** El nombre del sector de un embed, que según la inferencia llega como objeto o como lista. */
function nombreDelSector(embed: unknown): string | null {
  const s = Array.isArray(embed) ? embed[0] : embed;
  const nombre = (s as { nombre?: unknown } | null | undefined)?.nombre;
  return typeof nombre === "string" ? nombre : null;
}

/**
 * TODOS los empleados, activos o no.
 *
 * No filtra por `activo` a propósito: alguien que se fue en agosto igual faltó
 * en marzo, y el reporte del año lo tiene que contar. Sin él sus ausencias
 * quedarían huérfanas y saldrían del número sin avisar.
 */
export async function leerEmpleados(db: SupabaseClient): Promise<EmpleadoDelReporte[]> {
  const filas = await traerTodo<{
    id: string;
    nombre: string;
    apellido: string;
    sector_id: string | null;
    sectores: unknown;
  }>((desde, hasta) =>
    db
      .from("empleados")
      .select("id, nombre, apellido, sector_id, sectores(nombre)")
      .order("id")
      .range(desde, hasta),
  );
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    apellido: f.apellido,
    sectorId: f.sector_id,
    sector: nombreDelSector(f.sectores),
  }));
}

/** Las ausencias que tocan el rango. Sólo cuatro columnas: `observaciones` ni se trae. */
async function leerAusencias(db: SupabaseClient, desde: string, hasta: string): Promise<AusenciaCruda[]> {
  const filas = await traerTodo<AusenciaCruda>((d, h) =>
    db
      .from("ausencias")
      .select("empleado_id, fecha_desde, fecha_hasta, tipo")
      .lte("fecha_desde", hasta)
      .gte("fecha_hasta", desde)
      .order("id")
      .range(d, h),
  );
  return filas.map((a) => ({
    empleado_id: a.empleado_id,
    fecha_desde: soloElDia(a.fecha_desde),
    fecha_hasta: soloElDia(a.fecha_hasta),
    tipo: a.tipo,
  }));
}

/**
 * Quién no viene en esos días, listo para mostrar a cualquiera: sin el motivo.
 * `dias` son los días ya validados y ordenados (ver `rangoPedido`).
 */
export async function leerDisponibilidad(db: SupabaseClient, dias: string[]) {
  const ausencias = await leerAusencias(db, dias[0], dias[dias.length - 1]);
  const empleados = (await leerEmpleados(db)).map<EmpleadoParaDisponibilidad>((e) => ({
    id: e.id,
    nombre: e.nombre,
    apellido: e.apellido,
    sector: e.sector,
  }));
  return { dias, ausentes: ausentesPublicos(ausencias, empleados, dias) };
}

/** Los feriados cargados, como fechas "YYYY-MM-DD". */
async function leerFeriados(db: SupabaseClient): Promise<string[]> {
  const filas = await traerTodo<{ fecha: string }>((d, h) =>
    db.from("feriados").select("fecha").order("fecha").range(d, h),
  );
  return filas.map((f) => soloElDia(f.fecha));
}

async function leerHoras(db: SupabaseClient): Promise<HorasDeSector[]> {
  const filas = await traerTodo<{
    sector_id: string;
    horas_por_empleado: number | string;
    desde: string;
    hasta: string | null;
  }>((d, h) =>
    db
      .from("rrhh_horas_a_realizar")
      .select("sector_id, horas_por_empleado, desde, hasta")
      .order("id")
      .range(d, h),
  );
  return filas.map((f) => ({
    sectorId: f.sector_id,
    // `numeric` llega como texto o como número según el driver.
    horasPorEmpleado: Number(f.horas_por_empleado),
    desde: soloElDia(f.desde),
    hasta: f.hasta === null ? null : soloElDia(f.hasta),
  }));
}

/**
 * Los tres reportes del mes `mes` ("YYYY-MM", ya validado) y sus avisos.
 *
 * Trae las ausencias desde el 1° de enero hasta el fin del mes: el anual las
 * necesita todas, y el mensual y el porcentual sólo las que tocan el mes, que
 * están dentro de ese rango. Una ausencia que empieza en diciembre y termina en
 * enero entra por su `fecha_hasta`.
 */
export async function leerReportes(db: SupabaseClient, mes: string) {
  const anio = mes.slice(0, 4);
  const { ultimoDia } = rangoDelMes(mes);
  const [ausencias, empleados, feriados, horas] = await Promise.all([
    leerAusencias(db, `${anio}-01-01`, ultimoDia),
    leerEmpleados(db),
    leerFeriados(db),
    leerHoras(db),
  ]);
  return armarReportes({ ausencias, empleados, feriados, horas, mes });
}
