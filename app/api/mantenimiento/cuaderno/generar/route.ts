import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { traerTodo } from "@/lib/core/paginado";
import { altaEnLaPlanilla, corregirLaAlta } from "@/lib/mantenimiento/formulario";
import { escribirEnLaFilaDeLaOT } from "@/lib/mantenimiento/planillaDeOT";
import { celdasParaRegistrar, type RegistroDeOT } from "@/lib/mantenimiento/ordenes";
import { loQueHayQueExportar } from "@/lib/mantenimiento/cierreDeOT";
import { prioridadParaLaPlanilla } from "@/lib/mantenimiento/prioridad";
import {
  enOrdenes, pendientesDeOrdenes, type GrupoDeCuaderno, type RenglonDelCuaderno,
} from "@/lib/mantenimiento/cuadernoGrupos";
import {
  valoresDeLaOrden, posiblesDuplicados, avisoDeDuplicados,
  type EquipoConNombre, type OrdenParaComparar, type SectorConNombre, type ValoresDeLaOrden,
} from "@/lib/mantenimiento/cuadernoOrden";

/**
 * Las OT que salen del cuaderno de un contratista (hoy PIPARO).
 *
 * **Esto escribe órdenes de trabajo en la planilla de Google de producción, y
 * una OT escrita ahí se borra a mano, fila por fila.** Es lo único del cuaderno
 * que no se corrige en pantalla, y por eso todo lo que sigue está armado para
 * que nada se cree sin que alguien lo haya visto antes.
 *
 * ── LA VISTA PREVIA Y LA GENERACIÓN SON LA MISMA CUENTA ─────────────────────
 *
 * `?simular` (cuerpo `{ simular: true }`) y la generación pasan por **el mismo
 * `armarElPlan`**: las dos llaman a `enOrdenes` para decidir qué sale y a
 * `valoresDeLaOrden` para decidir qué lleva cada orden. Si se separaran, la
 * pantalla mostraría una cosa y se crearía otra, y eso no se deshace.
 *
 * `enOrdenes` ya se niega a generar sin sector y sin confirmar, y deja afuera
 * los renglones sin fecha o sin horas ni precio: **no se repite acá**. Lo que
 * esta ruta le agrega es sólo lo que depende de la planilla y de la base.
 *
 * ── TRES CAMINOS, COMO LA DE CANDIA ─────────────────────────────────────────
 *
 * - **crear**: el grupo no tiene orden; se escribe el alta y se inserta.
 * - **sumar**: ya tiene una; se la reescribe con el total del grupo en vez de
 *   crear otra (`sumar` reescribe, no acumula: el grupo trae todos sus
 *   renglones y sumar sobre la base contaría dos veces lo de antes).
 * - **denunciar**: sus renglones apuntan a dos órdenes distintas. No se toca
 *   ninguna: repartir horas entre dos órdenes ya creadas sería inventar.
 *
 * ── EL COSTO VIAJA DENTRO DE `REPUESTO UTILIZADO` ───────────────────────────
 *
 * La planilla no tiene una columna de costo y es de donde lee quien no entra al
 * sistema. Va a la I porque **ahí ya está**: 58 de las 380 OT de PIPARO ya
 * tienen un monto escrito a mano en `repuesto` (ver `costoEnRepuesto.ts`). Se
 * suma al texto en vez de pisarlo.
 *
 * **Y al sumar a una orden existente hay que escribirlo en «Altas del
 * sistema»**, no en el master: la columna I del master es derrame de un
 * `QUERY(IMPORTRANGE())` y lo que se le escribe no queda —la próxima
 * sincronización leería el texto viejo y se lo devolvería a la base—. Lo
 * mismo vale para la descripción y la fecha de ejecución, que también se
 * reescriben al sumar. Por eso `corregirLaAlta`.
 *
 * `costoEquipo.ts` **no suma** este costo y no se toca: saltea toda OT con
 * contratista, y se decidió a pedido. Está escrito en el spec como riesgo
 * asumido.
 *
 * ── EL TOPE ─────────────────────────────────────────────────────────────────
 *
 * Cada alta son cinco llamadas a Google **en serie** —la serie no se puede pedir
 * en paralelo sin repartir el mismo número dos veces—, así que una quincena de
 * PIPARO (~47 órdenes) pide dos corridas y tarda minutos. El tope existe para
 * que un pedido no se corte a la mitad sin que nadie sepa por dónde iba. Lo
 * que **no** cuenta contra el tope es denunciar: no llama a Google.
 *
 * ── EL FRENO DE LOS DUPLICADOS ──────────────────────────────────────────────
 *
 * Septiembre de 2026 ya tiene 29 OT de PIPARO cargadas a mano, y generar su
 * cuaderno las duplica. Antes de crear, la ruta cuenta las OT **del
 * contratista** cuya `fecha` cae en el período de las órdenes que va a crear y
 * que **no están enlazadas a ningún renglón de esta carga**. Si hay alguna, la
 * generación **se niega** (409) y dice cuántas son y sus números; se levanta
 * con `confirmar_duplicados: true` en el cuerpo. La vista previa no se niega:
 * informa, con el mismo aviso, para que la decisión se tome mirando.
 *
 * Es la forma del freno de los 50 renglones del borrado de espejo
 * (`?confirmar_borrado=1`), y existe por la misma razón: lo irreversible no se
 * puede apostar a que alguien se acuerde de un documento. Una segunda corrida
 * de la misma carga **no se frena a sí misma**: lo que generó la primera está
 * enlazado a sus renglones.
 *
 * ── SIN AUDITORÍA, A PROPÓSITO ──────────────────────────────────────────────
 *
 * La lista de acciones que pasan por `auditar()` es corta y deliberada, y la
 * generación del otro contratista tampoco audita. El rastro de quién la creó
 * existe igual: cada OT guarda `created_by` y `created_at_app`.
 *
 * ── LO QUE NO SE PUEDE EVITAR ───────────────────────────────────────────────
 *
 * Dos pedidos simultáneos pueden crear dos veces el mismo grupo: los renglones
 * se marcan recién después de crear la orden, porque antes no hay id que
 * ponerles. Se reduce con una relectura justo antes de escribir y con el botón
 * deshabilitado mientras corre, pero no se elimina.
 */

const TOPE_POR_CORRIDA = 25;

/**
 * Cuánto puede tardar la función, y cuándo dejar de empezar órdenes nuevas.
 *
 * 25 altas en serie son del orden de minutos y la función corta a los 300 s: si
 * la plataforma la mata a mitad de una orden, queda escrita en la planilla sin
 * estar en el sistema —es el caso que más cuesta arreglar—. Pasado el margen no
 * se empieza ninguna más y lo que falta cuenta como «quedaron»: se genera
 * apretando de nuevo, y lo ya generado no se repite.
 */
export const maxDuration = 300;
const MARGEN_EN_MS = 200_000;

/** Un `.in()` con muchos ids arma una URL que PostgREST rechaza con un 400. */
const LOTE = 200;

function enLotes<T>(xs: readonly T[], tamano = LOTE): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < xs.length; i += tamano) lotes.push(xs.slice(i, i + tamano));
  return lotes;
}

type Admin = ReturnType<typeof createAdminClient>;

/** Lo que la orden ya tenía, cuando el grupo suma a una que existe. */
type OrdenExistente = {
  id: string; ot_number: number; fecha_cierre: string | null; costo: number | null; repuesto: string | null;
};

type ItemDelPlan = {
  grupo: GrupoDeCuaderno;
  valores: ValoresDeLaOrden;
  existente: OrdenExistente | null;
  /** Va en esta corrida: dentro del tope y sin ser una denuncia. */
  entra: boolean;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await cuerpoJson(request);
  const cuaderno_id = String(body?.cuaderno_id ?? "").trim();
  // Sin esto el botón genera lo que ve y además lo que no ve.
  const simular = body?.simular === true;
  // El freno de los duplicados se levanta con esto, y sólo esto.
  const confirmarDuplicados = body?.confirmar_duplicados === true;

  if (!cuaderno_id) {
    return NextResponse.json({ error: "Falta decir de qué carga" }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    const { data: carga, error: errorCarga } = await admin
      .from("mant_cuadernos")
      .select("id, proveedor_id, proveedores(nombre)")
      .eq("id", cuaderno_id)
      .maybeSingle();
    if (errorCarga) return NextResponse.json({ error: errorCarga.message }, { status: 500 });
    if (!carga) return NextResponse.json({ error: "No existe esa carga" }, { status: 404 });

    // El embed viene como objeto o como arreglo según quién infiera el tipo:
    // es la misma ambigüedad que resuelve `valorHoraDe()` en RRHH.
    const embed = carga.proveedores as { nombre: string } | { nombre: string }[] | null;
    const contratista = (Array.isArray(embed) ? embed[0]?.nombre : embed?.nombre) ?? "";
    if (!contratista) {
      return NextResponse.json({ error: "No se pudo saber de qué contratista es esta carga" }, { status: 400 });
    }

    // **Todos los renglones de la carga, convertidos o no.** Los convertidos
    // hacen falta para reconocer la orden que un grupo ya tiene: sin ellos
    // `enOrdenes` no distingue «hay que crearla» de «hay que sumarle».
    const filas = await traerTodo((d, h) =>
      admin
        .from("mant_cuadernos_renglones")
        // La cadena va literal: un `select()` armado en una variable pierde la
        // inferencia de tipos de Supabase.
        .select("id, cuaderno_id, foto_id, linea, fecha, tarea, lugar_raw, sector_id, sector_propuesto, equipo_id, horas, costo, dudoso, motivo_dudoso, heredado, grupo_id, orden_trabajo_id")
        .eq("cuaderno_id", cuaderno_id)
        .order("id")
        .range(d, h)
    );
    const renglones = filas as unknown as RenglonDelCuaderno[];

    const plan = await armarElPlan(admin, renglones, contratista);
    const pendientes = pendientesDeOrdenes(renglones);

    // Sobre lo que **entra en esta corrida**: es lo que se va a crear de verdad.
    const duplicados = await buscarPosiblesDuplicados(
      admin, renglones, plan.filter((p) => p.entra).map((p) => p.grupo), contratista
    );
    const avisoDeDuplicadosOCero = duplicados.length > 0 ? avisoDeDuplicados(contratista, duplicados) : null;

    if (simular) {
      return NextResponse.json({
        simulado: true,
        ordenes: plan.map((p) => paraMostrar(p)),
        pendientes,
        tope: TOPE_POR_CORRIDA,
        duplicados: avisoDeDuplicadosOCero
          ? { cantidad: duplicados.length, ot_numbers: duplicados.map((d) => d.ot_number), aviso: avisoDeDuplicadosOCero }
          : null,
      });
    }

    // La generación real se niega. No se creó nada, y lo dice.
    if (avisoDeDuplicadosOCero && !confirmarDuplicados) {
      return NextResponse.json(
        {
          error: `No se generó nada. ${avisoDeDuplicadosOCero}`,
          duplicados: {
            cantidad: duplicados.length,
            ot_numbers: duplicados.map((d) => d.ot_number),
            aviso: avisoDeDuplicadosOCero,
          },
        },
        { status: 409 }
      );
    }

    const inicio = Date.now();
    let sinEmpezar = 0;
    const creadas: Resumen[] = [];
    const actualizadas: Resumen[] = [];
    const problemas: string[] = [];

    for (const item of plan) {
      const { grupo } = item;

      if (grupo.accion === "denunciar") {
        problemas.push(
          `${comoDecirla(grupo)}: los renglones de ese grupo apuntan a ${grupo.ot_existentes.length} ` +
          `órdenes distintas, así que no se tocó ninguna. Hay que mirarlas a mano: repartirles ` +
          `horas eligiendo una sería inventar.`
        );
        continue;
      }
      if (!item.entra) continue;
      if (Date.now() - inicio > MARGEN_EN_MS) { sinEmpezar++; continue; }

      if (!item.valores.fecha_cierre) {
        // `enOrdenes` ya deja afuera lo que no tiene fecha; esto es el cinturón.
        problemas.push(`${comoDecirla(grupo)}: no tiene fecha, así que no se generó.`);
        continue;
      }

      // Un grupo que suma y cuya orden no se encuentra **no se crea de nuevo**:
      // los renglones apuntan a una OT, y que ya no esté es algo a mirar, no a
      // tapar con otra.
      if (grupo.accion === "sumar" && !item.existente) {
        problemas.push(
          `${comoDecirla(grupo)}: los renglones apuntan a una OT que ya no está en el sistema. ` +
          `No se creó otra: si la borraron a propósito, hay que mirar esos renglones.`
        );
        continue;
      }

      const resultado = item.existente
        ? await actualizarLaOT(admin, item, item.existente)
        : await crearLaOT(admin, user.id, item, contratista);

      if (!resultado.ok) { problemas.push(resultado.error); continue; }
      (item.existente ? actualizadas : creadas).push(resultado.resumen);
    }

    const quedaron = plan.filter((p) => p.grupo.accion !== "denunciar" && !p.entra).length + sinEmpezar;

    return NextResponse.json({ creadas, actualizadas, problemas, quedaron, pendientes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// ── El plan: lo único que la vista previa y la generación comparten ─────────

/**
 * Qué órdenes salen y qué lleva cada una. **Es la cuenta única.**
 *
 * Trae lo que hace falta de la base —nombres de sectores y equipos, y la orden
 * que ya tiene cada grupo que suma— y después sólo llama a `enOrdenes` y a
 * `valoresDeLaOrden`.
 */
async function armarElPlan(
  admin: Admin,
  renglones: readonly RenglonDelCuaderno[],
  contratista: string
): Promise<ItemDelPlan[]> {
  const grupos = enOrdenes(renglones);

  const sectorIds = [...new Set(grupos.map((g) => g.sector_id).filter((s): s is string => !!s))];
  const equipoIds = [...new Set(grupos.map((g) => g.equipo_id).filter((e): e is string => !!e))];
  const ordenIds = [...new Set(
    grupos.filter((g) => g.accion === "sumar").flatMap((g) => g.ot_existentes)
  )];

  const sectores = new Map<string, SectorConNombre>();
  const equipos = new Map<string, EquipoConNombre>();
  const existentes = new Map<string, OrdenExistente>();

  for (const lote of enLotes(sectorIds)) {
    const { data, error } = await admin.from("sectores").select("id, nombre, codigo").in("id", lote);
    if (error) throw new Error(`No se pudieron leer los sectores: ${error.message}`);
    for (const s of data ?? []) sectores.set(s.id, { nombre: s.nombre, codigo: s.codigo });
  }
  for (const lote of enLotes(equipoIds)) {
    const { data, error } = await admin.from("equipos").select("id, name, code").in("id", lote);
    if (error) throw new Error(`No se pudieron leer los equipos: ${error.message}`);
    for (const e of data ?? []) equipos.set(e.id, { name: e.name, code: e.code });
  }
  for (const lote of enLotes(ordenIds)) {
    const { data, error } = await admin
      .from("ordenes_trabajo")
      .select("id, ot_number, fecha_cierre, costo, repuesto")
      .in("id", lote);
    if (error) throw new Error(`No se pudieron leer las órdenes que ya existen: ${error.message}`);
    for (const o of data ?? []) {
      existentes.set(o.id, {
        id: o.id,
        ot_number: o.ot_number as number,
        fecha_cierre: (o.fecha_cierre as string | null) ?? null,
        costo: o.costo === null || o.costo === undefined ? null : Number(o.costo),
        repuesto: (o.repuesto as string | null) ?? null,
      });
    }
  }

  let entradas = 0;
  return grupos.map((grupo) => {
    const existente = grupo.accion === "sumar" ? existentes.get(grupo.ot_existentes[0]) ?? null : null;
    const valores = valoresDeLaOrden(
      grupo,
      {
        sector: grupo.sector_id ? sectores.get(grupo.sector_id) ?? null : null,
        equipo: grupo.equipo_id ? equipos.get(grupo.equipo_id) ?? null : null,
        contratista,
      },
      existente ? { costo: existente.costo, repuesto: existente.repuesto } : undefined
    );

    // El tope cuenta lo que llama a Google. Denunciar no llama a nada.
    const entra = grupo.accion !== "denunciar" && entradas < TOPE_POR_CORRIDA;
    if (entra) entradas++;
    return { grupo, valores, existente, entra };
  });
}

/**
 * Las OT del contratista que ya existen en el período de las órdenes que se
 * van a crear y que no son de esta carga (ver «El freno de los duplicados»).
 *
 * El contratista se busca por **nombre** —`ordenes_trabajo.contratista` es
 * texto, no un id— y sin distinguir mayúsculas, porque las que se cargaron a
 * mano lo escribieron como quisieron. Con `traerTodo()`: un año de un
 * contratista pasa las 1000 filas.
 */
async function buscarPosiblesDuplicados(
  admin: Admin,
  renglones: readonly RenglonDelCuaderno[],
  seCrean: readonly GrupoDeCuaderno[],
  contratista: string
): Promise<OrdenParaComparar[]> {
  const nuevas = seCrean.filter((g) => g.accion === "crear");
  const desdes = nuevas.map((g) => g.desde).filter((f): f is string => !!f).sort();
  const hastas = nuevas.map((g) => g.hasta).filter((f): f is string => !!f).sort();
  if (desdes.length === 0 || hastas.length === 0) return [];

  // \, % y _ son comodines de ilike: un nombre con uno no debe leerse como patrón.
  const patron = contratista.replace(/[\\%_]/g, (c) => `\\${c}`);

  const candidatas = await traerTodo<{ id: string; ot_number: number; fecha: string | null }>((d, h) =>
    admin
      .from("ordenes_trabajo")
      .select("id, ot_number, fecha")
      .ilike("contratista", patron)
      .gte("fecha", desdes[0])
      .lte("fecha", hastas[hastas.length - 1])
      .order("id")
      .range(d, h)
  );

  const deEstaCarga = new Set(renglones.map((r) => r.orden_trabajo_id).filter((o): o is string => !!o));
  return posiblesDuplicados(nuevas, candidatas, deEstaCarga);
}

/** Lo que la pantalla muestra de cada orden de la vista previa. */
function paraMostrar({ grupo, valores, existente, entra }: ItemDelPlan) {
  return {
    clave: grupo.clave,
    accion: grupo.accion,
    /** Va en esta corrida; el resto queda para apretar de nuevo. */
    entra,
    tarea: grupo.tarea,
    sector: valores.sector_nombre,
    equipo: valores.equipo_raw,
    tiene_equipo: Boolean(valores.equipment_id),
    horas: valores.horas,
    costo: valores.costo,
    /** Lo que va en `REPUESTO UTILIZADO`: el mismo texto que se escribe. */
    repuesto: valores.repuesto,
    fecha_cierre: valores.fecha_cierre,
    renglones: grupo.renglon_ids.length,
    renglones_nuevos: grupo.renglon_ids_sin_ot.length,
    ot_existente: existente?.ot_number ?? null,
    descripcion: valores.descripcion,
    ...valoresFijos(valores),
  };
}

function valoresFijos(v: ValoresDeLaOrden) {
  return { especialidad: v.especialidad, tipo: v.tipo, quien: v.quien, estado: v.estado };
}

/** Cómo nombrar un grupo en un mensaje de error. */
function comoDecirla(grupo: GrupoDeCuaderno): string {
  const cuando = grupo.desde && grupo.hasta && grupo.desde !== grupo.hasta
    ? `${grupo.desde} al ${grupo.hasta}`
    : grupo.hasta ?? grupo.desde ?? "sin fecha";
  return `«${grupo.tarea}» (${cuando})`;
}

type Resumen = { ot_number: number; tarea: string; sector: string; horas: number; costo: number | null };
type Resultado = { ok: true; resumen: Resumen } | { ok: false; error: string };

/**
 * Marca los renglones con su orden, **sólo los que todavía no tenían una**.
 *
 * `orden_trabajo_id is null` también en el update: si otro pedido los convirtió
 * entre la lectura y acá, no se les pisa la orden. Devuelve cuántos marcó, para
 * que quien llama compare con los que esperaba.
 */
async function marcarLosRenglones(admin: Admin, ids: readonly string[], ordenId: string) {
  let marcados = 0;
  for (const lote of enLotes(ids)) {
    const { data, error } = await admin
      .from("mant_cuadernos_renglones")
      .update({ orden_trabajo_id: ordenId })
      .in("id", lote)
      .is("orden_trabajo_id", null)
      .select("id");
    if (error) return { error: error.message, marcados };
    marcados += (data ?? []).length;
  }
  return { error: null, marcados };
}

/**
 * ¿Alguno de estos renglones ya tiene orden? Es la relectura de justo antes de
 * escribir: si otro pedido los convirtió mientras éste armaba el plan, crear
 * otra orden sería duplicar horas en una planilla de la que no se vuelve.
 */
async function yaConvertidos(admin: Admin, ids: readonly string[]): Promise<number | string> {
  let convertidos = 0;
  for (const lote of enLotes(ids)) {
    const { data, error } = await admin
      .from("mant_cuadernos_renglones")
      .select("id")
      .in("id", lote)
      .not("orden_trabajo_id", "is", null);
    if (error) return error.message;
    convertidos += (data ?? []).length;
  }
  return convertidos;
}

// ── Sumar a una que existe ──────────────────────────────────

/**
 * Le reescribe a una OT que ya existe el total de su grupo.
 *
 * **Primero la planilla**: la descripción, el repuesto y la fecha de ejecución
 * del master son derrame de «Altas del sistema», así que se corrigen allá (ver
 * el encabezado). Si eso falla, no se toca la base y no se marca ningún
 * renglón: el grupo queda como estaba y se puede volver a intentar.
 *
 * **La fecha de cierre sólo avanza.** Si alguien la movió más allá del último
 * día del grupo, no se la trae hacia atrás.
 */
async function actualizarLaOT(
  admin: Admin,
  { grupo, valores }: ItemDelPlan,
  existente: OrdenExistente
): Promise<Resultado> {
  const cierre = (existente.fecha_cierre ?? "") > (valores.fecha_cierre ?? "")
    ? (existente.fecha_cierre as string)
    : (valores.fecha_cierre as string);

  const convertidos = await yaConvertidos(admin, grupo.renglon_ids_sin_ot);
  if (typeof convertidos === "string" || convertidos > 0) {
    return {
      ok: false,
      error:
        `${comoDecirla(grupo)}: ${typeof convertidos === "string"
          ? `no se pudo comprobar el estado de los renglones (${convertidos})`
          : "alguno de los renglones se convirtió en una orden mientras tanto"}. ` +
        `No se tocó nada: volvé a mirar la vista previa.`,
    };
  }

  const falloLaPlanilla = await corregirLaAlta(existente.ot_number, {
    descripcion: valores.descripcion,
    // Sin repuesto no hay nada que escribir: vaciarlo no es una decisión de acá.
    ...(valores.repuesto !== null ? { repuesto: valores.repuesto } : {}),
    fecha_ejecucion: cierre,
  });
  if (falloLaPlanilla) {
    return {
      ok: false,
      error:
        `${comoDecirla(grupo)}: no se pudo corregir la OT ${existente.ot_number} en la planilla, ` +
        `así que no se tocó nada. ${falloLaPlanilla}`,
    };
  }

  const { data: actualizada, error } = await admin
    .from("ordenes_trabajo")
    .update({
      horas: valores.horas,
      costo: valores.costo,
      ...(valores.repuesto !== null ? { repuesto: valores.repuesto } : {}),
      descripcion: valores.descripcion,
      fecha_cierre: cierre,
      fecha_ejecucion: cierre,
      estado: valores.estado,
    })
    .eq("id", existente.id)
    .select()
    .single();

  if (error) {
    return {
      ok: false,
      error:
        `${comoDecirla(grupo)}: la OT ${existente.ot_number} ya quedó corregida en la planilla ` +
        `pero no se pudo guardar en el sistema (${error.message}). La próxima sincronización ` +
        `la va a traer; no generes de nuevo o se le vuelve a sumar.`,
    };
  }

  // Las horas y el cierre sí son columnas literales del master: se escriben ahí
  // y, si no se puede, queda anotado para que lo termine la sincronización.
  const paraLaPlanilla = loQueHayQueExportar(actualizada);
  if (paraLaPlanilla) {
    const pendiente = await escribirEnLaFilaDeLaOT(
      actualizada, celdasParaRegistrar(paraLaPlanilla as RegistroDeOT)
    );
    await admin
      .from("ordenes_trabajo")
      .update({ sheets_pendiente: pendiente, sheets_intentado_en: new Date().toISOString() })
      .eq("id", existente.id);
  }

  const marca = await marcarLosRenglones(admin, grupo.renglon_ids_sin_ot, existente.id);
  if (marca.error || marca.marcados !== grupo.renglon_ids_sin_ot.length) {
    return {
      ok: false,
      error:
        `${comoDecirla(grupo)}: la OT ${existente.ot_number} quedó con ${valores.horas} h pero ` +
        `los renglones nuevos no se marcaron del todo (${marca.error ?? `${marca.marcados} de ${grupo.renglon_ids_sin_ot.length}`}). ` +
        `**Si volvés a generar, se le vuelven a sumar**: revisá esos renglones antes.`,
    };
  }

  return {
    ok: true,
    resumen: {
      ot_number: existente.ot_number, tarea: grupo.tarea, sector: valores.sector_nombre,
      horas: valores.horas, costo: valores.costo,
    },
  };
}

// ── Crear una ───────────────────────────────────────────────

/**
 * Crea una OT a partir de un grupo, por el mismo camino que el alta a mano.
 *
 * **Primero la planilla y después la base**, que es la regla del módulo: la
 * planilla manda, una orden existe cuando tiene su fila, y si el alta falla no
 * se creó nada en ningún lado ni se consumió ningún número.
 *
 * Los renglones se marcan **al final y sólo si la OT quedó**. Marcarlos antes
 * dejaría horas del cuaderno sin orden y sin forma de volver a intentarlas.
 */
async function crearLaOT(
  admin: Admin,
  userId: string,
  { grupo, valores }: ItemDelPlan,
  contratista: string
): Promise<Resultado> {
  const convertidos = await yaConvertidos(admin, grupo.renglon_ids_sin_ot);
  if (typeof convertidos === "string" || convertidos > 0) {
    return {
      ok: false,
      error:
        `${comoDecirla(grupo)}: ${typeof convertidos === "string"
          ? `no se pudo comprobar el estado de los renglones (${convertidos})`
          : "alguno de los renglones se convirtió en una orden mientras tanto"}. ` +
        `No se creó nada: volvé a mirar la vista previa.`,
    };
  }

  // Baja a propósito: es trabajo ya hecho. Una prioridad alta en una orden
  // cerrada sólo ensucia los tableros que ordenan por ella.
  const prioridad = prioridadParaLaPlanilla("BAJA");

  const alta = await altaEnLaPlanilla({
    creado: new Date(),
    email: null,
    nombre: "Cuaderno de",
    apellido: contratista,
    sector: valores.sector_nombre || null,
    equipo: valores.equipo_raw,
    especialidad: valores.especialidad,
    tipo: valores.tipo,
    quien: valores.quien,
    descripcion: valores.descripcion,
    // El costo viaja acá: es la columna I, donde ya se lo escribía a mano.
    repuesto: valores.repuesto,
    fecha_ejecucion: valores.fecha_cierre,
    prioridad,
  });

  if (!alta.ok) {
    return {
      ok: false,
      error: `${comoDecirla(grupo)}: no se pudo escribir en la planilla, así que no se creó. ${alta.error}`,
    };
  }

  const ahora = new Date().toISOString();
  const { data: creada, error } = await admin
    .from("ordenes_trabajo")
    .insert({
      ot_number: alta.ot_number,
      fecha: valores.fecha,
      sector_id: valores.sector_id,
      sector_raw: valores.sector_nombre || null,
      equipo_raw: valores.equipo_raw,
      equipo_code: valores.equipo_code,
      equipment_id: valores.equipment_id,
      especialidad: valores.especialidad,
      tipo: valores.tipo,
      quien: valores.quien,
      descripcion: valores.descripcion,
      repuesto: valores.repuesto,
      costo: valores.costo,
      fecha_ejecucion: valores.fecha_cierre,
      fecha_cierre: valores.fecha_cierre,
      estado: valores.estado,
      contratista,
      horas: valores.horas,
      prioridad,
      app_created: true,
      created_by: userId,
      created_at_app: ahora,
      synced_at: ahora,
    })
    .select()
    .single();

  if (error) {
    return {
      ok: false,
      error:
        `${comoDecirla(grupo)}: la OT ${alta.ot_number} quedó escrita en la planilla pero no se ` +
        `pudo guardar en el sistema (${error.message}). Va a entrar en la próxima ` +
        `sincronización; no la generes de nuevo o quedan dos.`,
    };
  }

  // El estado, el cierre y las horas viven en las columnas literales del
  // master, y acá casi nunca se puede escribir: la fila llega por
  // `IMPORTRANGE` y tarda. Se intenta y, si no, queda anotado para que lo
  // termine la sincronización — sin esto el cron lee la M vacía y pisa el
  // estado, y la O vacía y pisa las horas con null.
  const paraLaPlanilla = loQueHayQueExportar(creada);
  if (paraLaPlanilla) {
    const pendiente = await escribirEnLaFilaDeLaOT(
      creada, celdasParaRegistrar(paraLaPlanilla as RegistroDeOT)
    );
    await admin
      .from("ordenes_trabajo")
      .update({ sheets_pendiente: pendiente, sheets_intentado_en: new Date().toISOString() })
      .eq("id", creada.id);
  }

  const marca = await marcarLosRenglones(admin, grupo.renglon_ids_sin_ot, creada.id);
  if (marca.error || marca.marcados !== grupo.renglon_ids_sin_ot.length) {
    return {
      ok: false,
      error:
        `${comoDecirla(grupo)}: se creó la OT ${alta.ot_number} pero los renglones no quedaron ` +
        `marcados del todo (${marca.error ?? `${marca.marcados} de ${grupo.renglon_ids_sin_ot.length}`}). ` +
        `**Si volvés a generar, se crea otra vez**: revisá esos renglones antes.`,
    };
  }

  return {
    ok: true,
    resumen: {
      ot_number: alta.ot_number, tarea: grupo.tarea, sector: valores.sector_nombre,
      horas: valores.horas, costo: valores.costo,
    },
  };
}
