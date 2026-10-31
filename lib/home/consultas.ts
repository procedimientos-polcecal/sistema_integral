import type { SupabaseClient } from "@supabase/supabase-js";
import { sumarDias } from "@/lib/core/fechas";
import { traerTodo } from "@/lib/core/paginado";
import { createAdminClient } from "@/lib/supabase/admin";
import { ultimoDiaHabilConFichadas } from "@/lib/rrhh/diaHabil";
import {
  preguntasQueEsperan, TIPOS_QUE_DECIDEN_SI_UNA_PREGUNTA_ESPERA,
} from "@/lib/compras/consultas";
import type { NotaDeLaOT } from "@/lib/mantenimiento/consultaDeRepuesto";
import { contarPresentes } from "./tarjetaRrhh";
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
 * Cuántos empleados activos tienen al menos una fichada de **hoy**, o `null` si
 * no se pudo leer.
 *
 * Sale de `fichadas` y no de `calculos_diarios`: el cálculo del día se llena
 * recién cuando el día cierra, y las fichadas existen desde la primera marca.
 * Por qué acá "hoy" sí sirve —y para "ausentes" no— está en `resumenRrhh`.
 *
 * Un día son del orden de 120 filas, pero se pagina igual: PostgREST corta en
 * 1000 sin avisar y la tabla no tiene por qué seguir siendo chica. Y con
 * `.range()` el `order` no es cosmético: sin un orden determinístico, las
 * páginas pueden repetir o saltear filas. `id` es único, así que alcanza.
 *
 * Un error devuelve `null` y no tira: esta función corre dentro del `Promise.all`
 * del Inicio, y un rechazo apagaría todas las tarjetas, no sólo ésta.
 */
export async function traerPresentesDeHoy(
  supabase: SupabaseClient,
  hoy: string,
  idsActivos: readonly string[]
): Promise<number | null> {
  try {
    const filas = await traerTodo<{ empleado_id: string }>((desde, hasta) =>
      supabase
        .from("fichadas")
        .select("empleado_id")
        .eq("fecha", hoy)
        .order("id", { ascending: true })
        .range(desde, hasta)
    );
    return contarPresentes(filas.map((f) => f.empleado_id), idsActivos);
  } catch (e) {
    console.error("inicio: no se pudieron leer las fichadas de hoy:", e instanceof Error ? e.message : e);
    return null;
  }
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

/** De a cuántos ids se pide: un `.in()` con muchos arma una URL que PostgREST rechaza. */
const LOTE = 200;

/**
 * Cuántas preguntas de Mantenimiento a Compras siguen esperando respuesta.
 *
 * ── POR QUÉ NO ES UN `count … head` ──────────────────────────────────────────
 *
 * Es la decisión de este conteo, y la única razón de que ocupe cuarenta renglones
 * en vez de uno. «Pregunta abierta» es una **anti-unión** —una PREGUNTA sin
 * RESPUESTA que la apunte, sin otra PREGUNTA que la supere, con la OT todavía
 * esperando y el repuesto todavía en la lista— y PostgREST no la sabe expresar.
 * Escribirla en SQL sería una **segunda definición de «abierta»**, separada de la
 * que tiene los tests en `lib/mantenimiento/consultaDeRepuesto.ts`: exactamente el
 * error del 27 escrito en dos lugares que el GUT documenta, pero sin el test que
 * allá ata las dos copias. Y las dos copias no se separarían de golpe: lo haría la
 * primera vez que alguien agregue algo que cierra una pregunta y toque sólo el
 * TypeScript, porque es el único que tiene tests.
 *
 * Así que se traen las candidatas y se cuenta con `preguntasQueEsperan`, que es la
 * misma función que arma la bandeja de `/compras/consultas`: el número del aviso y
 * la lista que se abre al tocarlo no pueden decir cosas distintas.
 *
 * ── POR QUÉ CON EL CLIENTE ADMIN, Y NO CON EL QUE LE PASAN A `avisosDeLosModulos` ─
 *
 * Porque las dos tablas que esto lee son de **Mantenimiento** y el aviso es de
 * **Compras**. `ordenes_trabajo_notas` y `ordenes_trabajo` tienen su `select`
 * cerrado con `mant_puede_ver()`, así que con la sesión de quien contesta la
 * lectura vuelve vacía —**sin error**— y el conteo da 0.
 *
 * No es hipotético: medido el 31/10/2026 contra producción, Facundo Ortiz —el
 * encargado de compras, la persona para la que existe este aviso— tiene
 * `compras:edicion`, `inventario:edicion`, `facturacion:edicion` y `remises:lectura`,
 * y **nada de Mantenimiento**. Con el cliente de sesión, su campana diría que no
 * hay nada mientras el push del cron —que corre con el admin— le dice que hay tres.
 * Los dos salen de `avisosDeUsuario()` justamente para que no puedan decir cosas
 * distintas.
 *
 * Esto no abre nada que no estuviera abierto: `/api/compras/consultas` ya lee las
 * mismas filas con el admin para cualquiera que tenga Compras, y el conteo sale
 * sólo para quien tiene el módulo (`avisosDeLosModulos`) y le llega sólo a quien
 * está en `compras_consultados` (`sinLoQueNoPuedeAtender`).
 *
 * ── QUÉ SE LEE Y QUÉ NO ──────────────────────────────────────────────────────
 *
 * El historial entero no: sólo PREGUNTA y RESPUESTA, que es lo único que puede
 * abrir o cerrar una pregunta. Las órdenes, sólo las de las notas que vinieron, y
 * de a lotes de 200. Las dos lecturas van con `traerTodo` porque PostgREST corta en
 * 1000 filas sin avisar, y un conteo que se topa con el tope miente **hacia abajo**:
 * un aviso que dice 1.000 cuando son 1.200 sigue sonando razonable.
 *
 * El `select` de las notas trae la fila entera que declara `NotaDeLaOT` —`texto` y
 * `creado_por` incluidos, que acá no se miran— y no una versión recortada: recortarlo
 * pediría un cast, y un cast es justo lo que el compilador no puede revisar. Las
 * columnas sin las que esto se equivoca en silencio las comprueba
 * `lib/mantenimiento/selectsDeLasNotas.test.ts`, leyendo este archivo.
 *
 * ── UN FALLO DEVUELVE 0 Y SE ANOTA ───────────────────────────────────────────
 *
 * No es la decisión cómoda: un 0 por un fallo se lee igual que «no hay nada que
 * contestar». Es la que ya tomaron `traerRitmo` y `traerPresentesDeHoy` acá arriba,
 * y acá pesa más que allá: este conteo corre dentro del `Promise.all` de
 * `avisosDeLosModulos`, que a su vez corre **una vez por persona adentro del cron
 * del resumen diario**. Un rechazo no apagaría un aviso: apagaría la campana entera
 * y el push de todo el mundo, y dejaría sin guardar la foto del día —con lo que el
 * movimiento de mañana se calcularía contra la de anteayer—.
 */
export async function consultasDeRepuestosAbiertas(): Promise<number> {
  const admin = createAdminClient();

  try {
    const notas = (await traerTodo((desde, hasta) =>
      admin
        .from("ordenes_trabajo_notas")
        .select("id, orden_id, tipo, texto, creado_en, creado_por, repuesto_id, responde_a")
        .in("tipo", [...TIPOS_QUE_DECIDEN_SI_UNA_PREGUNTA_ESPERA])
        .range(desde, hasta)
    )) as unknown as (NotaDeLaOT & { orden_id: string })[];

    const idsDeOrdenes = [...new Set(notas.map((n) => n.orden_id))];
    const ordenes: { id: string; estado: string | null }[] = [];
    for (let i = 0; i < idsDeOrdenes.length; i += LOTE) {
      const lote = idsDeOrdenes.slice(i, i + LOTE);
      ordenes.push(
        ...((await traerTodo((desde, hasta) =>
          admin.from("ordenes_trabajo").select("id, estado").in("id", lote).range(desde, hasta)
        )) as unknown as { id: string; estado: string | null }[])
      );
    }

    return preguntasQueEsperan(notas, ordenes).length;
  } catch (e) {
    console.error(
      "inicio: no se pudieron contar las consultas de repuestos:",
      e instanceof Error ? e.message : e
    );
    return 0;
  }
}
