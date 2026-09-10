import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerYacimientos } from "@/lib/cantera/consultas";
import { esMaterialValido, MATERIALES } from "@/lib/cantera/vocabulario";

/**
 * Las canteras / frentes, con su malla de diseño y su tipo de piedra.
 *
 * `GET` lo ve cualquiera con acceso al módulo: lo necesita el tablero para el
 * selector de yacimiento y el editor de voladuras para prellenar la malla.
 * `POST` y `PATCH` los reserva el admin del módulo.
 *
 * Un yacimiento **no se borra**: las voladuras lo referencian y perder su
 * densidad las dejaría sin toneladas. Con `activo: false` sale del selector y
 * sigue explicando su historia.
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }
  return NextResponse.json({ data: await traerYacimientos(supabase) });
}

export async function POST(request: Request) {
  return guardar(request, "alta");
}

export async function PATCH(request: Request) {
  return guardar(request, "edicion");
}

function numeroOpcional(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

async function guardar(request: Request, modo: "alta" | "edicion") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminCantera(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sólo un admin de Cantera edita las canteras" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);

  if (b?.material !== undefined && !esMaterialValido(b.material)) {
    return NextResponse.json(
      { error: `Material inválido. Son: ${MATERIALES.join(", ")}` },
      { status: 400 }
    );
  }

  if (modo === "alta") {
    const codigo = String(b?.codigo ?? "").trim().toUpperCase();
    const nombre = String(b?.nombre ?? "").trim();
    const densidad = numeroOpcional(b?.densidad_t_m3);
    if (!codigo) return NextResponse.json({ error: "Falta el código corto (D6, C3, A…)" }, { status: 400 });
    if (!nombre) return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
    if (!esMaterialValido(b?.material)) {
      return NextResponse.json({ error: "Falta el material (Dolomita, Chocolata…)" }, { status: 400 });
    }
    if (densidad === null) return NextResponse.json({ error: "Falta la densidad (t/m³)" }, { status: 400 });

    const { data, error } = await supabase
      .from("cantera_yacimientos")
      .insert({
        codigo,
        nombre,
        material: b.material,
        densidad_t_m3: densidad,
        burden_m: numeroOpcional(b?.burden_m),
        espaciamiento_m: numeroOpcional(b?.espaciamiento_m),
        orden: numeroOpcional(b?.orden) ?? 0,
      })
      .select("id, codigo, nombre, material, densidad_t_m3, burden_m, espaciamiento_m, activo, orden")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: `Ya hay una cantera con el código ${codigo}.` }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ data });
  }

  if (typeof b?.id !== "string" || b.id === "") {
    return NextResponse.json({ error: "Falta el id de la cantera a editar" }, { status: 400 });
  }

  const cambios: Record<string, unknown> = {};
  if (b.nombre !== undefined) cambios.nombre = String(b.nombre).trim();
  if (b.material !== undefined) cambios.material = b.material;
  if (b.densidad_t_m3 !== undefined) cambios.densidad_t_m3 = numeroOpcional(b.densidad_t_m3);
  if (b.burden_m !== undefined) cambios.burden_m = numeroOpcional(b.burden_m);
  if (b.espaciamiento_m !== undefined) cambios.espaciamiento_m = numeroOpcional(b.espaciamiento_m);
  if (b.orden !== undefined) cambios.orden = numeroOpcional(b.orden) ?? 0;
  if (typeof b.activo === "boolean") cambios.activo = b.activo;

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No vino ningún cambio" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("cantera_yacimientos")
    .update(cambios)
    .eq("id", b.id)
    .select("id, codigo, nombre, material, densidad_t_m3, burden_m, espaciamiento_m, activo, orden")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
