import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerInsumos } from "@/lib/cantera/consultas";
import { esTipoDeConsumoValido, TIPOS_DE_CONSUMO } from "@/lib/cantera/vocabulario";

/**
 * El catálogo de insumos de voladura (emulex, anfo, boosters, detonadores,
 * servicio). Colapsa las tres formas en que hoy está escrito cada uno en la
 * planilla.
 *
 * `GET` con acceso al módulo —lo necesitan los renglones de consumo—; `POST` y
 * `PATCH`, sólo el admin. No se borra: `activo: false`.
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }
  return NextResponse.json({ data: await traerInsumos(supabase) });
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
      { error: "Sólo un admin de Cantera edita el catálogo de insumos" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);

  if (b?.tipo !== undefined && !esTipoDeConsumoValido(b.tipo)) {
    return NextResponse.json(
      { error: `Tipo inválido. Son: ${TIPOS_DE_CONSUMO.join(", ")}` },
      { status: 400 }
    );
  }

  if (modo === "alta") {
    const nombre = String(b?.nombre ?? "").trim();
    if (!nombre) return NextResponse.json({ error: "Falta el nombre del insumo" }, { status: 400 });
    if (!esTipoDeConsumoValido(b?.tipo)) {
      return NextResponse.json({ error: "Falta el tipo (detonador / otros_insumos / voladura)" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("cantera_insumos")
      .insert({
        nombre,
        tipo: b.tipo,
        precio_usd: numeroOpcional(b?.precio_usd),
        orden: numeroOpcional(b?.orden) ?? 0,
      })
      .select("id, nombre, tipo, precio_usd, activo, orden")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data });
  }

  if (typeof b?.id !== "string" || b.id === "") {
    return NextResponse.json({ error: "Falta el id del insumo a editar" }, { status: 400 });
  }

  const cambios: Record<string, unknown> = {};
  if (b.nombre !== undefined) cambios.nombre = String(b.nombre).trim();
  if (b.tipo !== undefined) cambios.tipo = b.tipo;
  if (b.precio_usd !== undefined) cambios.precio_usd = numeroOpcional(b.precio_usd);
  if (b.orden !== undefined) cambios.orden = numeroOpcional(b.orden) ?? 0;
  if (typeof b.activo === "boolean") cambios.activo = b.activo;

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No vino ningún cambio" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("cantera_insumos")
    .update(cambios)
    .eq("id", b.id)
    .select("id, nombre, tipo, precio_usd, activo, orden")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
