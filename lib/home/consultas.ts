import type { SupabaseClient } from "@supabase/supabase-js";
import { sumarDias } from "@/lib/core/fechas";
import { traerTodo } from "@/lib/core/paginado";
import { ultimoDiaHabilConFichadas } from "@/lib/rrhh/diaHabil";
import type { FilaRitmo } from "./ritmo";

/**
 * Las filas de la vista de ritmo.
 *
 * La vista puede no existir todavía —es DDL y la aplica una persona— o estar
 * tapada por RLS. En los dos casos se devuelve vacío y el ritmo queda sin datos:
 * el mismo trato que tiene un módulo al que no se tiene acceso. Tirar acá
 * dejaría la campana muda en todas las páginas del sistema.
 */
export async function traerRitmo(supabase: SupabaseClient): Promise<FilaRitmo[]> {
  const { data, error } = await supabase
    .from("inicio_ritmo_modulos")
    .select("modulo, ultima_fecha, dias_sin_cargar, hueco_max");
  if (error) {
    console.error("inicio: no se pudo leer inicio_ritmo_modulos:", error.message);
    return [];
  }
  return (data ?? []) as FilaRitmo[];
}

/**
 * Qué día mira RRHH: el último hábil con fichadas importadas.
 *
 * El porqué de las condiciones está en `lib/rrhh/diaHabil.ts`. Se mira una
 * ventana de 60 días hacia atrás y no toda la historia: alcanza de sobra —el
 * corte más largo medido fue de cinco meses, y después de 60 días sin fichadas
 * el problema no es qué muestra la tarjeta— y evita traer 17.000 filas.
 *
 * **El `order` de las fichadas no es cosmético.** PostgREST corta en 1000 filas
 * y no avisa. Sin `order`, devuelve las primeras 1000 de la ventana, que son las
 * más viejas: medido contra producción, 1000 de 2.795 filas y una fecha máxima
 * de 2026-08-27 cuando la verdadera es 2026-09-30. La tarjeta diría «Ausentes el
 * jue 27/08» con un número de cinco semanas atrás: plausible y falso. De la más
 * nueva a la más vieja, las 1000 que llegan son las recientes (unos 15 días
 * distintos, de sobra para saltear uno o dos domingos y un feriado).
 */
export async function diaDeReferenciaRrhh(
  supabase: SupabaseClient,
  hoy: string
): Promise<string | null> {
  const desde = sumarDias(hoy, -60);
  const [{ data: fichadas }, { data: feriados }] = await Promise.all([
    supabase
      .from("fichadas")
      .select("fecha")
      .gte("fecha", desde)
      .lt("fecha", hoy)
      .order("fecha", { ascending: false }),
    supabase.from("feriados").select("fecha").gte("fecha", desde).lte("fecha", hoy),
  ]);
  return ultimoDiaHabilConFichadas(
    (fichadas ?? []).map((f) => f.fecha as string),
    (feriados ?? []).map((f) => f.fecha as string),
    hoy
  );
}

/**
 * Las ausencias sin clasificar del día de referencia, no las de hoy.
 *
 * Contar las de hoy daba 0 catorce días seguidos mientras el día anterior tenía
 * 64: a media mañana `calculos_diarios` está a medias.
 */
export async function sinClasificarDelUltimoDiaHabil(
  supabase: SupabaseClient,
  hoy: string
): Promise<number> {
  const dia = await diaDeReferenciaRrhh(supabase, hoy);
  if (!dia) return 0;

  const { data: empleados } = await supabase.from("empleados").select("id").eq("activo", true);
  const ids = (empleados ?? []).map((e) => e.id as string);
  if (ids.length === 0) return 0;

  const { count } = await supabase
    .from("calculos_diarios")
    .select("id", { count: "exact", head: true })
    .in("empleado_id", ids)
    .eq("fecha", dia)
    .eq("ausente", true)
    .is("justificada", null);
  return count ?? 0;
}

/**
 * Cuántos equipos de Taller Vial no tienen **ningún** service registrado, y
 * cuántos equipos hay en total.
 *
 * Vive acá porque lo necesitan las dos rutas del Inicio —`/api/home/resumen`
 * para la tarjeta y `/api/home/avisos` para la campana—, y un `route.ts` del
 * App Router sólo puede exportar los handlers HTTP: un helper exportado desde
 * ahí rompe el build.
 *
 * Los equipos de Taller Vial son los de `equipos` con código EM* activos: el
 * módulo no tiene catálogo propio (ver `traerEquiposTallerVial` en
 * `lib/tallerVial/consultas.ts`).
 *
 * Los `equipo_id` de los services se traen con `traerTodo()` y no con un
 * `select` pelado: hoy la tabla tiene una sola fila, pero si este indicador
 * funciona va a crecer, y PostgREST corta en 1000 filas sin avisar.
 */
export async function equiposTallerVialSinService(
  supabase: SupabaseClient
): Promise<{ equiposSinService: number; equiposTotal: number }> {
  const [{ data: equipos }, services] = await Promise.all([
    supabase.from("equipos").select("id").ilike("code", "EM%").eq("is_active", true),
    traerTodo<{ equipo_id: string | null }>((desde, hasta) =>
      supabase.from("taller_vial_services").select("equipo_id").range(desde, hasta)
    ),
  ]);

  const conService = new Set(services.map((s) => s.equipo_id).filter(Boolean));
  const ids = (equipos ?? []).map((e) => e.id as string);
  return {
    equiposSinService: ids.filter((id) => !conService.has(id)).length,
    equiposTotal: ids.length,
  };
}
