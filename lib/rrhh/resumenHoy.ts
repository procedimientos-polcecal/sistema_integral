import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { traerTodo } from "@/lib/core/paginado";
import { diaDeReferenciaRrhh } from "@/lib/home/consultas";
import { empleadosPermitidos, type EmpleadoDashboard } from "./dashboardHelpers";
import {
  armarResumenHoy,
  clasificarHoy,
  type ClasificacionHoy,
  type DatosDeHoy,
  type ResumenHoy,
} from "./tarjetasHoy";

export type { ResumenHoy } from "./tarjetasHoy";

/**
 * Lee una lista completa y, si falla, devuelve `fallo` en vez de tirar.
 *
 * Esto corre en el Server Component del dashboard: una excepción acá deja toda la
 * pantalla en un 500, y los gráficos de más abajo no tienen la culpa. Y devolver
 * una lista vacía sin decirlo, como hacía el `data ?? []` de antes, era mentir —
 * por eso cada llamador elige qué significa fallar: para las marcaciones, `null`
 * ("no sé"); para el resto, vacío, que la tarjeta ya lee como "sin calcular".
 */
async function leer<T, F>(etiqueta: string, fallo: F, pagina: Parameters<typeof traerTodo<T>>[0]): Promise<T[] | F> {
  try {
    return await traerTodo<T>(pagina);
  } catch (e) {
    console.error(`rrhh/dashboard: no se pudo leer ${etiqueta}:`, e instanceof Error ? e.message : e);
    return fallo;
  }
}

/**
 * Todo lo que necesitan las cuatro tarjetas y el detalle que abre cada una, leído
 * una sola vez y clasificado por la misma función pura.
 *
 * Es el único camino: lo llaman el Server Component de la pantalla, la ruta de
 * API que vuelve a pedir los números cuando cambian los filtros de empresa y
 * sector, y la del detalle. Si las dos mitades hicieran su propia cuenta, el
 * número de la tarjeta y la lista que abre dejarían de coincidir.
 *
 * Nada de lo que se lee acá va con `.in(empleado_id, …)`: cada tabla se pide por
 * fecha y se cruza en memoria (ver `clasificarHoy`). Son del orden de 70 a 120
 * filas por día, pero se pagina igual —con `order`, que con `.range()` no es
 * cosmético— porque PostgREST corta en 1000 sin avisar.
 */
export async function calcularHoy(
  supabase: SupabaseClient,
  filtros: { empresaId?: string | null; sectorId?: string | null } = {}
): Promise<{ hoy: string; empleados: EmpleadoDashboard[]; clasificacion: ClasificacionHoy; resumen: ResumenHoy }> {
  // Argentina y no UTC: Vercel corre en UTC, y desde las 21:00 argentinas un
  // `new Date().toISOString()` ya es mañana — toda la noche el tablero miraba un
  // día que no empezó. Es la misma fecha que usa el Inicio.
  const hoy = hoyEnArgentina();

  const [empleados, dia, fichadasHoy, calculosHoy, tardanzasManuales, vacaciones] = await Promise.all([
    empleadosPermitidos(supabase, filtros),
    diaDeReferenciaRrhh(supabase, hoy),
    leer<{ empleado_id: string }, null>("las marcaciones de hoy", null, (desde, hasta) =>
      supabase.from("fichadas").select("empleado_id").eq("fecha", hoy).order("id", { ascending: true }).range(desde, hasta)
    ),
    leer<{ empleado_id: string; ausente: boolean; tarde: boolean }, never[]>("el cálculo de hoy", [], (desde, hasta) =>
      supabase
        .from("calculos_diarios")
        .select("empleado_id, ausente, tarde")
        .eq("fecha", hoy)
        .order("id", { ascending: true })
        .range(desde, hasta)
    ),
    leer<{ empleado_id: string }, never[]>("las tardanzas cargadas a mano", [], (desde, hasta) =>
      supabase
        .from("ausencias")
        .select("empleado_id")
        .eq("tipo", "TARDANZA")
        .lte("fecha_desde", hoy)
        .gte("fecha_hasta", hoy)
        .order("id", { ascending: true })
        .range(desde, hasta)
    ),
    leer<{ empleado_id: string }, never[]>("las vacaciones de hoy", [], (desde, hasta) =>
      supabase
        .from("vacaciones")
        .select("empleado_id")
        .lte("fecha_desde", hoy)
        .gte("fecha_hasta", hoy)
        .order("id", { ascending: true })
        .range(desde, hasta)
    ),
  ]);

  // Los ausentes son del día de referencia y no de hoy, así que se leen aparte:
  // dependen de cuál salió.
  const calculosDia = dia
    ? await leer<{ empleado_id: string; ausente: boolean }, never[]>("el cálculo del día de referencia", [], (desde, hasta) =>
        supabase
          .from("calculos_diarios")
          .select("empleado_id, ausente")
          .eq("fecha", dia)
          .order("id", { ascending: true })
          .range(desde, hasta)
      )
    : [];

  const datos: DatosDeHoy = {
    empleadoIds: empleados.map((e) => e.id),
    fichadasHoy: fichadasHoy ? fichadasHoy.map((f) => f.empleado_id) : null,
    calculosHoy,
    tardanzasManualesIds: tardanzasManuales.map((a) => a.empleado_id),
    vacacionesIds: vacaciones.map((v) => v.empleado_id),
    dia,
    calculosDia,
  };
  const clasificacion = clasificarHoy(datos);
  return { hoy, empleados, clasificacion, resumen: armarResumenHoy(hoy, empleados.length, clasificacion) };
}

/**
 * Las cuatro tarjetas de arriba del dashboard: presentes, ausentes, tardanzas y
 * vacaciones. Qué mira cada una y por qué está en `tarjetasHoy.ts`.
 *
 * Vive acá y no dentro de la ruta de API para que la pueda llamar también el
 * Server Component de la pantalla. Así el HTML del dashboard llega con los
 * cuatro números adentro, en vez de llegar vacío y pedirlos por fetch recién
 * cuando el navegador terminó de hidratar. Es lo primero que se ve, así que es
 * donde más se nota.
 *
 * La ruta de API sigue existiendo porque los filtros de empresa y sector
 * vuelven a pedir estos números sin recargar la página.
 */
export async function calcularResumenHoy(
  supabase: SupabaseClient,
  filtros: { empresaId?: string | null; sectorId?: string | null } = {}
): Promise<ResumenHoy> {
  return (await calcularHoy(supabase, filtros)).resumen;
}
