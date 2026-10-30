import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";
import { esFechaIso, hoyEnArgentina, semanaDe } from "@/lib/core/fechas";
import { traerTodo } from "@/lib/core/paginado";
import {
  turnoDelElectricista,
  turnoDelGrupo,
  type Grupo,
  type Oficio,
  type Referencia,
  type Turno,
} from "@/lib/mantenimiento/programacion";
import {
  candidatosParaElHueco,
  type FrancoCrudo,
  noViene,
  estaVigente,
  type Asignacion,
  type AusenciaCruda,
  type PersonaDelTaller,
} from "@/lib/mantenimiento/disponibilidad";

/**
 * La semana del taller: quién está en qué turno cada día, quién falta y quién
 * puede tapar el hueco. Sólo la ve el admin de Mantenimiento.
 *
 * La grilla no se guarda: sale de la referencia y del ciclo, y encima de eso
 * ganan las pisadas que el encargado hizo a mano. Ver el spec
 * docs/superpowers/specs/2026-10-22-mantenimiento-disponibilidad-y-turnos-design.md.
 */

/**
 * Una fecha que vino de la base, como `YYYY-MM-DD` pelado.
 *
 * Es la misma defensa que aplican las rutas hermanas (`ausencias`,
 * `referencia`, `personal`): las columnas son `date` y hoy PostgREST las
 * devuelve sin hora, pero el corte cuesta nada y lo que hay del otro lado deja
 * de depender de eso. Acá importa más que en las otras, porque lo que se hace
 * con estas fechas no es comparar texto sino **contar semanas**: un
 * `"2026-10-26T00:00:00"` le daría `NaN` a `semanasDesdeLaReferencia`, todos
 * los turnos saldrían `undefined` y el taller entero caería en `sinTurno`. O
 * sea una grilla vacía sin un solo error, que es exactamente lo que esta
 * pantalla no puede hacer.
 */
function soloElDia(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "La programación del taller requiere ser admin de Mantenimiento" },
      { status: 403 }
    );
  }

  // Cualquier día de la semana vale: se normaliza al lunes. Sin parámetro, la de hoy.
  const pedido = new URL(request.url).searchParams.get("lunes") ?? hoyEnArgentina();
  if (!esFechaIso(pedido)) {
    return NextResponse.json({ error: "La fecha tiene que ser AAAA-MM-DD" }, { status: 400 });
  }
  const dias = semanaDe(pedido);
  const lunes = dias[0];
  const domingo = dias[6];

  const db = createAdminClient();

  // El padrón que rige en algún día de esa semana (vigencia que cruza el rango).
  const { data: filasPadron, error: errPadron } = await db
    .from("mant_personal_taller")
    .select("empleado_id, oficio, grupo, desde, hasta, empleados(nombre, apellido)")
    .lte("desde", domingo)
    .or(`hasta.is.null,hasta.gte.${lunes}`)
    .order("desde");
  if (errPadron) return NextResponse.json({ error: errPadron.message }, { status: 500 });

  const padron: PersonaDelTaller[] = (filasPadron ?? []).map((f) => ({
    empleadoId: f.empleado_id,
    oficio: f.oficio as Oficio,
    grupo: f.grupo as Grupo | null,
    desde: soloElDia(f.desde),
    hasta: f.hasta === null ? null : soloElDia(f.hasta),
  }));

  // ── Las personas, con el nombre, para que la pantalla no tenga que buscarlas ──
  const nombreDe = new Map<string, string>();
  for (const f of filasPadron ?? []) {
    const e = Array.isArray(f.empleados) ? f.empleados[0] : f.empleados;
    nombreDe.set(f.empleado_id, e ? `${e.nombre} ${e.apellido}` : "(sin nombre)");
  }

  // Una persona que cambió de grupo a mitad de semana tiene dos filas de padrón;
  // en la lista va una sola, con la vigencia más reciente (el padrón viene por `desde`).
  const personasPorId = new Map<
    string,
    { empleadoId: string; nombre: string; oficio: Oficio; grupo: Grupo | null }
  >();
  for (const p of padron) {
    personasPorId.set(p.empleadoId, {
      empleadoId: p.empleadoId,
      nombre: nombreDe.get(p.empleadoId) ?? "(sin nombre)",
      oficio: p.oficio,
      grupo: p.grupo,
    });
  }
  const personas = [...personasPorId.values()];

  // Qué referencia rige esa semana. NO la más nueva a secas: si alguien vuelve a
  // anclar el ciclo, una semana pasada se recalcularía con el ancla nueva y
  // cambiaría lo que el encargado vio en su momento, que es lo mismo que la
  // migración rechaza para el padrón. Rige la más nueva que no sea posterior a
  // la semana pedida.
  const { data: filasRef, error: errRef } = await db
    .from("mant_programacion_referencia")
    .select("lunes, grupo_en_4a12, electricista_4a12_id, electricista_8a16_id, electricista_12a20_id")
    .lte("lunes", lunes)
    .order("lunes", { ascending: false })
    .limit(1);
  if (errRef) return NextResponse.json({ error: errRef.message }, { status: 500 });

  // Antes de la primera ancla no hay una que rija: se toma la más vieja y el
  // ciclo se extrapola hacia atrás. Eso supone que la rotación corría igual
  // entonces, y es lo que permite mirar semanas anteriores a la carga.
  let filaRef = filasRef?.[0];
  if (!filaRef) {
    const { data: masVieja, error: errVieja } = await db
      .from("mant_programacion_referencia")
      .select("lunes, grupo_en_4a12, electricista_4a12_id, electricista_8a16_id, electricista_12a20_id")
      .order("lunes", { ascending: true })
      .limit(1);
    if (errVieja) return NextResponse.json({ error: errVieja.message }, { status: 500 });
    filaRef = masVieja?.[0];
  }

  // Sin referencia no hay ciclo, pero el padrón se lee igual: la pantalla puede
  // decir "falta cargar la referencia" y mostrar a quién tiene el taller.
  if (!filaRef) {
    return NextResponse.json({
      sinReferencia: true,
      dias,
      asignaciones: [],
      ausentes: [],
      candidatos: {},
      sinTurno: [],
      personas,
    });
  }

  const ref: Referencia = {
    lunes: soloElDia(filaRef.lunes),
    grupoEn4a12: filaRef.grupo_en_4a12 as Grupo,
    electricistas: {
      "4-12": filaRef.electricista_4a12_id,
      "8-16": filaRef.electricista_8a16_id,
      "12-20": filaRef.electricista_12a20_id,
    },
  };

  const { data: filasPisadas, error: errPisadas } = await db
    .from("mant_programacion_pisadas")
    .select("empleado_id, dia, turno")
    .gte("dia", lunes)
    .lte("dia", domingo);
  if (errPisadas) return NextResponse.json({ error: errPisadas.message }, { status: 500 });

  // `ausencias` está cerrada con tiene_acceso_rrhh(): se lee con el cliente
  // admin, sin abrirle ninguna policy a Mantenimiento. Se trae el `tipo` porque
  // `estaAusente` lo necesita para no contar la tardanza, pero NO sale de acá:
  // es dato médico y disciplinario, y el diseño lo deja afuera a propósito.
  const idsDelPadron = new Set(padron.map((p) => p.empleadoId));
  let ausencias: AusenciaCruda[];
  try {
    const todas = await traerTodo<AusenciaCruda>((desde, hasta) =>
      db
        .from("ausencias")
        .select("empleado_id, fecha_desde, fecha_hasta, tipo")
        .lte("fecha_desde", domingo)
        .gte("fecha_hasta", lunes)
        .order("id")
        .range(desde, hasta)
    );
    // Filtrar acá y no con `.in()`: una lista larga de ids arma una URL que
    // PostgREST rechaza con un 400 sin decir por qué.
    ausencias = todas
      .filter((a) => idsDelPadron.has(a.empleado_id))
      .map((a) => ({ ...a, fecha_desde: soloElDia(a.fecha_desde), fecha_hasta: soloElDia(a.fecha_hasta) }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  /*
   * Los francos que se descansan esta semana.
   *
   * Un franco tomado es un día que la persona no viene, igual que una ausencia,
   * y hasta el 26/10/2026 este cruce no podía mirarlos: la única fecha que
   * había era `fecha_tomado`, que es el día en que alguien apretó el botón y no
   * el del descanso —los 56 francos tomados de entonces caen en tres fechas, y
   * cruzarlos habría pintado 35 huecos un lunes—. Desde esa fecha el día real
   * se carga en `fecha_descanso` al marcarlo.
   *
   * Por eso se filtra por `fecha_descanso` y nunca por `fecha_tomado`: los
   * francos viejos tienen la primera en null y no abren hueco, que es la
   * verdad. `francos` también está cerrada con tiene_acceso_rrhh(), así que va
   * con el cliente admin; no trae nada sensible —ni motivo ni tipo— y de acá
   * sale sólo quién no viene y qué día.
   */
  let francos: FrancoCrudo[];
  try {
    const todos = await traerTodo<FrancoCrudo>((desde, hasta) =>
      db
        .from("francos")
        .select("empleado_id, estado, fecha_descanso")
        .eq("estado", "TOMADO")
        .gte("fecha_descanso", lunes)
        .lte("fecha_descanso", domingo)
        .order("id")
        .range(desde, hasta)
    );
    francos = todos
      .filter((f) => idsDelPadron.has(f.empleado_id))
      .map((f) => ({ ...f, fecha_descanso: f.fecha_descanso ? soloElDia(f.fecha_descanso) : null }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // ── Las asignaciones: el ciclo, y encima las pisadas ─────────
  const pisadasPorDia = new Map<string, Turno>();
  for (const p of filasPisadas ?? []) pisadasPorDia.set(`${p.empleado_id}|${soloElDia(p.dia)}`, p.turno as Turno);

  const asignaciones: Asignacion[] = [];
  const yaAsignados = new Set<string>();
  // En el padrón ese día pero sin turno por ciclo ni pisada. Hoy: un electricista
  // que no es uno de los tres de la referencia. Se dice aparte para que la
  // pantalla no tenga que deducirlo de lo que falta.
  const sinTurno: { empleadoId: string; dia: string }[] = [];

  for (const dia of dias) {
    for (const persona of padron) {
      if (!estaVigente(persona, dia)) continue;
      const clave = `${persona.empleadoId}|${dia}`;
      if (yaAsignados.has(clave)) continue; // vigencias que se superponen: no debería pasar

      const pisada = pisadasPorDia.get(clave);
      const delCiclo =
        persona.oficio === "electricista"
          ? turnoDelElectricista(ref, lunes, persona.empleadoId)
          : persona.grupo
            ? turnoDelGrupo(ref, lunes, persona.grupo)
            : null;

      const turno = pisada ?? delCiclo;
      if (!turno) {
        sinTurno.push({ empleadoId: persona.empleadoId, dia });
        continue;
      }

      yaAsignados.add(clave);
      asignaciones.push({ empleadoId: persona.empleadoId, dia, turno, pisada: pisada !== undefined });
    }
  }

  // ── Quién falta, y por cada hueco, quién puede taparlo ───────
  // Las dos razones por las que alguien no viene —una ausencia cargada o un
  // franco que descansa— se preguntan en un solo lugar, para que no puedan
  // calcularse distinto en la grilla y en los candidatos.
  const noVieneEseDia = (empleadoId: string, dia: string) =>
    noViene(ausencias, francos, empleadoId, dia);
  // El oficio que tenía ese día: si cambió a mitad de semana, hay dos filas.
  const oficioEseDia = (empleadoId: string, dia: string) =>
    padron.find((p) => p.empleadoId === empleadoId && estaVigente(p, dia))!.oficio;

  const ausentes: { empleadoId: string; dia: string; turno: Turno; oficio: Oficio }[] = [];
  const candidatos: Record<string, string[]> = {};

  for (const a of asignaciones) {
    if (!noVieneEseDia(a.empleadoId, a.dia)) continue;
    // Se manda el turno y el oficio *de ese día*, que son los ingredientes de la
    // clave de `candidatos`: así la pantalla no los reconstruye desde `personas`,
    // cuyo oficio es el de la última vigencia.
    const oficio = oficioEseDia(a.empleadoId, a.dia);
    ausentes.push({ empleadoId: a.empleadoId, dia: a.dia, turno: a.turno, oficio });
    const clave = `${a.dia}|${a.turno}|${oficio}`;
    if (!(clave in candidatos)) {
      candidatos[clave] = candidatosParaElHueco(asignaciones, noVieneEseDia, padron, {
        dia: a.dia,
        turno: a.turno,
        oficio,
      });
    }
  }

  return NextResponse.json({
    dias,
    asignaciones,
    ausentes,
    candidatos,
    sinTurno,
    personas,
  });
}
