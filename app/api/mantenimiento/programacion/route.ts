import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";
import { hoyEnArgentina, semanaDe } from "@/lib/core/fechas";
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
  estaAusente,
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una fecha "YYYY-MM-DD" que existe en el calendario. */
function esFechaIso(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
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

  // La referencia no obliga a que haya una sola fila: gana la más nueva, que es
  // también lo que permite volver a anclar el ciclo sin borrar la historia.
  const { data: filasRef, error: errRef } = await db
    .from("mant_programacion_referencia")
    .select("lunes, grupo_en_4a12, electricista_4a12_id, electricista_8a16_id, electricista_12a20_id")
    .order("lunes", { ascending: false })
    .limit(1);
  if (errRef) return NextResponse.json({ error: errRef.message }, { status: 500 });

  const filaRef = filasRef?.[0];
  if (!filaRef) return NextResponse.json({ sinReferencia: true, dias });

  const ref: Referencia = {
    lunes: filaRef.lunes,
    grupoEn4a12: filaRef.grupo_en_4a12 as Grupo,
    electricistas: {
      "4-12": filaRef.electricista_4a12_id,
      "8-16": filaRef.electricista_8a16_id,
      "12-20": filaRef.electricista_12a20_id,
    },
  };

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
    desde: f.desde,
    hasta: f.hasta,
  }));

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
    ausencias = todas.filter((a) => idsDelPadron.has(a.empleado_id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // ── Las asignaciones: el ciclo, y encima las pisadas ─────────
  const pisadasPorDia = new Map<string, Turno>();
  for (const p of filasPisadas ?? []) pisadasPorDia.set(`${p.empleado_id}|${p.dia}`, p.turno as Turno);

  const asignaciones: Asignacion[] = [];
  const yaAsignados = new Set<string>();

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
      // Un electricista que no es uno de los tres de la referencia no tiene
      // turno por ciclo: queda sin asignar hasta que lo muevan a mano.
      if (!turno) continue;

      yaAsignados.add(clave);
      asignaciones.push({ empleadoId: persona.empleadoId, dia, turno, pisada: pisada !== undefined });
    }
  }

  // ── Quién falta, y por cada hueco, quién puede taparlo ───────
  const hayAusencia = (empleadoId: string, dia: string) => estaAusente(ausencias, empleadoId, dia);
  // El oficio que tenía ese día: si cambió a mitad de semana, hay dos filas.
  const oficioEseDia = (empleadoId: string, dia: string) =>
    padron.find((p) => p.empleadoId === empleadoId && estaVigente(p, dia))!.oficio;

  const ausentes: { empleadoId: string; dia: string }[] = [];
  const candidatos: Record<string, string[]> = {};

  for (const a of asignaciones) {
    if (!hayAusencia(a.empleadoId, a.dia)) continue;
    ausentes.push({ empleadoId: a.empleadoId, dia: a.dia });

    const oficio = oficioEseDia(a.empleadoId, a.dia);
    const clave = `${a.dia}|${a.turno}|${oficio}`;
    if (!(clave in candidatos)) {
      candidatos[clave] = candidatosParaElHueco(asignaciones, hayAusencia, padron, {
        dia: a.dia,
        turno: a.turno,
        oficio,
      });
    }
  }

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

  return NextResponse.json({
    dias,
    asignaciones,
    ausentes,
    candidatos,
    personas: [...personasPorId.values()],
  });
}
