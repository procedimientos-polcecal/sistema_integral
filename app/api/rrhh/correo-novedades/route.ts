import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, es_admin_check } from "@/lib/rrhh/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

/**
 * La configuración del correo de novedades del cierre del día.
 *
 * Es una ruta aparte de `/api/rrhh/configuracion` **a propósito**, y no por
 * prolijidad: aquélla dispara `recalcularVentanaEnSegundoPlano()` en cada PUT,
 * porque sus campos entran en el cálculo de horas de todos los empleados.
 * Cambiarle una coma al saludo de un correo no puede costar un recálculo del
 * período.
 *
 * El GET lo puede leer cualquiera con acceso a RRHH; el PUT pide admin, igual
 * que la otra configuración.
 *
 * **El GET también devuelve los candidatos**, o sea a quién se le puede mandar.
 * Van en la misma respuesta y no en una segunda ruta porque la pantalla no
 * puede dibujar la lista de tildes sin ellos: dos pedidos para una sola caja
 * son dos estados de carga y una forma más de que se vea vacía cuando no lo
 * está.
 */

const TABLA = "rrhh_correo_novedades";

/** El texto del error cuando la migración todavía no se aplicó. */
const SIN_TABLA =
  "Falta aplicar la migración 20261116084955_rrhh_correo_de_novedades.sql en el editor SQL de Supabase.";

function esTablaQueFalta(error: { code?: string; message?: string } | null): boolean {
  // PostgREST contesta PGRST205 cuando la tabla no está en su caché de esquema
  // y 42P01 cuando Postgres dice que no existe. Se miran los dos: cuál llega
  // depende de si la caché se recargó.
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const [{ data, error }, { data: usuarios }] = await Promise.all([
    supabase.from(TABLA).select("*").eq("id", 1).single(),
    supabase
      .from("usuarios")
      .select("id, nombre, apellido, email, rol, activo")
      .order("apellido", { ascending: true }),
  ]);

  // Los candidatos salen igual aunque la tabla falte: así la pantalla puede
  // decir qué falta y mostrar a quién le llegaría, en vez de quedar en blanco.
  const candidatos = (usuarios ?? [])
    .filter((u) => u.activo !== false && (u.email ?? "").trim())
    .map((u) => ({
      id: u.id,
      nombre: [u.apellido, u.nombre].filter(Boolean).join(", "),
      email: u.email,
      rol: u.rol,
    }));

  if (error) {
    if (esTablaQueFalta(error)) {
      return NextResponse.json({ error: SIN_TABLA, candidatos }, { status: 503 });
    }
    return NextResponse.json({ error: error.message, candidatos }, { status: 500 });
  }

  return NextResponse.json({
    activo: data.activo,
    destinatarios: data.destinatarios ?? [],
    encabezado: data.encabezado ?? "",
    cierre: data.cierre ?? "",
    actualizadoEn: data.actualizado_en,
    candidatos,
  });
}

/** Lo máximo que puede medir el encabezado o el cierre. */
const TOPE_DE_TEXTO = 4000;

export async function PUT(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const cambios: Record<string, unknown> = {};

  if (body.activo !== undefined) {
    if (typeof body.activo !== "boolean") {
      return NextResponse.json({ error: "«activo» tiene que ser verdadero o falso" }, { status: 400 });
    }
    cambios.activo = body.activo;
  }

  if (body.destinatarios !== undefined) {
    if (!Array.isArray(body.destinatarios) || body.destinatarios.some((d: unknown) => typeof d !== "string")) {
      return NextResponse.json({ error: "«destinatarios» tiene que ser una lista de usuarios" }, { status: 400 });
    }
    // Se guardan sin repetir: la pantalla no deja tildar dos veces, pero esto
    // también lo escribe quien llame a la ruta.
    cambios.destinatarios = [...new Set(body.destinatarios as string[])];
  }

  for (const campo of ["encabezado", "cierre"] as const) {
    if (body[campo] === undefined) continue;
    if (typeof body[campo] !== "string") {
      return NextResponse.json({ error: `«${campo}» tiene que ser texto` }, { status: 400 });
    }
    if ((body[campo] as string).length > TOPE_DE_TEXTO) {
      return NextResponse.json(
        { error: `«${campo}» no puede pasar de ${TOPE_DE_TEXTO} caracteres` },
        { status: 400 }
      );
    }
    cambios[campo] = body[campo];
  }

  if (!Object.keys(cambios).length) {
    return NextResponse.json({ error: "No viene ningún cambio" }, { status: 400 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  cambios.actualizado_en = new Date().toISOString();
  cambios.actualizado_por = user?.id ?? null;

  const { data, error } = await supabase.from(TABLA).update(cambios).eq("id", 1).select().single();
  if (error) {
    if (esTablaQueFalta(error)) return NextResponse.json({ error: SIN_TABLA }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    activo: data.activo,
    destinatarios: data.destinatarios ?? [],
    encabezado: data.encabezado ?? "",
    cierre: data.cierre ?? "",
    actualizadoEn: data.actualizado_en,
  });
}
