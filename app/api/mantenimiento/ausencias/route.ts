import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { estaVigente, type PersonaDelTaller } from "@/lib/mantenimiento/disponibilidad";
import type { Grupo, Oficio } from "@/lib/mantenimiento/programacion";
import { altaDeAusencia, periodoEstaCerrado, TIPOS_DEL_ENCARGADO } from "@/lib/rrhh/altaDeAusencia";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";

/**
 * El encargado del taller anota la falta de uno de los suyos.
 *
 * Escribe en `ausencias`, que es una tabla de **RRHH**. La razón de que esta
 * ruta exista es un permiso más angosto: `POST /api/rrhh/ausencias` exige el
 * nivel de edición de RRHH, el mismo que abre sueldos, liquidaciones y la ficha
 * completa de los 70 empleados. Dárselo al encargado para que pueda anotar que
 * faltó un mecánico es desproporcionado — es la misma frontera que el proyecto
 * ya cuidó una vez cuando el valor hora tuvo que mudarse de `empleados` a
 * `rrhh_empleados_datos` porque RLS no sabe tapar una columna sola.
 *
 * ── LO QUE HAY QUE SABER ANTES DE TOCAR ESTE ARCHIVO ────────
 *
 * Se escribe con el **cliente admin**, así que acá RLS no corre: las policies de
 * `ausencias` (`tiene_acceso_rrhh()`) no defienden nada de este lado. Lo único
 * que separa al encargado de las fichas de los 70 empleados son los chequeos de
 * este archivo, y son dos:
 *
 *   1. **Nivel de edición en Mantenimiento** (`puedeEditarMantenimiento`).
 *   2. **La persona está en `mant_personal_taller` y vigente** todos los días
 *      del rango. Puede anotar la falta de uno de sus nueve y de nadie más.
 *
 * Y tres frenos más, que no son de permiso pero evitan daño:
 *
 *   - **El tipo tiene que estar en `TIPOS_DEL_ENCARGADO`.** `altaDeAusencia` NO
 *     lo restringe: valida contra los doce que acepta la base. Los que quedan
 *     afuera no son los difíciles, son los que tienen consecuencias que el
 *     encargado no puede juzgar ni deshacer (`VACACIONES` descuenta del balance
 *     anual, `SUSPENSION` es una sanción, `LICENCIA_ART` abre un expediente).
 *   - **Un período ya liquidado no se toca.** `lib/rrhh/engine/recalcular.ts` no
 *     mira `estado_liquidacion`, así que una ausencia cargada sobre un período
 *     cerrado queda escrita y nunca llega al recibo. Ese agujero ya existe del
 *     lado de RRHH y no se arregla acá, pero tampoco se agranda.
 *   - **Sólo se corrige o se borra lo que cargó el que pide** (`cargado_por_id`)
 *     y que sea de uno de sus cuatro tipos. Lo que cargó RRHH no lo toca.
 *
 * El alta no la hace esta ruta: la hace `altaDeAusencia()` de
 * `lib/rrhh/altaDeAusencia.ts`, que es el mismo cuerpo que usa RRHH. Dar de alta
 * una ausencia **no es insertar una fila**: después hay que sincronizar el
 * período de vacaciones y recalcular `calculos_diarios`. Una segunda ruta que
 * insertara por su cuenta dejaría una ausencia que se ve en la pantalla y que la
 * liquidación no ve — y eso no se nota de este lado, se nota en el sueldo de
 * alguien. Por la misma razón el `PATCH` y el `DELETE` de acá recalculan.
 *
 * Spec: docs/superpowers/specs/2026-10-22-mantenimiento-disponibilidad-y-turnos-design.md
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El rango más largo que acepta esta ruta.
 *
 * No es una regla de negocio: es un freno. Cada día del rango es una fila que
 * `recalcularEmpleadoPeriodo` escribe en `calculos_diarios`, y acá se escribe
 * con el cliente admin. Un `fechaHasta` con el año mal tipeado pediría recalcular
 * décadas de días para una persona. Una falta de taller se mide en días; lo que
 * pase de tres meses es una licencia larga, y eso lo carga RRHH.
 */
const MAX_DIAS = 90;

/** Una fecha "YYYY-MM-DD" que existe en el calendario (no el 31 de abril). */
function esFechaIso(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/**
 * Los días del rango, con los dos extremos adentro. Se suma en UTC, que no tiene
 * horario de verano: sumar 24 horas siempre cae en el día siguiente.
 */
function diasDelRango(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= fin; t += 86_400_000) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
}

/**
 * Una fecha que vino de la base, como `YYYY-MM-DD` pelado.
 *
 * `periodoEstaCerrado` y `estaVigente` comparan **texto**: un
 * `"2026-09-30T00:00:00"` es mayor que `"2026-09-30"`, así que una fecha con
 * hora pegada se colaría por el último día de un período cerrado. Las columnas
 * son `date` y hoy PostgREST las devuelve sin hora, pero el corte cuesta nada y
 * la comparación deja de depender de eso.
 */
function soloElDia(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

/** Quién es el que pide, o la respuesta de error si no puede. */
async function admitir() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Anotar una ausencia requiere nivel de edición en Mantenimiento" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

/**
 * El segundo permiso: que la persona sea del taller **todos** los días del
 * rango. Se mira día por día porque alguien puede tener dos vigencias seguidas
 * (cambió de grupo a mitad de mes) y entre las dos cubrir el rango entero.
 *
 * Devuelve la respuesta de error, o null si está bien.
 */
async function problemaDePadron(
  db: SupabaseClient,
  empleadoId: string,
  dias: string[]
): Promise<NextResponse | null> {
  const { data, error } = await db
    .from("mant_personal_taller")
    .select("oficio, grupo, desde, hasta")
    .eq("empleado_id", empleadoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const padron: PersonaDelTaller[] = (data ?? []).map((f) => ({
    empleadoId,
    oficio: f.oficio as Oficio,
    grupo: f.grupo as Grupo | null,
    desde: soloElDia(f.desde),
    hasta: f.hasta === null ? null : soloElDia(f.hasta),
  }));

  if (!dias.every((dia) => padron.some((p) => estaVigente(p, dia)))) {
    return NextResponse.json(
      { error: "Esa persona no es del taller en esas fechas: su ausencia la carga RRHH" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * El freno del período cerrado. `liquidaciones` es por empleado y se piden sólo
 * las que cruzan el rango, que acota las filas sin que haga falta paginar.
 *
 * Devuelve la respuesta de error, o null si está bien.
 */
async function problemaDePeriodoCerrado(
  db: SupabaseClient,
  empleadoId: string,
  dias: string[]
): Promise<NextResponse | null> {
  const { data, error } = await db
    .from("liquidaciones")
    .select("fecha_desde, fecha_hasta, estado")
    .eq("empleado_id", empleadoId)
    .lte("fecha_desde", dias[dias.length - 1])
    .gte("fecha_hasta", dias[0]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const liquidaciones = (data ?? []).map((l) => ({
    fecha_desde: soloElDia(l.fecha_desde),
    fecha_hasta: soloElDia(l.fecha_hasta),
    estado: String(l.estado),
  }));

  if (dias.some((dia) => periodoEstaCerrado(liquidaciones, dia))) {
    return NextResponse.json(
      { error: "Esas fechas caen en una liquidación ya cerrada: eso lo tiene que ver RRHH" },
      { status: 400 }
    );
  }
  return null;
}

/** Los problemas del rango en sí. Vacío si está bien. */
function problemasDelRango(desde: string, hasta: string): string[] {
  const problemas: string[] = [];
  if (hasta < desde) problemas.push("La fecha hasta no puede ser anterior a la fecha desde");
  else if (diasDelRango(desde, hasta).length > MAX_DIAS) {
    problemas.push(`Una ausencia de más de ${MAX_DIAS} días la carga RRHH`);
  }
  return problemas;
}

/** El texto de un tipo que no es suyo, con la lista de los que sí. */
const TIPO_AJENO =
  "Ese tipo de ausencia lo carga RRHH. Desde acá se anotan permiso personal, " +
  "enfermedad o accidente inculpable, injustificada y otra";

/**
 * La regla de `OTRA`: sin observaciones no se sabe qué pasó.
 *
 * `altaDeAusencia` también la tiene y devolvería un 400, pero con el texto
 * escrito para la pantalla de RRHH. Acá se contesta antes para que el encargado
 * lea un mensaje suyo, y para que el `PATCH` —que no pasa por `altaDeAusencia`—
 * no se quede sin la regla.
 */
const FALTA_EL_MOTIVO = "Cuando el tipo es 'Otra' hay que escribir en observaciones qué pasó";

/**
 * El recálculo de `calculos_diarios`, que es lo que hace que la ausencia llegue
 * a la liquidación. Si falla, la fila ya está escrita: se dice, no se deshace.
 */
async function recalcular(
  db: SupabaseClient,
  empleadoId: string,
  desde: string,
  hasta: string
): Promise<string | null> {
  try {
    await recalcularEmpleadoPeriodo(db, empleadoId, new Date(desde), new Date(hasta));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** POST — anotar la falta de alguien del taller. */
export async function POST(request: Request) {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const b = await cuerpoJson(request);
  const empleadoId = String(b?.empleadoId ?? "");
  const fechaDesde = b?.fechaDesde;
  const fechaHasta = b?.fechaHasta;
  const tipo = String(b?.tipo ?? "");
  const observaciones = typeof b?.observaciones === "string" ? b.observaciones : null;

  const problemas: string[] = [];
  if (!UUID.test(empleadoId)) problemas.push("Falta elegir la persona");
  if (!esFechaIso(fechaDesde)) problemas.push("La fecha desde falta o no es válida, tiene que ser AAAA-MM-DD");
  if (!esFechaIso(fechaHasta)) problemas.push("La fecha hasta falta o no es válida, tiene que ser AAAA-MM-DD");
  if (!TIPOS_DEL_ENCARGADO.includes(tipo)) problemas.push(TIPO_AJENO);
  if (b?.justificada !== undefined && typeof b.justificada !== "boolean") {
    problemas.push("Si la falta es justificada o no se dice con verdadero o falso");
  }
  if (tipo === "OTRA" && !(observaciones ?? "").trim()) problemas.push(FALTA_EL_MOTIVO);
  if (esFechaIso(fechaDesde) && esFechaIso(fechaHasta)) problemas.push(...problemasDelRango(fechaDesde, fechaHasta));
  if (problemas.length) return NextResponse.json({ error: problemas.join(". ") }, { status: 400 });

  // Sin dato, la justifica el tipo: una INJUSTIFICADA justificada sería una
  // contradicción, y las otras tres siguen el default de la tabla.
  const justificada = typeof b?.justificada === "boolean" ? b.justificada : tipo !== "INJUSTIFICADA";

  const dias = diasDelRango(fechaDesde as string, fechaHasta as string);
  const db = createAdminClient();

  const noEsSuyo = await problemaDePadron(db, empleadoId, dias);
  if (noEsSuyo) return noEsSuyo;
  const cerrado = await problemaDePeriodoCerrado(db, empleadoId, dias);
  if (cerrado) return cerrado;

  // `anioCorrespondiente` no viaja a propósito: sólo lo usa VACACIONES, que no
  // es uno de los cuatro tipos de acá.
  let resultado;
  try {
    resultado = await altaDeAusencia(db, {
      employeeId: empleadoId,
      fechaDesde: fechaDesde as string,
      fechaHasta: fechaHasta as string,
      tipo,
      justificada,
      observaciones,
      cargadoPorId: permiso.user.id,
    });
  } catch (e) {
    // Lo único que tira ahí adentro es el recálculo, y corre después del insert.
    return NextResponse.json(
      { error: `La ausencia se guardó pero falló el recálculo de la liquidación: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  // Se mira el `status` y no si `error` tiene texto: un mensaje vacío de Postgres
  // haría caer un error adentro de un 201 con el cuerpo en undefined.
  if (resultado.status) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return NextResponse.json({ data: resultado.ausencia }, { status: 201 });
}

/** La ausencia sobre la que se pide trabajar, o la respuesta de por qué no se puede. */
async function laAusenciaDelEncargado(db: SupabaseClient, id: string, usuarioId: string) {
  const { data, error } = await db
    .from("ausencias")
    .select("id, empleado_id, fecha_desde, fecha_hasta, tipo, justificada, observaciones, cargado_por_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!data) return { error: NextResponse.json({ error: "Esa ausencia no existe" }, { status: 404 }) };
  if (data.cargado_por_id !== usuarioId) {
    return {
      error: NextResponse.json(
        { error: "Esa ausencia no la cargaste vos: para tocarla hay que pasar por RRHH" },
        { status: 403 }
      ),
    };
  }
  // Un `admin_sistema` tiene las dos puntas, así que puede haber cargado por
  // RRHH una ausencia de un tipo que acá no se maneja. Borrarla desde este lado
  // se llevaría en cascada su fila de `vacaciones`, que es justo lo que el
  // encargado no puede juzgar.
  if (!TIPOS_DEL_ENCARGADO.includes(data.tipo)) {
    return { error: NextResponse.json({ error: TIPO_AJENO }, { status: 403 }) };
  }
  return { ausencia: data };
}

/** PATCH — corregir una ausencia propia. Lleva `id` en el cuerpo. */
export async function PATCH(request: Request) {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const b = await cuerpoJson(request);
  const id = String(b?.id ?? "");
  if (!UUID.test(id)) return NextResponse.json({ error: "Falta qué ausencia se modifica" }, { status: 400 });

  const db = createAdminClient();
  const encontrada = await laAusenciaDelEncargado(db, id, permiso.user.id);
  if (encontrada.error) return encontrada.error;
  const actual = encontrada.ausencia;

  const cuerpo = (b ?? {}) as Record<string, unknown>;
  const problemas: string[] = [];

  // La fila como quedaría: las reglas se miran sobre el resultado y no sobre el
  // pedido. El empleado NO se puede cambiar — mover una ausencia a otra persona
  // es dar de alta una ausencia de esa otra persona, y eso pasa por el POST con
  // sus dos chequeos.
  const desdeActual = soloElDia(actual.fecha_desde);
  const hastaActual = soloElDia(actual.fecha_hasta);

  let desde = desdeActual;
  if ("fechaDesde" in cuerpo) {
    if (esFechaIso(cuerpo.fechaDesde)) desde = cuerpo.fechaDesde;
    else problemas.push("La fecha desde no es válida, tiene que ser AAAA-MM-DD");
  }
  let hasta = hastaActual;
  if ("fechaHasta" in cuerpo) {
    if (esFechaIso(cuerpo.fechaHasta)) hasta = cuerpo.fechaHasta;
    else problemas.push("La fecha hasta no es válida, tiene que ser AAAA-MM-DD");
  }
  let tipo = String(actual.tipo);
  if ("tipo" in cuerpo) {
    if (TIPOS_DEL_ENCARGADO.includes(String(cuerpo.tipo))) tipo = String(cuerpo.tipo);
    else problemas.push(TIPO_AJENO);
  }
  let justificada = Boolean(actual.justificada);
  if ("justificada" in cuerpo) {
    if (typeof cuerpo.justificada === "boolean") justificada = cuerpo.justificada;
    else problemas.push("Si la falta es justificada o no se dice con verdadero o falso");
  }
  let observaciones = (actual.observaciones as string | null) ?? null;
  if ("observaciones" in cuerpo) {
    if (cuerpo.observaciones === null || typeof cuerpo.observaciones === "string") {
      observaciones = (cuerpo.observaciones as string | null) || null;
    } else problemas.push("Las observaciones tienen que ser texto");
  }

  const hayCambios = ["fechaDesde", "fechaHasta", "tipo", "justificada", "observaciones"].some((c) => c in cuerpo);
  if (!hayCambios) {
    problemas.push("No hay nada para cambiar: mandá fechaDesde, fechaHasta, tipo, justificada u observaciones");
  }
  if (tipo === "OTRA" && !(observaciones ?? "").trim()) problemas.push(FALTA_EL_MOTIVO);
  problemas.push(...problemasDelRango(desde, hasta));
  if (problemas.length) return NextResponse.json({ error: problemas.join(". ") }, { status: 400 });

  // La vigencia se pide sobre el rango que queda. El período cerrado, sobre la
  // unión con el que tenía: sacar una ausencia de un período cerrado también lo
  // toca, porque el recálculo pisa los días de los que se va.
  const dias = diasDelRango(desde, hasta);
  const noEsSuyo = await problemaDePadron(db, actual.empleado_id, dias);
  if (noEsSuyo) return noEsSuyo;

  const unionDesde = desde < desdeActual ? desde : desdeActual;
  const unionHasta = hasta > hastaActual ? hasta : hastaActual;
  const cerrado = await problemaDePeriodoCerrado(db, actual.empleado_id, diasDelRango(unionDesde, unionHasta));
  if (cerrado) return cerrado;

  // El `cargado_por_id` va también en el `update`: ya se comprobó arriba, pero
  // así la escritura misma no puede alcanzar la fila de otro.
  const { data, error } = await db
    .from("ausencias")
    .update({
      fecha_desde: desde,
      fecha_hasta: hasta,
      tipo,
      justificada,
      observaciones,
    })
    .eq("id", id)
    .eq("cargado_por_id", permiso.user.id)
    .select("id, empleado_id, fecha_desde, fecha_hasta, tipo, justificada, observaciones")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const falloElRecalculo = await recalcular(db, actual.empleado_id, unionDesde, unionHasta);
  if (falloElRecalculo) {
    return NextResponse.json(
      { error: `La ausencia se modificó pero falló el recálculo de la liquidación: ${falloElRecalculo}` },
      { status: 500 }
    );
  }
  return NextResponse.json({ data });
}

/** DELETE ?id= — sacar una ausencia propia. */
export async function DELETE(request: Request) {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Falta qué ausencia se borra" }, { status: 400 });

  const db = createAdminClient();
  const encontrada = await laAusenciaDelEncargado(db, id, permiso.user.id);
  if (encontrada.error) return encontrada.error;
  const actual = encontrada.ausencia;

  const desde = soloElDia(actual.fecha_desde);
  const hasta = soloElDia(actual.fecha_hasta);
  const dias = diasDelRango(desde, hasta);

  const noEsSuyo = await problemaDePadron(db, actual.empleado_id, dias);
  if (noEsSuyo) return noEsSuyo;
  const cerrado = await problemaDePeriodoCerrado(db, actual.empleado_id, dias);
  if (cerrado) return cerrado;

  // No se llama a `auditar()`, y conviene que esté dicho: borrar la fila no deja
  // rastro —`calculos_diarios` se recalcula y el día vuelve a verse como si nunca
  // hubiera habido una ausencia—, pero **se deshace desde el sistema**: el mismo
  // encargado la vuelve a cargar con el POST de arriba y queda igual. Eso es lo
  // que separa a esta acción de las ocho que sí se auditan, que no se pueden
  // deshacer de ningún modo. El `DELETE` de RRHH, que hace exactamente lo mismo
  // con cualquier empleado, tampoco audita: auditar sólo de este lado haría
  // creer que la tabla tiene el registro de los borrados de ausencias, cuando
  // tendría el de una punta sola.
  const { data, error } = await db
    .from("ausencias")
    .delete()
    .eq("id", id)
    .eq("cargado_por_id", permiso.user.id)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const falloElRecalculo = await recalcular(db, actual.empleado_id, desde, hasta);
  if (falloElRecalculo) {
    return NextResponse.json(
      { error: `La ausencia se borró pero falló el recálculo de la liquidación: ${falloElRecalculo}` },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, borradas: data?.length ?? 0 });
}
