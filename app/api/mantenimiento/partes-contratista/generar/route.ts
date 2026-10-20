import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { traerTodo } from "@/lib/core/paginado";
import { altaEnLaPlanilla } from "@/lib/mantenimiento/formulario";
import { escribirEnLaFilaDeLaOT } from "@/lib/mantenimiento/planillaDeOT";
import { celdasParaRegistrar, type RegistroDeOT } from "@/lib/mantenimiento/ordenes";
import { loQueHayQueExportar } from "@/lib/mantenimiento/cierreDeOT";
import { prioridadParaLaPlanilla } from "@/lib/mantenimiento/prioridad";
import {
  agruparEnOrdenes, descripcionDeLaOT,
  type RenglonParaAgrupar, type GrupoDeOT,
} from "@/lib/mantenimiento/partesDeContratista";

/**
 * Las OT que salen de los partes diarios de un contratista.
 *
 * Una OT por **(semana, actividad, sector)**, ya realizada, con las horas
 * sumadas. Es lo que se pidió —"una OT cada semana, por sector"— y lo que hace
 * que quince hojas de papel se puedan leer como trabajo.
 *
 * ── POR QUÉ ESTOS VALORES Y NO OTROS ────────────────────────────────────────
 *
 * No se eligieron: **se midieron sobre lo que ya se venía haciendo a mano.**
 * De las 156 OT de CANDIA que hay en el sistema al 20/10/2026, 147 son
 * `CIVIL/PROGRAMADO`, todas con `quien = CONTRATADO`. Las últimas ocho —2716 a
 * 2723— son exactamente una tanda de quincena cargada a mano: una por sector,
 * con sus horas y "Limpieza general" de descripción.
 *
 * ── Y POR QUÉ LA OT PUEDE NO TENER EQUIPO ───────────────────────────────────
 *
 * "Toda OT lleva equipo" rige desde el 19/10/2026 y acá hay una excepción, con
 * dos razones medidas. La primera: **118 de esas 156 ya no lo tienen** — el
 * formulario les pone `EQUIPO = "PO-A3 - Edificio"`, que es un texto de la
 * lista y no una máquina del catálogo. La segunda: la agrupación es por
 * sector, así que una semana de limpieza que tocó el horno y además las cintas
 * no es de ninguna de las dos máquinas, y quedarse con una le daría a su MTBF
 * las horas de la otra.
 *
 * Así que el `equipo_raw` dice "<código> - Edificio" como viene diciendo, y el
 * `equipment_id` se llena **sólo cuando todos los renglones del grupo apuntan
 * al mismo equipo** — que es el caso de "Horno N°1" o "Molino horizontal".
 */

/** Lo que la práctica ya venía usando. Se puede cambiar desde el cuerpo. */
const ESPECIALIDAD_POR_DEFECTO = "CIVIL";
const TIPO_POR_DEFECTO = "PROGRAMADO";

/**
 * Cuántas OT se crean de una corrida.
 *
 * Cada alta son cinco llamadas a Google en serie —la serie no se puede pedir
 * en paralelo sin repartir el mismo número dos veces—, así que una quincena de
 * quince hojas tarda minutos. El tope existe para que un pedido no se corte a
 * la mitad sin que nadie sepa por dónde iba: lo que queda se genera apretando
 * de nuevo, y lo ya generado no se repite.
 */
const TOPE_POR_CORRIDA = 25;

interface DatosDelParte {
  numero: number;
  fecha: string;
  proveedor_id: string;
}

interface FilaDeRenglon {
  id: string;
  actividad: string;
  lugar_raw: string;
  sector_id: string | null;
  equipo_id: string | null;
  horas: number;
  /**
   * El embed del parte, en **las dos formas**.
   *
   * La relación es de uno a uno, así que PostgREST devuelve un objeto; el
   * cliente sin tipos generados la infiere como arreglo igual. Es la misma
   * ambigüedad que resuelve `valorHoraDe()` en RRHH, y por lo mismo: elegir
   * una sola forma hace que el código ande hasta que alguien genera los tipos.
   */
  mant_partes_contratista: DatosDelParte | DatosDelParte[] | null;
}

/** La fila del parte, venga como objeto o como arreglo de uno. */
function elParte(embed: FilaDeRenglon["mant_partes_contratista"]): DatosDelParte | null {
  if (!embed) return null;
  return Array.isArray(embed) ? embed[0] ?? null : embed;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await cuerpoJson(request);
  const proveedor_id = String(body?.proveedor_id ?? "").trim();
  const desde = String(body?.desde ?? "").trim();
  const hasta = String(body?.hasta ?? "").trim();
  const especialidad = String(body?.especialidad ?? "").trim() || ESPECIALIDAD_POR_DEFECTO;
  const tipo = String(body?.tipo ?? "").trim() || TIPO_POR_DEFECTO;
  // Sin esto el botón genera lo que ve y además lo que no ve. Una simulación
  // que no coincide con lo que después se crea no sirve para decidir.
  const simular = body?.simular === true;

  if (!proveedor_id) {
    return NextResponse.json({ error: "Falta decir de qué contratista" }, { status: 400 });
  }
  if (!desde || !hasta) {
    return NextResponse.json(
      { error: "Falta el rango de fechas de los partes que se van a convertir" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: proveedor } = await admin
    .from("proveedores").select("nombre").eq("id", proveedor_id).maybeSingle();
  if (!proveedor) {
    return NextResponse.json({ error: "Ese contratista no existe" }, { status: 400 });
  }

  // Sólo los que todavía no se convirtieron. Es lo que impide crear veinte
  // órdenes dos veces por apretar el botón dos veces, y vale también si entre
  // las dos corridas se cargó un parte más: se toma el nuevo y nada más.
  const filas = await traerTodo<FilaDeRenglon>((d, h) =>
    admin
      .from("mant_partes_contratista_renglones")
      // La cadena va literal: un `select()` armado en una variable —o partido
      // en dos con un `+`— pierde la inferencia de tipos de Supabase.
      .select("id, actividad, lugar_raw, sector_id, equipo_id, horas, mant_partes_contratista!inner(numero, fecha, proveedor_id)")
      .is("orden_trabajo_id", null)
      .eq("mant_partes_contratista.proveedor_id", proveedor_id)
      .gte("mant_partes_contratista.fecha", desde)
      .lte("mant_partes_contratista.fecha", hasta)
      .range(d, h)
  );

  const renglones: RenglonParaAgrupar[] = [];
  for (const f of filas) {
    const parte = elParte(f.mant_partes_contratista);
    if (!parte) continue;
    renglones.push({
      id: f.id,
      parte_numero: parte.numero,
      fecha: parte.fecha,
      actividad: f.actividad,
      lugar_raw: f.lugar_raw,
      sector_id: f.sector_id,
      equipo_id: f.equipo_id,
      horas: Number(f.horas),
    });
  }

  const { grupos, sinSector } = agruparEnOrdenes(renglones);

  // Los nombres que la planilla necesita: escribe texto, no ids.
  const nombres = await nombresDeSectoresYEquipos(admin, grupos);

  if (simular) {
    return NextResponse.json({
      simulado: true,
      grupos: grupos.map((g) => conNombres(g, nombres, proveedor.nombre)),
      sinSector: sinSector.map((r) => ({
        lugar_raw: r.lugar_raw, parte_numero: r.parte_numero, horas: r.horas,
      })),
      tope: TOPE_POR_CORRIDA,
    });
  }

  const creadas: { ot_number: number; actividad: string; sector: string; horas: number }[] = [];
  const problemas: string[] = [];

  for (const grupo of grupos.slice(0, TOPE_POR_CORRIDA)) {
    const resultado = await crearLaOT(
      admin, user.id, grupo, nombres, proveedor.nombre, especialidad, tipo
    );
    if (resultado.ok) creadas.push(resultado.resumen);
    else problemas.push(resultado.error);
  }

  const quedaron = Math.max(0, grupos.length - TOPE_POR_CORRIDA);

  return NextResponse.json({
    creadas,
    problemas,
    quedaron,
    sinSector: sinSector.map((r) => ({
      lugar_raw: r.lugar_raw, parte_numero: r.parte_numero, horas: r.horas,
    })),
  });
}

// ── Los nombres ─────────────────────────────────────────────

interface Nombres {
  sectores: Map<string, { nombre: string; codigo: string | null }>;
  equipos: Map<string, { name: string; code: string | null }>;
}

async function nombresDeSectoresYEquipos(
  admin: ReturnType<typeof createAdminClient>,
  grupos: readonly GrupoDeOT[]
): Promise<Nombres> {
  const sectorIds = [...new Set(grupos.map((g) => g.sector_id))];
  const equipoIds = [...new Set(grupos.map((g) => g.equipo_id).filter(Boolean) as string[])];

  // Son decenas, no miles: un `.in()` de este tamaño no arma una URL que
  // PostgREST rechace. Con los 42 sectores enteros tampoco habría problema.
  const [{ data: sectores }, { data: equipos }] = await Promise.all([
    sectorIds.length
      ? admin.from("sectores").select("id, nombre, codigo").in("id", sectorIds)
      : Promise.resolve({ data: [] as { id: string; nombre: string; codigo: string | null }[] }),
    equipoIds.length
      ? admin.from("equipos").select("id, name, code").in("id", equipoIds)
      : Promise.resolve({ data: [] as { id: string; name: string; code: string | null }[] }),
  ]);

  return {
    sectores: new Map((sectores ?? []).map((s) => [s.id, { nombre: s.nombre, codigo: s.codigo }])),
    equipos: new Map((equipos ?? []).map((e) => [e.id, { name: e.name, code: e.code }])),
  };
}

/**
 * Cómo se llama el equipo en la planilla.
 *
 * Con equipo, el formato que ya usan las órdenes del formulario:
 * `"PO-A3-05 - Zaranda vibratoria 1"`. Sin equipo, `"<código> - Edificio"`,
 * que es **lo que las 118 OT de CANDIA sin equipo ya dicen**: no se inventa un
 * texto nuevo para que la planilla tenga dos formas de decir lo mismo.
 */
function equipoParaLaPlanilla(grupo: GrupoDeOT, nombres: Nombres): string {
  const equipo = grupo.equipo_id ? nombres.equipos.get(grupo.equipo_id) : null;
  if (equipo) return equipo.code ? `${equipo.code} - ${equipo.name}` : equipo.name;

  const sector = nombres.sectores.get(grupo.sector_id);
  return sector?.codigo ? `${sector.codigo} - Edificio` : "Edificio";
}

function conNombres(grupo: GrupoDeOT, nombres: Nombres, contratista: string) {
  return {
    clave: grupo.clave,
    semana: grupo.semana,
    actividad: grupo.actividad,
    sector: nombres.sectores.get(grupo.sector_id)?.nombre ?? "(sector desconocido)",
    equipo: equipoParaLaPlanilla(grupo, nombres),
    tiene_equipo: Boolean(grupo.equipo_id),
    horas: grupo.horas,
    fecha_cierre: grupo.fecha_cierre,
    partes: [...new Set(grupo.detalle.map((d) => d.parte_numero))],
    descripcion: descripcionDeLaOT(grupo, contratista),
  };
}

// ── Crear una ───────────────────────────────────────────────

type Resultado =
  | { ok: true; resumen: { ot_number: number; actividad: string; sector: string; horas: number } }
  | { ok: false; error: string };

/**
 * Crea una OT a partir de un grupo, por el mismo camino que el alta a mano.
 *
 * **Primero la planilla y después la base**, que es la regla del módulo: la
 * planilla manda, una orden existe cuando tiene su fila, y si esto falla no se
 * creó nada en ningún lado ni se consumió ningún número. Es lo que el
 * 16/10/2026 no pasó y dejó a la OT 2796 con un número que la planilla todavía
 * no había repartido.
 *
 * Los renglones se marcan **al final y sólo si la OT quedó**. Marcarlos antes
 * dejaría horas del papel sin orden y sin forma de volver a intentarlas.
 */
async function crearLaOT(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  grupo: GrupoDeOT,
  nombres: Nombres,
  contratista: string,
  especialidad: string,
  tipo: string
): Promise<Resultado> {
  const sector = nombres.sectores.get(grupo.sector_id);
  const sectorNombre = sector?.nombre ?? "";
  const equipoRaw = equipoParaLaPlanilla(grupo, nombres);
  const descripcion = descripcionDeLaOT(grupo, contratista);
  const comoDecirla = `${grupo.actividad} · ${sectorNombre} · semana del ${grupo.semana}`;

  // Baja a propósito: es trabajo ya hecho. Una prioridad alta en una orden
  // cerrada sólo ensucia los tableros que ordenan por ella.
  const prioridad = prioridadParaLaPlanilla("BAJA");

  const alta = await altaEnLaPlanilla({
    creado: new Date(),
    email: null,
    nombre: "Partes de",
    apellido: contratista,
    sector: sectorNombre || null,
    equipo: equipoRaw,
    especialidad,
    tipo,
    quien: "CONTRATADO",
    descripcion,
    repuesto: null,
    fecha_ejecucion: grupo.fecha_cierre,
    prioridad,
  });

  if (!alta.ok) {
    return {
      ok: false,
      error: `${comoDecirla}: no se pudo escribir en la planilla, así que no se creó. ${alta.error}`,
    };
  }

  const record = {
    ot_number: alta.ot_number,
    fecha: grupo.fecha_cierre,
    sector_id: grupo.sector_id,
    sector_raw: sectorNombre || null,
    equipo_raw: equipoRaw,
    equipo_code: grupo.equipo_id ? nombres.equipos.get(grupo.equipo_id)?.code ?? null : null,
    equipment_id: grupo.equipo_id,
    especialidad,
    tipo,
    quien: "CONTRATADO",
    descripcion,
    fecha_ejecucion: grupo.fecha_cierre,
    fecha_cierre: grupo.fecha_cierre,
    // Nace realizada: es trabajo que ya se hizo y el papel lo prueba.
    estado: "REALIZADO",
    contratista,
    horas: grupo.horas,
    prioridad,
    app_created: true,
    created_by: userId,
    created_at_app: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  };

  const { data: creada, error } = await admin
    .from("ordenes_trabajo").insert(record).select().single();

  if (error) {
    return {
      ok: false,
      error:
        `${comoDecirla}: la OT ${alta.ot_number} quedó escrita en la planilla pero no se ` +
        `pudo guardar en el sistema (${error.message}). Va a entrar en la próxima ` +
        `sincronización; no la generes de nuevo o quedan dos.`,
    };
  }

  // El estado, el cierre y las horas viven en las columnas literales del
  // master, y acá casi nunca se puede escribir: la fila llega por
  // `IMPORTRANGE` y tarda. Se intenta y, si no, queda anotado para que lo
  // termine la sincronización — sin esto el cron de las 06:00 lee la `M`
  // vacía y pisa el estado, y la `O` vacía y pisa las horas con null.
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

  const { error: errorMarca } = await admin
    .from("mant_partes_contratista_renglones")
    .update({ orden_trabajo_id: creada.id })
    .in("id", grupo.renglon_ids);

  if (errorMarca) {
    return {
      ok: false,
      error:
        `${comoDecirla}: se creó la OT ${alta.ot_number} pero los renglones del parte no ` +
        `quedaron marcados (${errorMarca.message}). **Si volvés a generar, se crea otra ` +
        `vez**: revisá esos renglones antes.`,
    };
  }

  return {
    ok: true,
    resumen: {
      ot_number: alta.ot_number,
      actividad: grupo.actividad,
      sector: sectorNombre,
      horas: grupo.horas,
    },
  };
}
