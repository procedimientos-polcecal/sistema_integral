import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { diaDeLaSemana, esFechaIso } from "@/lib/core/fechas";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";
import { estaVigente, type PersonaDelTaller } from "@/lib/mantenimiento/disponibilidad";
import type { Grupo, Oficio } from "@/lib/mantenimiento/programacion";

/**
 * La semana de referencia: de dónde se cuenta todo el ciclo del taller.
 *
 * Es la escritura que más pesa de la programación. De esta fila salen **todas**
 * las semanas, hacia adelante y hacia atrás: mover el ancla cambia lo que la
 * pantalla muestra de semanas que ya pasaron, y el encargado vio ese pasado en
 * su momento. Por eso tiene ruta propia —con permiso, validación y registro— y
 * no una inserción desde el navegador, que era la única escritura de esta
 * pantalla que se saltaba todo eso.
 *
 * ── LO QUE ESTA RUTA DEFIENDE, Y LA BASE NO ─────────────────
 *
 * La tabla `mant_programacion_referencia` sólo tiene claves foráneas a
 * `empleados(id)`: nada impide anclar el ciclo a tres mecánicos, a la misma
 * persona tres veces, ni insertar dos filas el mismo lunes —el comentario de la
 * tabla dice "una sola fila" pero no hay un `unique`—. La migración
 * 20261023105615 ya está aplicada y una aplicada no se edita, así que las
 * reglas viven acá:
 *
 *   1. El lunes es un lunes.
 *   2. Los tres electricistas son tres personas distintas.
 *   3. Cada una es **electricista** en `mant_personal_taller` y está vigente ese
 *      lunes.
 *   4. No hay ya una referencia para ese mismo lunes.
 *
 * Quien escriba a la tabla por otro camino se las salta. Y la cuarta tiene una
 * ventana: dos pedidos simultáneos pueden pasar los dos la comprobación antes
 * de que se inserte alguno. Cerrarla del todo pide un índice único sobre
 * `lunes`, que es una migración y la corre una persona.
 *
 * ── EL ORDEN: EL REGISTRO VA ANTES ──────────────────────────
 *
 * Igual que en `mantenimiento/ausencias`: `auditar()` se llama **antes** de
 * escribir, y si no entra, no se escribe. El `id` de la fila se genera acá
 * justamente para eso: el registro tiene que nombrar la entidad antes de que
 * exista. El precio es que si la inserción falla después, queda un registro de
 * algo que no pasó —la tabla es inmutable y no se puede retirar—. Las
 * validaciones de arriba lo vuelven raro, y el registro lleva el `contexto`
 * entero para que se lea qué se intentó.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una fecha que vino de la base, como `YYYY-MM-DD` pelado. */
function soloElDia(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "La semana de referencia requiere ser admin de Mantenimiento" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const lunes = b?.lunes;
  const grupo = String(b?.grupoEn4a12 ?? "");
  const e412 = String(b?.electricista4a12Id ?? "");
  const e816 = String(b?.electricista8a16Id ?? "");
  const e1220 = String(b?.electricista12a20Id ?? "");

  const problemas: string[] = [];
  if (!esFechaIso(lunes)) problemas.push("El lunes falta o no es válido, tiene que ser AAAA-MM-DD");
  else if (diaDeLaSemana(lunes) !== 1) problemas.push("La referencia se cuenta desde un lunes, y esa fecha no lo es");
  if (!["A", "B"].includes(grupo)) problemas.push("El grupo que está en 4 a 12 tiene que ser A o B");
  if (!UUID.test(e412)) problemas.push("Falta elegir el electricista de 4 a 12");
  if (!UUID.test(e816)) problemas.push("Falta elegir el electricista de 8 a 16");
  if (!UUID.test(e1220)) problemas.push("Falta elegir el electricista de 12 a 20");
  if (problemas.length) return NextResponse.json({ error: problemas.join(". ") }, { status: 400 });

  const elegidos = [e412, e816, e1220];
  if (new Set(elegidos.map((e) => e.toLowerCase())).size !== 3) {
    return NextResponse.json(
      { error: "Cada turno lleva un electricista distinto: se repite una persona" },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  const dia = lunes as string;

  // ── Cada uno es electricista del taller ese lunes ──
  const { data: filas, error: errPadron } = await db
    .from("mant_personal_taller")
    .select("empleado_id, oficio, grupo, desde, hasta, empleados(nombre, apellido)")
    .in("empleado_id", elegidos);
  if (errPadron) return NextResponse.json({ error: errPadron.message }, { status: 500 });

  const nombreDe = new Map<string, string>();
  const padron: PersonaDelTaller[] = [];
  for (const f of filas ?? []) {
    const e = Array.isArray(f.empleados) ? f.empleados[0] : f.empleados;
    nombreDe.set(f.empleado_id, e ? `${e.nombre} ${e.apellido}` : f.empleado_id);
    const desde = soloElDia(f.desde);
    const hasta = f.hasta === null ? null : soloElDia(f.hasta);
    // Una fila cuyas fechas no se entienden no cuenta: ante la duda, no es del taller.
    if (!esFechaIso(desde) || (hasta !== null && !esFechaIso(hasta))) continue;
    padron.push({
      empleadoId: f.empleado_id,
      oficio: f.oficio as Oficio,
      grupo: f.grupo as Grupo | null,
      desde,
      hasta,
    });
  }

  const rotulos: [string, string][] = [
    [e412, "4 a 12"],
    [e816, "8 a 16"],
    [e1220, "12 a 20"],
  ];
  const noSirven = rotulos
    .filter(([id]) => !padron.some((p) => p.empleadoId === id && p.oficio === "electricista" && estaVigente(p, dia)))
    .map(([, turno]) => `el de ${turno}`);
  if (noSirven.length) {
    return NextResponse.json(
      {
        error:
          `${noSirven.join(", ")} no ${noSirven.length === 1 ? "es" : "son"} electricista del taller ese lunes. ` +
          "Los tres tienen que figurar en el padrón del taller como electricistas, vigentes ese día.",
      },
      { status: 400 }
    );
  }

  // ── Una sola referencia por lunes ──
  const { data: previas, error: errPrevias } = await db
    .from("mant_programacion_referencia")
    .select("id, lunes, grupo_en_4a12, electricista_4a12_id, electricista_8a16_id, electricista_12a20_id")
    .order("lunes", { ascending: false });
  if (errPrevias) return NextResponse.json({ error: errPrevias.message }, { status: 500 });

  if ((previas ?? []).some((p) => soloElDia(p.lunes) === dia)) {
    return NextResponse.json(
      { error: "Ya hay una referencia para ese lunes. Si cambió algo, cargá la de otro lunes: no se pisa la anterior." },
      { status: 400 }
    );
  }

  // Lo que regía hasta ahora, para que el registro diga qué se cambió y no sólo
  // que algo cambió. El primer alta no tiene anterior.
  const anterior = previas?.[0];
  let valorAnterior = "(no había referencia)";
  if (anterior) {
    const { data: nombres } = await db
      .from("empleados")
      .select("id, nombre, apellido")
      .in("id", [anterior.electricista_4a12_id, anterior.electricista_8a16_id, anterior.electricista_12a20_id]);
    const n = (id: string) => {
      const e = (nombres ?? []).find((x) => x.id === id);
      return e ? `${e.nombre} ${e.apellido}` : id;
    };
    valorAnterior =
      `semana del ${soloElDia(anterior.lunes)}: grupo ${anterior.grupo_en_4a12} en 4-12; electricistas ` +
      `4-12 ${n(anterior.electricista_4a12_id)}, 8-16 ${n(anterior.electricista_8a16_id)}, ` +
      `12-20 ${n(anterior.electricista_12a20_id)}`;
  }
  const valorNuevo =
    `semana del ${dia}: grupo ${grupo} en 4-12; electricistas ` +
    `4-12 ${nombreDe.get(e412)}, 8-16 ${nombreDe.get(e816)}, 12-20 ${nombreDe.get(e1220)}`;

  // ── El registro, antes de escribir ──
  const id = crypto.randomUUID();
  const { data: quien } = await db
    .from("usuarios")
    .select("nombre, apellido, email")
    .eq("id", user.id)
    .maybeSingle();

  const registro = await auditar(db, {
    modulo: "mantenimiento",
    entidad: "mant_programacion_referencia",
    entidadId: id,
    accion: "corregir",
    usuario: { id: user.id, nombre: nombreParaAuditoria(quien) },
    valorAnterior,
    valorNuevo,
    contexto: {
      ruta: "mantenimiento/programacion/referencia",
      lunes: dia,
      grupo_en_4a12: grupo,
      electricista_4a12_id: e412,
      electricista_8a16_id: e816,
      electricista_12a20_id: e1220,
    },
  });
  if (!registro.ok) {
    return NextResponse.json(
      { error: `No se pudo registrar el cambio en la auditoría, así que no se cargó la referencia: ${registro.error}` },
      { status: 500 }
    );
  }

  const { data, error } = await db
    .from("mant_programacion_referencia")
    .insert({
      id,
      lunes: dia,
      grupo_en_4a12: grupo,
      electricista_4a12_id: e412,
      electricista_8a16_id: e816,
      electricista_12a20_id: e1220,
    })
    .select("id, lunes, grupo_en_4a12, electricista_4a12_id, electricista_8a16_id, electricista_12a20_id")
    .single();

  if (error) {
    return NextResponse.json(
      {
        error:
          `No se pudo guardar la referencia (${error.message}). El cambio quedó anotado en la auditoría ` +
          "aunque no se hizo: volvé a intentarlo.",
      },
      { status: 500 }
    );
  }
  return NextResponse.json({ data }, { status: 201 });
}
