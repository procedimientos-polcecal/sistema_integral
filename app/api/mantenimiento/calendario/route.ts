import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import { esFechaIso, sumarDias } from "@/lib/core/fechas";
import { traerTodo } from "@/lib/core/paginado";
import type { Grupo, Oficio } from "@/lib/mantenimiento/programacion";
import type {
  AusenciaCruda,
  FrancoCrudo,
  PersonaDelTaller,
} from "@/lib/mantenimiento/disponibilidad";
import { genteDelDia, type GenteDelDia } from "@/lib/mantenimiento/genteDelDia";
import {
  armarElCalendario,
  type OrdenDelCalendario,
} from "@/lib/mantenimiento/calendarioDeOT";

/**
 * El calendario de selección: un mes (o el rango que pida la grilla) de órdenes
 * de trabajo, día por día, con cuánta gente del taller hay cada uno.
 *
 * Lo abre quien elige la fecha de ejecución de una OT, para ver qué tiene cada
 * día antes de decidir. Muestra órdenes y no eventos de la agenda, y no filtra
 * por estado: ver el trabajo que hay, cerrado o no, es lo que sirve para decidir
 * dónde poner el siguiente.
 *
 * El padrón, las ausencias y los francos se leen **una sola vez para todo el
 * rango** y de ahí se arma el mapa por día: una consulta por día serían treinta
 * viajes para un mes que casi siempre está vacío.
 */

/**
 * La grilla pide un mes, y un mes con las semanas parciales de los bordes llega
 * a 42 días (seis semanas). 62 deja margen sobre ese caso, para quien pida dos
 * meses corridos; más que eso es un pedido que no es de la grilla. La
 * comparación admite `hasta` = `desde` + 62 días, o sea 63 días contando los
 * dos extremos.
 */
const MAXIMO_DE_DIAS = 62;

/** Una fecha de la base como `YYYY-MM-DD` pelado, igual que en las rutas hermanas. */
function soloElDia(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  /*
   * El permiso se comprueba acá porque el padrón, las ausencias y los francos se
   * leen con el cliente admin: están cerrados con `tiene_acceso_rrhh()` o con el
   * admin de Mantenimiento, así que con el de la sesión un usuario común
   * recibiría las tres vacías y la grilla diría «no hay nadie» sin error. De acá
   * sale sólo cuántas personas hay por oficio —ni quién, ni el motivo—.
   */
  if (!(await puedeVerMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Mantenimiento" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const desde = params.get("desde");
  const hasta = params.get("hasta");
  if (!esFechaIso(desde) || !esFechaIso(hasta)) {
    return NextResponse.json({ error: "desde y hasta tienen que ser AAAA-MM-DD" }, { status: 400 });
  }
  if (desde > hasta) {
    return NextResponse.json({ error: "desde no puede ser posterior a hasta" }, { status: 400 });
  }
  if (sumarDias(desde, MAXIMO_DE_DIAS) < hasta) {
    return NextResponse.json(
      { error: `El rango no puede pasar de ${MAXIMO_DE_DIAS} días` },
      { status: 400 }
    );
  }

  // ── Las órdenes, con el cliente de la sesión para que corran las policies ──
  /*
   * Dos `.or()` que se combinan con AND dan un superconjunto de lo que cruza el
   * rango: empieza antes del final del rango Y (termina, o empieza, después del
   * principio). La fecha de inicio es la pendiente si la hay y si no la de la
   * planilla, y eso no se puede decir en un filtro de PostgREST sin un
   * `coalesce`, así que se miran las dos. Sobran filas y `armarElCalendario` las
   * descarta con la cuenta exacta; no falta ninguna. Una OT sin ninguna fecha
   * no entra por la primera condición.
   */
  let ordenes: OrdenDelCalendario[];
  try {
    const filas = await traerTodo((d, h) =>
      supabase
        .from("ordenes_trabajo")
        .select(
          "ot_number, fecha_ejecucion, fecha_ejecucion_pendiente, fecha_fin, especialidad, tipo, quien, descripcion, sector_raw, equipo_raw"
        )
        .or(`fecha_ejecucion.lte.${hasta},fecha_ejecucion_pendiente.lte.${hasta}`)
        .or(
          `fecha_fin.gte.${desde},fecha_ejecucion.gte.${desde},fecha_ejecucion_pendiente.gte.${desde}`
        )
        .order("ot_number")
        .range(d, h)
    );
    ordenes = filas.map((f) => ({
      ...f,
      fecha_ejecucion: f.fecha_ejecucion ? soloElDia(f.fecha_ejecucion) : null,
      fecha_ejecucion_pendiente: f.fecha_ejecucion_pendiente
        ? soloElDia(f.fecha_ejecucion_pendiente)
        : null,
      fecha_fin: f.fecha_fin ? soloElDia(f.fecha_fin) : null,
    }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // ── La gente: una lectura para todo el rango ───────────────
  const db = createAdminClient();

  // `traerTodo` y no un `.select()` pelado: PostgREST corta en 1000 filas sin
  // avisar, y «el padrón es chico» es el razonamiento que la regla prohíbe. El
  // orden lleva `id` para que las páginas no repitan ni salteen filas.
  let filasPadron: {
    empleado_id: string;
    oficio: string;
    grupo: string | null;
    desde: string;
    hasta: string | null;
  }[];
  try {
    filasPadron = await traerTodo((d, h) =>
      db
        .from("mant_personal_taller")
        .select("empleado_id, oficio, grupo, desde, hasta")
        .lte("desde", hasta)
        .or(`hasta.is.null,hasta.gte.${desde}`)
        .order("desde")
        .order("id")
        .range(d, h)
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const padron: PersonaDelTaller[] = filasPadron.map((f) => ({
    empleadoId: f.empleado_id,
    oficio: f.oficio as Oficio,
    grupo: f.grupo as Grupo | null,
    desde: soloElDia(f.desde),
    hasta: f.hasta === null ? null : soloElDia(f.hasta),
  }));

  let ausencias: AusenciaCruda[] = [];
  let francos: FrancoCrudo[] = [];
  // Con el padrón vacío no hay a quién cruzar: `genteDelDia` contesta «no sé».
  if (padron.length > 0) {
    const idsDelPadron = new Set(padron.map((p) => p.empleadoId));
    try {
      // Se filtra por el padrón acá y no con `.in()`: una lista larga de ids
      // arma una URL que PostgREST rechaza con un 400 sin decir por qué.
      const todas = await traerTodo<AusenciaCruda>((d, h) =>
        db
          .from("ausencias")
          .select("empleado_id, fecha_desde, fecha_hasta, tipo")
          .lte("fecha_desde", hasta)
          .gte("fecha_hasta", desde)
          .order("id")
          .range(d, h)
      );
      ausencias = todas
        .filter((a) => idsDelPadron.has(a.empleado_id))
        .map((a) => ({
          ...a,
          fecha_desde: soloElDia(a.fecha_desde),
          fecha_hasta: soloElDia(a.fecha_hasta),
        }));

      // Por `fecha_descanso` y nunca por `fecha_tomado`, y sólo los TOMADO: un
      // franco pendiente todavía no tiene día y no abre hueco.
      const todos = await traerTodo<FrancoCrudo>((d, h) =>
        db
          .from("francos")
          .select("empleado_id, estado, fecha_descanso")
          .eq("estado", "TOMADO")
          .gte("fecha_descanso", desde)
          .lte("fecha_descanso", hasta)
          .order("id")
          .range(d, h)
      );
      francos = todos
        .filter((f) => idsDelPadron.has(f.empleado_id))
        .map((f) => ({
          ...f,
          fecha_descanso: f.fecha_descanso ? soloElDia(f.fecha_descanso) : null,
        }));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  const gentePorDia = new Map<string, GenteDelDia>();
  for (let dia = desde; dia <= hasta; dia = sumarDias(dia, 1)) {
    gentePorDia.set(dia, genteDelDia(padron, ausencias, francos, dia));
  }

  return NextResponse.json({ dias: armarElCalendario(ordenes, desde, hasta, gentePorDia) });
}
