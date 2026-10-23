import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";
import { hoyEnArgentina } from "@/lib/core/fechas";

/**
 * El padrón del taller: quién es mecánico, electricista o lubricador, de qué
 * grupo y desde cuándo. Lo ve y lo toca sólo el admin de Mantenimiento.
 *
 * Las tres reglas de abajo NO están en la base: la migración
 * 20261023105615 ya está aplicada y una migración aplicada no se edita, así que
 * se validan acá. Quien escriba a esta tabla por otro camino se las salta.
 *
 *   1. `hasta` no puede ser anterior a `desde`.
 *   2. Una persona no puede tener dos vigencias que se superpongan: la semana
 *      se arma con el padrón que regía ese día, y dos filas vigentes a la vez
 *      la pondrían en dos grupos.
 *   3. Mecánico y lubricador viajan en bloque, así que necesitan grupo; el
 *      electricista rota solo y no puede tenerlo.
 */

const OFICIOS = ["mecanico", "electricista", "lubricador"];
const GRUPOS = ["A", "B"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una fecha "YYYY-MM-DD" que existe en el calendario (no el 31 de abril). */
function esFechaIso(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

interface Vigencia {
  desde: string;
  hasta: string | null;
}

/** Si dos vigencias comparten algún día. Los extremos son inclusivos; `null` es sin fin. */
function seSuperponen(a: Vigencia, b: Vigencia): boolean {
  const aTerminaAntes = a.hasta !== null && a.hasta < b.desde;
  const bTerminaAntes = b.hasta !== null && b.hasta < a.desde;
  return !aTerminaAntes && !bTerminaAntes;
}

/** Los problemas de una fila ya armada, en castellano. Vacío si está bien. */
function problemasDeLaFila(fila: {
  oficio: string;
  grupo: string | null;
  desde: string;
  hasta: string | null;
}): string[] {
  const problemas: string[] = [];
  if (fila.hasta !== null && fila.hasta < fila.desde) {
    problemas.push("La fecha hasta no puede ser anterior a la fecha desde");
  }
  if (fila.oficio === "electricista" && fila.grupo !== null) {
    problemas.push("Un electricista rota solo y no lleva grupo");
  }
  if ((fila.oficio === "mecanico" || fila.oficio === "lubricador") && fila.grupo === null) {
    problemas.push(
      `Un ${fila.oficio === "mecanico" ? "mecánico" : "lubricador"} rota en bloque y necesita grupo (A o B)`
    );
  }
  return problemas;
}

/** Quién es el admin que pide, o la respuesta de error si no lo es. */
async function admitir() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "El padrón del taller requiere ser admin de Mantenimiento" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

/** GET — el padrón vigente (los que no terminaron antes de hoy), con el nombre. */
export async function GET() {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const { data, error } = await createAdminClient()
    .from("mant_personal_taller")
    .select("id, empleado_id, oficio, grupo, desde, hasta, empleados(nombre, apellido)")
    .or(`hasta.is.null,hasta.gte.${hoyEnArgentina()}`)
    .order("oficio")
    .order("grupo")
    .order("desde");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** POST — sumar una persona al padrón. */
export async function POST(request: Request) {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const b = await request.json().catch(() => null);
  const empleadoId = String(b?.empleado_id ?? "");
  const oficio = String(b?.oficio ?? "");
  const grupo = b?.grupo == null || b.grupo === "" ? null : String(b.grupo);
  const desde = b?.desde;
  const hasta = b?.hasta == null || b.hasta === "" ? null : b.hasta;

  const problemas: string[] = [];
  if (!UUID.test(empleadoId)) problemas.push("Falta elegir la persona");
  if (!OFICIOS.includes(oficio)) problemas.push("El oficio tiene que ser mecánico, electricista o lubricador");
  if (grupo !== null && !GRUPOS.includes(grupo)) problemas.push("El grupo tiene que ser A o B");
  if (!esFechaIso(desde)) problemas.push("La fecha desde falta o no es válida, tiene que ser AAAA-MM-DD");
  if (hasta !== null && !esFechaIso(hasta)) problemas.push("La fecha hasta no es válida, tiene que ser AAAA-MM-DD");
  if (problemas.length) return NextResponse.json({ error: problemas.join(". ") }, { status: 400 });

  const fila = { oficio, grupo, desde: desde as string, hasta: hasta as string | null };
  const delaFila = problemasDeLaFila(fila);
  if (delaFila.length) return NextResponse.json({ error: delaFila.join(". ") }, { status: 400 });

  const db = createAdminClient();

  const { data: previas, error: errPrevias } = await db
    .from("mant_personal_taller")
    .select("desde, hasta")
    .eq("empleado_id", empleadoId);
  if (errPrevias) return NextResponse.json({ error: errPrevias.message }, { status: 500 });

  if ((previas ?? []).some((p) => seSuperponen(p, fila))) {
    return NextResponse.json(
      { error: "Esa persona ya tiene una vigencia en el padrón que se superpone con esas fechas. Cerrá la anterior con una fecha hasta." },
      { status: 400 }
    );
  }

  const { data, error } = await db
    .from("mant_personal_taller")
    .insert({ empleado_id: empleadoId, ...fila })
    .select("id, empleado_id, oficio, grupo, desde, hasta")
    .single();

  if (error) {
    // 23503: el empleado no existe.
    const noExiste = error.code === "23503";
    // Cualquier otro error es del servidor, no de lo que se mandó: un 400 le
    // diría a quien llama que revise su pedido cuando se cortó la conexión.
    return NextResponse.json(
      { error: noExiste ? "Esa persona no existe en el sistema" : error.message },
      { status: noExiste ? 400 : 500 }
    );
  }
  return NextResponse.json({ data });
}

/** PATCH — ponerle `hasta` a una fila, o cambiarle el grupo. Lleva `id` en el cuerpo. */
export async function PATCH(request: Request) {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const b = await request.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!UUID.test(id)) return NextResponse.json({ error: "Falta qué fila del padrón se modifica" }, { status: 400 });

  const cambios: { hasta?: string | null; grupo?: string | null } = {};
  if ("hasta" in (b ?? {})) {
    const hasta = b.hasta == null || b.hasta === "" ? null : b.hasta;
    if (hasta !== null && !esFechaIso(hasta)) {
      return NextResponse.json({ error: "La fecha hasta no es válida, tiene que ser AAAA-MM-DD" }, { status: 400 });
    }
    cambios.hasta = hasta;
  }
  if ("grupo" in (b ?? {})) {
    const grupo = b.grupo == null || b.grupo === "" ? null : String(b.grupo);
    if (grupo !== null && !GRUPOS.includes(grupo)) {
      return NextResponse.json({ error: "El grupo tiene que ser A o B" }, { status: 400 });
    }
    cambios.grupo = grupo;
  }
  if (!Object.keys(cambios).length) {
    return NextResponse.json({ error: "No hay nada para cambiar: mandá hasta o grupo" }, { status: 400 });
  }

  const db = createAdminClient();

  const { data: actual, error: errActual } = await db
    .from("mant_personal_taller")
    .select("id, empleado_id, oficio, grupo, desde, hasta")
    .eq("id", id)
    .maybeSingle();
  if (errActual) return NextResponse.json({ error: errActual.message }, { status: 500 });
  if (!actual) return NextResponse.json({ error: "Esa fila del padrón no existe" }, { status: 404 });

  // La fila como quedaría: las tres reglas se miran sobre el resultado, no sobre el pedido.
  const resultado = {
    oficio: actual.oficio as string,
    grupo: "grupo" in cambios ? (cambios.grupo as string | null) : (actual.grupo as string | null),
    desde: actual.desde as string,
    hasta: "hasta" in cambios ? (cambios.hasta as string | null) : (actual.hasta as string | null),
  };

  const delaFila = problemasDeLaFila(resultado);
  if (delaFila.length) return NextResponse.json({ error: delaFila.join(". ") }, { status: 400 });

  // Alargar o sacar el `hasta` puede chocar con otra vigencia de la misma persona.
  const { data: otras, error: errOtras } = await db
    .from("mant_personal_taller")
    .select("desde, hasta")
    .eq("empleado_id", actual.empleado_id)
    .neq("id", id);
  if (errOtras) return NextResponse.json({ error: errOtras.message }, { status: 500 });

  if ((otras ?? []).some((o) => seSuperponen(o, resultado))) {
    return NextResponse.json(
      { error: "Con ese cambio la vigencia se superpone con otra de la misma persona" },
      { status: 400 }
    );
  }

  const { data, error } = await db
    .from("mant_personal_taller")
    .update(cambios)
    .eq("id", id)
    .select("id, empleado_id, oficio, grupo, desde, hasta")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
