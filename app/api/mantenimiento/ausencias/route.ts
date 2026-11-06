import { NextResponse } from "next/server";
import { esFechaIso } from "@/lib/core/fechas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { traerTodo } from "@/lib/core/paginado";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";
import { estaVigente, TIPOS_QUE_NO_SON_FALTA, type PersonaDelTaller } from "@/lib/mantenimiento/disponibilidad";
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
 *   1. **Admin de Mantenimiento** (`esAdminMantenimiento`).
 *   2. **La persona está en `mant_personal_taller` y vigente** todos los días
 *      del rango. Puede anotar la falta de uno de sus nueve y de nadie más.
 *
 * El primero **era `puedeEditarMantenimiento`** —o sea también `edicion`—
 * porque así lo decía el diseño, escrito antes de que la pantalla quedara sólo
 * para `admin`. Se angostó el 26/10/2026, y el motivo es que las dos mitades no
 * coincidían: la pantalla, la entrada del menú y las otras cuatro rutas de la
 * programación piden `admin`, así que `edicion` —el nivel de quien carga OT y
 * ejecuciones, que es mucha más gente— tenía escritura con el cliente admin
 * sobre `ausencias`, una tabla de RRHH que toca `calculos_diarios` y por ahí el
 * sueldo, **sin ninguna pantalla que se la ofreciera ni menú que la revelara**.
 * Superficie de escritura que nadie puede alcanzar por la interfaz no es una
 * funcionalidad. La corrección del diseño está anotada en su propio documento.
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
 *     y que sea de uno de sus cuatro tipos. Lo que cargó RRHH no lo toca. El
 *     `GET` lista eso mismo y nada más: es lo único de `ausencias` que se ve
 *     desde Mantenimiento, y se ve porque lo escribió él.
 *   - **Corregir y borrar se auditan, y el registro va antes.** Si no entra, el
 *     cambio no se hace: lo que se pierde al corregir o borrar no se puede
 *     reconstruir después. Ver `problemaDeAuditoria()` más abajo.
 *   - **El alta no acepta una ausencia que pise otra de la misma persona.** El
 *     alta son dos toques y no pide confirmación, así que un doble toque dejaba
 *     dos filas — y la grilla las muestra igual, porque `estaAusente` usa
 *     `.some()`. Sacar la de más cuesta un borrado, y un borrado es una fila de
 *     auditoría para siempre. Ver `problemaDeSuperposicion()`.
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

/**
 * Cuántos días hay en el rango, contando los dos extremos.
 *
 * Se cuenta con una resta y no armando la lista: `esFechaIso` acepta hasta el
 * año 9999, así que un `fechaHasta` con el año mal tipeado pediría una lista de
 * **millones** de strings para después descartarla por larga. La comprobación
 * del largo tiene que poder hacerse sin pagarla.
 */
function cuantosDias(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Los días del rango, con los dos extremos adentro. Se suma en UTC, que no tiene
 * horario de verano: sumar 24 horas siempre cae en el día siguiente.
 *
 * Sólo se llama con rangos que ya pasaron por `problemasDelRango`, o sea de
 * `MAX_DIAS` días como mucho.
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
  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Anotar una ausencia requiere ser admin de Mantenimiento" },
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
  // `every` sobre una lista vacía es **true**: un rango vacío pasaría el único
  // permiso que tiene esta ruta. Hoy no se puede llegar acá con la lista vacía
  // —`problemasDelRango` rechaza antes el `hasta` anterior al `desde`—, pero la
  // defensa no puede vivir en otra función tres llamadas más arriba.
  if (dias.length === 0) {
    return NextResponse.json({ error: "Rango de fechas vacío: no se comprobó el padrón" }, { status: 500 });
  }

  const { data, error } = await db
    .from("mant_personal_taller")
    .select("oficio, grupo, desde, hasta")
    .eq("empleado_id", empleadoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Una fila cuyas fechas no se entienden **no cuenta**. `soloElDia(null)` da
  // `""`, y `"" <= dia` es cierto para cualquier día: esa persona quedaría
  // vigente desde el principio de los tiempos. Ante la duda, no es del taller.
  const padron: PersonaDelTaller[] = (data ?? [])
    .map((f) => ({
      empleadoId,
      oficio: f.oficio as Oficio,
      grupo: f.grupo as Grupo | null,
      desde: soloElDia(f.desde),
      hasta: f.hasta === null ? null : soloElDia(f.hasta),
    }))
    .filter((p) => esFechaIso(p.desde) && (p.hasta === null || esFechaIso(p.hasta)));

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
  // Con la lista vacía los dos extremos serían `undefined` y la consulta se
  // armaría con basura. Misma razón que en `problemaDePadron`.
  if (dias.length === 0) {
    return NextResponse.json({ error: "Rango de fechas vacío: no se comprobó la liquidación" }, { status: 500 });
  }

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

/**
 * Que no haya ya una ausencia de esa persona pisando esos días.
 *
 * No es prolijidad: el alta son dos toques y no pide confirmación —a propósito,
 * porque las ausencias se cargan con 39 días de atraso y la pantalla sólo sirve
 * si cuesta nada—, así que un doble toque o dos pestañas dejan **dos filas**.
 * Y no se ve: la grilla pinta a la persona ausente igual, porque `estaAusente`
 * usa `.some()`. Lo que se paga es después: cada una hay que borrarla por
 * separado, y cada borrado escribe una fila de auditoría que no se saca nunca.
 *
 * La `TARDANZA` no cuenta, por la misma razón por la que no cuenta en la
 * grilla: el que llega tarde vino a trabajar, y no es la misma novedad.
 *
 * Es sólo para el alta. El `PATCH` mueve una ausencia que ya existe y chocaría
 * consigo misma; que un rango corregido pise otro es un caso distinto y lo
 * resuelve quien corrige, mirando lo que ya cargó.
 *
 * Devuelve la respuesta de error, o null si no pisa nada.
 */
async function problemaDeSuperposicion(
  db: SupabaseClient,
  empleadoId: string,
  desde: string,
  hasta: string
): Promise<NextResponse | null> {
  const { data, error } = await db
    .from("ausencias")
    .select("fecha_desde, fecha_hasta, tipo")
    .eq("empleado_id", empleadoId)
    .lte("fecha_desde", hasta)
    .gte("fecha_hasta", desde);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pisa = (data ?? []).find((a) => !TIPOS_QUE_NO_SON_FALTA.includes(String(a.tipo)));
  if (!pisa) return null;

  return NextResponse.json(
    {
      error:
        `Esa persona ya tiene una ausencia anotada del ${soloElDia(pisa.fecha_desde)} al ` +
        `${soloElDia(pisa.fecha_hasta)}, que pisa esas fechas. Corregí esa en vez de anotar otra.`,
    },
    { status: 400 }
  );
}

/** Los problemas del rango en sí. Vacío si está bien. */
function problemasDelRango(desde: string, hasta: string): string[] {
  const problemas: string[] = [];
  if (hasta < desde) problemas.push("La fecha hasta no puede ser anterior a la fecha desde");
  else if (cuantosDias(desde, hasta) > MAX_DIAS) {
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

/** Una ausencia en una línea, para el registro: lo que era, no sólo que pasó algo. */
function comoSeLee(a: {
  tipo: unknown;
  fecha_desde: unknown;
  fecha_hasta: unknown;
  justificada: unknown;
  observaciones: unknown;
}): string {
  const obs = typeof a.observaciones === "string" && a.observaciones.trim() ? ` — ${a.observaciones.trim()}` : "";
  const sinJustificar = a.justificada ? "" : " (sin justificar)";
  return `${String(a.tipo)} del ${soloElDia(a.fecha_desde)} al ${soloElDia(a.fecha_hasta)}${sinJustificar}${obs}`;
}

/**
 * El registro de auditoría, que va **antes** del cambio: si no entra, el cambio
 * no se hace.
 *
 * Es el orden que esta casa fijó en `lib/core/borradoDeEspejo.ts`, y acá vale
 * por la misma razón: corregir o borrar una ausencia **pierde lo que había**.
 * No hay historial de `ausencias`, y `calculos_diarios` se recalcula sobre las
 * fechas nuevas, así que los días de los que la ausencia se fue vuelven a verse
 * como si nunca hubiera pasado nada. Auditar después sería auditar lo que ya no
 * se puede reconstruir el día que el registro falle.
 *
 * Se guarda la fila **anterior** —en una línea legible, y entera en el
 * `contexto`—, que es lo que contesta "qué decía antes", la pregunta para la
 * que existe la tabla.
 *
 * Devuelve la respuesta de error, o null si quedó registrado.
 */
async function problemaDeAuditoria(
  db: SupabaseClient,
  usuarioId: string,
  accion: "corregir" | "borrar",
  anterior: {
    id: string;
    empleado_id: string;
    fecha_desde: unknown;
    fecha_hasta: unknown;
    tipo: unknown;
    justificada: unknown;
    observaciones: unknown;
  },
  valorNuevo: string | null
): Promise<NextResponse | null> {
  const { data: quien } = await db
    .from("usuarios")
    .select("nombre, apellido, email")
    .eq("id", usuarioId)
    .maybeSingle();

  const registro = await auditar(db, {
    modulo: "mantenimiento",
    entidad: "ausencias",
    entidadId: anterior.id,
    accion,
    usuario: { id: usuarioId, nombre: nombreParaAuditoria(quien) },
    valorAnterior: comoSeLee(anterior),
    valorNuevo,
    contexto: {
      ruta: "mantenimiento/ausencias",
      empleado_id: anterior.empleado_id,
      anterior: {
        fecha_desde: soloElDia(anterior.fecha_desde),
        fecha_hasta: soloElDia(anterior.fecha_hasta),
        tipo: String(anterior.tipo),
        justificada: Boolean(anterior.justificada),
        observaciones: typeof anterior.observaciones === "string" ? anterior.observaciones : null,
      },
    },
  });

  if (!registro.ok) {
    const que = accion === "borrar" ? "el borrado" : "la corrección";
    const y = accion === "borrar" ? "no se borró" : "no se cambió nada";
    return NextResponse.json(
      { error: `No se pudo registrar ${que} en la auditoría, así que ${y}: ${registro.error}` },
      { status: 500 }
    );
  }
  return null;
}

/**
 * GET ?desde=&hasta= — las ausencias **que cargó el que pide**, de gente de su
 * padrón, que cruzan ese rango.
 *
 * Existe porque sin esto el `PATCH` y el `DELETE` son inalcanzables desde la
 * pantalla: la semana (`/api/mantenimiento/programacion`) dice quién falta, pero
 * a propósito **no trae el id de la ausencia** ni el motivo, así que no hay con
 * qué corregir ni qué borrar.
 *
 * Devuelve exactamente lo que esta misma ruta lo dejaría tocar: lo suyo
 * (`cargado_por_id`), de los cuatro tipos del encargado, de menos de `MAX_DIAS`
 * días y de alguien vigente en el padrón todos los días de la ausencia. Así un
 * botón que la pantalla muestre no puede terminar en un 403 — y, de paso, una
 * ausencia que él mismo haya cargado por RRHH con otro tipo (una `SUSPENSION`,
 * una `LICENCIA_ART`) no aparece de este lado, que es el borde que el spec
 * cuida: la pantalla dice que no está, no por qué.
 */
export async function GET(request: Request) {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const params = new URL(request.url).searchParams;
  const desde = params.get("desde");
  const hasta = params.get("hasta");

  const problemas: string[] = [];
  if (!esFechaIso(desde)) problemas.push("Falta desde, en formato AAAA-MM-DD");
  if (!esFechaIso(hasta)) problemas.push("Falta hasta, en formato AAAA-MM-DD");
  if (esFechaIso(desde) && esFechaIso(hasta) && hasta < desde) {
    problemas.push("La fecha hasta no puede ser anterior a la fecha desde");
  }
  if (problemas.length) return NextResponse.json({ error: problemas.join(". ") }, { status: 400 });

  const db = createAdminClient();

  // El filtro por `cargado_por_id` va en la consulta, no después: lo de otro no
  // llega ni a leerse. `justificada` no sale —no la pide la pantalla— y el
  // `select()` va literal.
  let filas;
  try {
    filas = await traerTodo<{
      id: string;
      empleado_id: string;
      fecha_desde: string;
      fecha_hasta: string;
      tipo: string;
      observaciones: string | null;
    }>((d, h) =>
      db
        .from("ausencias")
        .select("id, empleado_id, fecha_desde, fecha_hasta, tipo, observaciones")
        .eq("cargado_por_id", permiso.user.id)
        .in("tipo", TIPOS_DEL_ENCARGADO as string[])
        .lte("fecha_desde", hasta as string)
        .gte("fecha_hasta", desde as string)
        .order("fecha_desde")
        .order("id")
        .range(d, h)
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // El padrón de una sola consulta: una por ausencia serían tantas consultas
  // como filas. La ventana no es la pedida sino la que abarcan las ausencias
  // encontradas, que pueden empezar antes o terminar después: con la ventana
  // corta, una vigencia que arranca el día después del `hasta` no se traería y
  // esa ausencia se filtraría por una vigencia que sí existe.
  const bordes = filas.flatMap((a) => [soloElDia(a.fecha_desde), soloElDia(a.fecha_hasta)]).filter(esFechaIso);
  const ventanaDesde = bordes.reduce((min, f) => (f < min ? f : min), desde as string);
  const ventanaHasta = bordes.reduce((max, f) => (f > max ? f : max), hasta as string);

  let padron;
  try {
    padron = await traerTodo<{ empleado_id: string; oficio: string; grupo: string | null; desde: string; hasta: string | null }>(
      (d, h) =>
        db
          .from("mant_personal_taller")
          .select("empleado_id, oficio, grupo, desde, hasta")
          .lte("desde", ventanaHasta)
          .or(`hasta.is.null,hasta.gte.${ventanaDesde}`)
          .order("id")
          .range(d, h)
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const vigencias: PersonaDelTaller[] = padron
    .map((f) => ({
      empleadoId: f.empleado_id,
      oficio: f.oficio as Oficio,
      grupo: f.grupo as Grupo | null,
      desde: soloElDia(f.desde),
      hasta: f.hasta === null ? null : soloElDia(f.hasta),
    }))
    .filter((p) => esFechaIso(p.desde) && (p.hasta === null || esFechaIso(p.hasta)));

  const data = filas
    .map((a) => ({ ...a, fecha_desde: soloElDia(a.fecha_desde), fecha_hasta: soloElDia(a.fecha_hasta) }))
    .filter((a) => {
      if (!esFechaIso(a.fecha_desde) || !esFechaIso(a.fecha_hasta) || a.fecha_hasta < a.fecha_desde) return false;
      if (cuantosDias(a.fecha_desde, a.fecha_hasta) > MAX_DIAS) return false;
      return diasDelRango(a.fecha_desde, a.fecha_hasta).every((dia) =>
        vigencias.some((p) => p.empleadoId === a.empleado_id && estaVigente(p, dia))
      );
    });

  return NextResponse.json({ data });
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
  // Lo que no sea texto se rechaza, no se tira en silencio: el `PATCH` hace lo
  // mismo, y una observación que el encargado escribió y no se guardó es
  // exactamente el tipo de cosa que nadie nota hasta que la necesita.
  const observaciones = b?.observaciones == null ? null : b.observaciones;

  const problemas: string[] = [];
  if (observaciones !== null && typeof observaciones !== "string") {
    problemas.push("Las observaciones tienen que ser texto");
  }
  if (!UUID.test(empleadoId)) problemas.push("Falta elegir la persona");
  if (!esFechaIso(fechaDesde)) problemas.push("La fecha desde falta o no es válida, tiene que ser AAAA-MM-DD");
  if (!esFechaIso(fechaHasta)) problemas.push("La fecha hasta falta o no es válida, tiene que ser AAAA-MM-DD");
  if (!TIPOS_DEL_ENCARGADO.includes(tipo)) problemas.push(TIPO_AJENO);
  if (b?.justificada !== undefined && typeof b.justificada !== "boolean") {
    problemas.push("Si la falta es justificada o no se dice con verdadero o falso");
  }
  // `.trim()` sobre lo que todavía puede no ser texto reventaría en un 500 con
  // stack antes de llegar al 400 de arriba.
  const textoDeObservaciones = typeof observaciones === "string" ? observaciones : "";
  if (tipo === "OTRA" && !textoDeObservaciones.trim()) problemas.push(FALTA_EL_MOTIVO);
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
  const pisa = await problemaDeSuperposicion(db, empleadoId, fechaDesde as string, fechaHasta as string);
  if (pisa) return pisa;

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
    // Lo que tira ahí adentro es el recálculo, que corre **después** del insert,
    // así que la fila puede haber quedado escrita. No se dice que se guardó
    // —también podría haberse caído la conexión antes—, se dice que hay que ir a
    // mirar: lo que no puede pasar es que esto se vea igual que un alta buena.
    return NextResponse.json(
      {
        error:
          "La ausencia puede haber quedado guardada sin llegar a la liquidación, " +
          `revisala antes de volver a cargarla: ${(e as Error).message}`,
      },
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
  // El mismo `admin_sistema` pudo haberla cargado por RRHH, que no tiene tope de
  // largo. Sin esto, el `PATCH` y el `DELETE` recalcularían ese rango entero.
  if (cuantosDias(soloElDia(data.fecha_desde), soloElDia(data.fecha_hasta)) > MAX_DIAS) {
    return {
      error: NextResponse.json(
        { error: `Esa ausencia es de más de ${MAX_DIAS} días: la tiene que ver RRHH` },
        { status: 403 }
      ),
    };
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
  // A diferencia del POST, acá el tipo NO decide `justificada`: esto es una
  // corrección parcial y un campo que no se nombró no se cambia solo. Quien pase
  // el tipo a INJUSTIFICADA y quiera que deje de estar justificada, lo dice.
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

  // La vigencia en el padrón se pide sobre el rango que queda.
  const dias = diasDelRango(desde, hasta);
  const noEsSuyo = await problemaDePadron(db, actual.empleado_id, dias);
  if (noEsSuyo) return noEsSuyo;

  // Los dos rangos, el que queda y el que tenía: sacar una ausencia de un
  // período cerrado también lo toca, porque el recálculo pisa los días de los
  // que se va. Se miran por separado y no como una unión: mover una ausencia de
  // este año a otro dejaría una "unión" de cientos de días, y ahí el recálculo
  // reescribiría meses enteros de `calculos_diarios` por un cambio de un día.
  const rangos: [string, string][] = [[desde, hasta]];
  if (desde !== desdeActual || hasta !== hastaActual) rangos.push([desdeActual, hastaActual]);

  for (const [d, h] of rangos) {
    const cerrado = await problemaDePeriodoCerrado(db, actual.empleado_id, diasDelRango(d, h));
    if (cerrado) return cerrado;
  }

  // El registro va antes del cambio: sin él, la fila no se toca. Guarda lo que
  // decía y lo que va a decir, que es lo que después no se puede reconstruir.
  const sinRegistro = await problemaDeAuditoria(db, permiso.user.id, "corregir", actual, comoSeLee({
    tipo, fecha_desde: desde, fecha_hasta: hasta, justificada, observaciones,
  }));
  if (sinRegistro) return sinRegistro;

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
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Sin fila, la ausencia se fue entre la lectura y la escritura: otra pestaña
  // la borró. Con `.single()` eso llegaba como un error interno de PostgREST.
  if (!data) return NextResponse.json({ error: "Esa ausencia ya no existe" }, { status: 404 });

  // Se intentan **los dos** rangos aunque el primero falle. Cortar en el primero
  // dejaba el otro sin recalcular y sin nombrar: después de mover las fechas, los
  // días viejos seguirían mostrando la ausencia que ya no los cubre, y el mensaje
  // no decía cuáles mirar — que es lo único que sirve para ir a arreglarlo.
  const fallados: string[] = [];
  for (const [d, h] of rangos) {
    const falloElRecalculo = await recalcular(db, actual.empleado_id, d, h);
    if (falloElRecalculo) fallados.push(`del ${d} al ${h} (${falloElRecalculo})`);
  }
  if (fallados.length) {
    return NextResponse.json(
      {
        error:
          "La ausencia se modificó pero la liquidación no se recalculó en " +
          `${fallados.join(" y ")}. Esos días pueden estar mostrando lo que ya no es.`,
      },
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

  // El registro va antes del borrado: si no entra, no se borra. Borrar la fila
  // no deja rastro en ningún lado —`calculos_diarios` se recalcula y el día
  // vuelve a verse como si nunca hubiera habido una ausencia—, así que esto es
  // lo único que después puede decir qué había. El `DELETE` de RRHH, que hace
  // lo mismo con cualquier empleado, audita igual desde hoy: con una sola punta
  // registrando, la tabla diría tener el registro de los borrados de ausencias
  // y tendría el de la mitad.
  const sinRegistro = await problemaDeAuditoria(db, permiso.user.id, "borrar", actual, null);
  if (sinRegistro) return sinRegistro;

  const { data, error } = await db
    .from("ausencias")
    .delete()
    .eq("id", id)
    .eq("cargado_por_id", permiso.user.id)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Nada borrado es que ya no estaba: otra pestaña se adelantó entre la lectura
  // y el `delete`. Devolver `{ok: true, borradas: 0}` le decía "listo" a quien
  // no mire el número, que es cualquiera.
  if (!data?.length) return NextResponse.json({ error: "Esa ausencia ya no existe" }, { status: 404 });

  const falloElRecalculo = await recalcular(db, actual.empleado_id, desde, hasta);
  if (falloElRecalculo) {
    return NextResponse.json(
      {
        error:
          `La ausencia se borró pero la liquidación no se recalculó del ${desde} al ${hasta} ` +
          `(${falloElRecalculo}). Esos días pueden estar mostrando lo que ya no es.`,
      },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, borradas: data.length });
}
