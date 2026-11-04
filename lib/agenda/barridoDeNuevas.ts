import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { esCandidataAlCalendario } from "./candidata";
import { mandarLaOTAlCalendario } from "./mandarLaOT";
import type { PresupuestoDeGoogle } from "./elEventoSigueALaOT";

/**
 * Después de cada sincronización de las órdenes, toda OT con fecha de ejecución
 * de hoy en adelante, no cerrada y **sin evento**, entra sola al calendario.
 * Es la quinta puerta de `alNacerLaOT`, y la que cubre lo que las otras cuatro
 * no pueden ver: las órdenes que llegan por el formulario de Google (629 de
 * cada 780 en 90 días, medido el 04/11/2026).
 *
 * ── POR QUÉ UN BARRIDO Y NO UN ENGANCHE AL ALTA ─────────────────────────────
 *
 * El importador hace un `upsert` de la planilla entera y **no distingue un alta
 * de una actualización**: no hay un «OT nueva» donde colgar esto. Y aunque lo
 * hubiera, no alcanzaría: **el 73,6 % de las órdenes se cargan al revés** (su
 * fecha de ejecución es anterior a la de creación), así que lo corriente no es
 * una OT que nace con fecha futura sino **una que ya existía y a la que
 * alguien le pone o le corre la fecha hacia adelante en la planilla**. El
 * barrido nocturno no la rescata, porque `seguirALasOT` sólo mueve eventos que
 * ya existen. Éste sí: no mira cuándo nació la orden sino qué le falta.
 *
 * **Eso también lo vuelve la red de las cuatro puertas de `alNacerLaOT`**:
 * un `!ok` de ahí no persiste nada y se tolera porque esta pasada toma
 * *cualquier* OT candidata sin evento. Si algún día esta consulta deja de ser
 * «todas las que no tienen evento», esa tolerancia se va con ella.
 *
 * ── LAS DOS DE LA MISMA ESPECIALIDAD EN UNA MISMA PASADA ────────────────────
 *
 * Se manda **de a una y en orden**, y cada una cuenta la base antes de elegir
 * su hora (`mandarLaOTAlCalendario` lo hace sola). Lo que se escribió hace un
 * momento **ya está en la base** cuando se cuenta la siguiente —cada llamada a
 * PostgREST es su propia transacción y vuelve confirmada—, así que dos
 * mecánicas del mismo día salen a las 08:00 y a las 09:30 sin que nadie lleve
 * la cuenta aparte.
 *
 * **Por eso no hay nada que adelantar.** La cuenta sale de la base y la base ya
 * tiene la fila anterior: el bucle no corre dentro de una transacción, así que
 * el insert de la primera orden está confirmado cuando la segunda lee. Una
 * versión anterior de `mandarLaOTAlCalendario` aceptaba además un mapa de
 * «huecos ya tomados en esta corrida» para sumarlo a esa cuenta, pensado para
 * este barrido; se sacó porque **cuenta cada orden dos veces** y apila 08:00,
 * 11:00, 14:00 en vez de 08:00, 09:30, 11:00 —medido contra una base en memoria
 * que muestra lo recién insertado, que es como se porta la de verdad—. Es el
 * tipo de error que no rompe nada: los eventos entran, sólo que con un hueco de
 * 1:30 detrás de cada uno. Los tests «dos de la misma especialidad…» y «tres
 * seguidas…» lo fijan: si alguien reintroduce el adelanto, fallan.
 *
 * ── EL TOPE: 25 POR CORRIDA ──────────────────────────────────────────────────
 *
 * Se crean ~8,7 OT por día (780 en 90 días), de las que **pocas** tienen fecha
 * futura. Veinticinco deja pasar cualquier día normal con holgura y corta una
 * pegada de una columna entera de fechas en la planilla, que de otro modo
 * sería una ráfaga de eventos: **cada uno invita a cinco personas**, o sea
 * cinco correos por orden. Lo que el tope deja afuera no se pierde: sigue sin
 * evento y entra en la corrida siguiente. Y se va por **fecha ascendente**, así
 * que si corta, corta lo más lejano, que es lo que menos apura.
 *
 * **El tope cuenta eventos creados, no intentos.** Acota lo que de verdad le
 * llega a la gente —las invitaciones—, y un intento fallido no manda ninguna.
 * Contando intentos, 25 órdenes con un fallo permanente (por ejemplo, sin
 * usuario activo para su casilla) agotarían el tope en cada corrida y dejarían
 * sin intentar a todas las demás, para siempre.
 *
 * ── LO QUE ACOTA EL TIEMPO ES EL PRESUPUESTO, NO EL TOPE ─────────────────────
 *
 * Con los fallos fuera de la cuenta, el tope ya no limita cuántas llamadas se
 * hacen a Google. Eso lo limita el tiempo de Google que se reparte entre las
 * sincronizaciones (`presupuestoDeGoogle`), que se mira **antes** de empezar
 * cada orden: con Google caído el barrido intenta unas pocas, agota su tramo y
 * corta, en vez de recorrer todas las candidatas. Son dos guardianes de dos
 * cosas distintas, y ninguno reemplaza al otro.
 *
 * ── NUNCA FALLA LA SINCRONIZACIÓN ────────────────────────────────────────────
 *
 * No lanza: todo lo que sale mal queda en `fallos` y quien llama lo suma al
 * informe de la corrida.
 *
 * `quedaron` junta lo que cortó el tope y lo que cortó el tiempo: para quien
 * lee el informe es lo mismo —no entró todavía—, y la causa se deduce del
 * número (cuando es el tope, `creados` es igual a 25). **Cuenta candidatas sin
 * intentar**: las que se intentaron y fallaron están en `fallos`, no acá.
 *
 * Una advertencia de `mandarLaOTAlCalendario` (el evento quedó pendiente en
 * Google, comparte las 20:00 por el tope del día) **no se cuenta acá**: las dos
 * quedan persistidas en el evento mismo (`google_pendiente` y `aviso`), que es
 * donde las lee la Agenda y donde las levanta el cron de pendientes.
 */
export const TOPE_POR_CORRIDA = 25;

interface OrdenLeida {
  id: string;
  ot_number: number | null;
  fecha_ejecucion: string | null;
  fecha_ejecucion_pendiente: string | null;
  fecha_cierre: string | null;
  estado: string | null;
  especialidad: string | null;
}

export interface LoQueBarrio {
  creados: number;
  /** Candidatas que no se intentaron en esta pasada, por el tope o por el tiempo. */
  quedaron: number;
  fallos: string[];
  /**
   * Órdenes sin evento cuya fecha no se pudo leer, con el motivo. **No es un
   * fallo del barrido** (no pone la corrida en rojo). **Hoy esta lista no puede
   * llenarse con datos reales**: las dos columnas de fecha son `date` en
   * Postgres (`005_mantenimiento_schema.sql` y
   * `20261029111915_periodicas_y_postergacion.sql`), que devuelve siempre
   * `AAAA-MM-DD`, así que una fecha ilegible no llega desde la base. Está
   * porque `esCandidataAlCalendario` es pura y la rechaza, y un rechazo que
   * nadie nombra es una OT que desaparece sin una palabra: es un guardián, no un
   * caso observado. Las otras dos que no entran —cerrada sin fecha de cierre y
   * sin fecha— son lo normal y **no se listan**: en cada corrida serían el
   * ruido que hace que nadie mire el informe.
   *
   * **El riesgo de verdad con las fechas sucias está aguas arriba**: una celda
   * mal escrita en el master no llega al barrido, hace fallar el `upsert`
   * entero de las ~2.300 órdenes cuando el importador la manda. Eso es ruidoso
   * —la sincronización falla y se registra—, pero es otro problema, anotado
   * aparte, y esta lista no lo cubre.
   */
  fechasIlegibles: string[];
}

export async function barrerLasQueFaltan(
  admin: SupabaseClient,
  ahora: Date,
  tope: number = TOPE_POR_CORRIDA,
  presupuesto?: PresupuestoDeGoogle
): Promise<LoQueBarrio> {
  const r: LoQueBarrio = { creados: 0, quedaron: 0, fallos: [], fechasIlegibles: [] };
  const hoy = hoyEnArgentina(ahora);

  // Dos lecturas y no un `or`: la fecha que cuenta es la pendiente cuando la
  // hay, así que una orden puede ser futura por cualquiera de las dos columnas.
  // El servidor sólo recorta (hoy en adelante, sin fecha de cierre) y decide
  // `esCandidataAlCalendario` más abajo, que es la misma función que usan las
  // otras puertas.
  const leerOrdenes = (columna: "fecha_ejecucion" | "fecha_ejecucion_pendiente") =>
    traerTodo<OrdenLeida>((desde, hasta) =>
      admin
        .from("ordenes_trabajo")
        // La cadena va literal y en una sola pieza: partida con `+` pierde la
        // inferencia de tipos de Supabase.
        .select("id, ot_number, fecha_ejecucion, fecha_ejecucion_pendiente, fecha_cierre, estado, especialidad")
        .gte(columna, hoy)
        .is("fecha_cierre", null)
        .order("id")
        .range(desde, hasta)
        .returns<OrdenLeida[]>()
    );

  let ordenes: OrdenLeida[];
  let conEvento: Set<string>;
  try {
    const [porEjecucion, porPendiente, eventos] = await Promise.all([
      leerOrdenes("fecha_ejecucion"),
      leerOrdenes("fecha_ejecucion_pendiente"),
      // Todos los `ot_id` y no sólo los de hoy en adelante: el evento de una
      // orden puede estar en cualquier día. Si esta lectura fallara, no se
      // crea nada —sin saber cuáles tienen evento se duplicarían—.
      traerTodo<{ ot_id: string }>((desde, hasta) =>
        admin
          .from("agenda_eventos")
          .select("ot_id")
          .not("ot_id", "is", null)
          .order("id")
          .range(desde, hasta)
          .returns<{ ot_id: string }[]>()
      ),
    ]);
    ordenes = [...new Map([...porEjecucion, ...porPendiente].map((o) => [o.id, o])).values()];
    conEvento = new Set(eventos.map((e) => e.ot_id));
  } catch (e) {
    r.fallos.push(`No se pudo leer qué órdenes faltan en el calendario: ${(e as Error).message}`);
    return r;
  }

  // Por fecha ascendente, y a igual fecha por número de OT, para que la corrida
  // sea la misma si se repite con los mismos datos.
  const faltan = ordenes
    .filter((o) => !conEvento.has(o.id))
    .flatMap((o) => {
      const c = esCandidataAlCalendario(o, hoy);
      if (c.ok) return [{ orden: o, fecha: c.fecha }];
      // Sólo la fecha ilegible se nombra; el resto de los rechazos es lo normal.
      if (c.fechaIlegible) r.fechasIlegibles.push(`OT ${o.ot_number ?? o.id}: ${c.motivo}`);
      return [];
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.orden.ot_number ?? 0) - (b.orden.ot_number ?? 0));

  let intentadas = 0;
  for (const { orden } of faltan) {
    // El tope mira lo creado y el tiempo lo mira el presupuesto: ver el encabezado.
    if (r.creados >= tope || presupuesto?.agotado()) break;
    intentadas++;
    const numero = orden.ot_number ?? orden.id;
    try {
      const m = await mandarLaOTAlCalendario(
        admin, orden.id, { turno: null, invitadosExtra: [], pisar: false }, ahora
      );
      if (m.ok) r.creados++;
      else r.fallos.push(`OT ${numero}: ${m.error}`);
    } catch (e) {
      r.fallos.push(`OT ${numero}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  r.quedaron = faltan.length - intentadas;
  return r;
}

/**
 * Lo que de un barrido hay que dejar en el registro de `sincronizaciones`, o
 * `null` si no hay nada que decir. Misma forma que `loQueSeAnotaDeLosEventos`.
 * **Con `fallos` la corrida sale en rojo; con sólo `quedaron` o
 * `fechasIlegibles`, no**: lo que se difiere o un dato roto de la planilla no
 * es un fallo del barrido, pero el texto queda escrito.
 */
export function loQueSeAnotaDelBarrido(b: LoQueBarrio): { ok: boolean; error: string } | null {
  const partes: string[] = [];
  if (b.fallos.length > 0) partes.push(`Órdenes que no entraron al calendario: ${b.fallos.join(" | ")}`);
  if (b.fechasIlegibles.length > 0) {
    partes.push(`Órdenes con la fecha ilegible, que no entran al calendario hasta que se corrija en la planilla: ${b.fechasIlegibles.join(" | ")}`);
  }
  if (b.quedaron > 0) {
    partes.push(`Quedaron ${b.quedaron} órdenes sin entrar al calendario (tope por corrida o tiempo de Google); entran en la próxima`);
  }
  return partes.length === 0 ? null : { ok: b.fallos.length === 0, error: partes.join(". ") };
}

/**
 * Junta dos anotaciones de la misma corrida en una sola: `registrarSincronizacion`
 * guarda **una** por corrida, y la segunda pisaría a la primera. Sale en rojo si
 * alguna lo está.
 */
export function juntarLoAnotado(
  ...anotaciones: ({ ok: boolean; error: string } | null)[]
): { ok: boolean; error: string } | null {
  const hay = anotaciones.filter((a): a is { ok: boolean; error: string } => a !== null);
  if (hay.length === 0) return null;
  return { ok: hay.every((a) => a.ok), error: hay.map((a) => a.error).join(". ") };
}
