import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminCalidad } from "@/lib/calidad/auth";
import { normalizarMallas } from "@/lib/calidad/ensayos/mallas";
import type { GrupoDeProducto } from "@/lib/calidad/ensayos/types";

/**
 * La lista de lo que se muestrea, y el juego habitual de tamices de cada uno.
 *
 * Es configuración: sólo `admin`, igual que la RLS de la tabla.
 *
 * **Nada de texto libre en la muestra.** Si falta un producto se agrega acá y
 * después se carga la muestra. En el Excel, donde el nombre se tipeaba, diez
 * materiales terminaron escritos con más nombres que materiales —"Caliza
 * galpón" y "Caliza Galpones", "Arena caliza P3 limpia" y "Arena limpia"—, y
 * eso en un listado son dos renglones que nadie suma juntos.
 *
 * Spec: docs/superpowers/specs/2026-10-06-calidad-ensayos-design.md
 */

interface CuerpoDelAlta {
  nombre?: string;
  grupo?: GrupoDeProducto;
  mallas?: unknown;
}

interface CuerpoDeLaEdicion extends CuerpoDelAlta {
  id?: string;
  activo?: boolean;
  orden?: number;
}

function esGrupo(g: unknown): g is GrupoDeProducto {
  return g === "produccion" || g === "proceso";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar los productos" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<CuerpoDelAlta>(request);

  const nombre = (cuerpo.nombre ?? "").trim();
  if (!nombre) return NextResponse.json({ error: "Falta el nombre del producto." }, { status: 400 });
  if (!esGrupo(cuerpo.grupo)) {
    return NextResponse.json(
      { error: "Falta decir si es de producción o de proceso." },
      { status: 400 }
    );
  }

  const { mallas, problema } = normalizarMallas(cuerpo.mallas ?? []);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  // El orden sale del final de la lista: el alta es lo último que se agregó, y
  // reordenar es otra acción.
  const { data: ultimo } = await supabase
    .from("calidad_ensayos_productos")
    .select("orden")
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("calidad_ensayos_productos")
    .insert({ nombre, grupo: cuerpo.grupo, mallas, orden: (ultimo?.orden ?? 0) + 1 })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar los productos" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<CuerpoDeLaEdicion>(request);
  if (!cuerpo.id) return NextResponse.json({ error: "Falta el producto." }, { status: 400 });

  // Lo que no viene, no se toca: un PATCH que manda sólo las mallas no puede
  // borrar el nombre.
  const cambios: Record<string, unknown> = {};

  if (cuerpo.nombre !== undefined) {
    const nombre = cuerpo.nombre.trim();
    if (!nombre) {
      return NextResponse.json({ error: "El nombre no puede quedar vacío." }, { status: 400 });
    }
    cambios.nombre = nombre;
  }

  if (cuerpo.grupo !== undefined) {
    if (!esGrupo(cuerpo.grupo)) {
      return NextResponse.json({ error: "El grupo no es uno de los dos." }, { status: 400 });
    }
    cambios.grupo = cuerpo.grupo;
  }

  if (cuerpo.mallas !== undefined) {
    const { mallas, problema } = normalizarMallas(cuerpo.mallas);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });
    cambios.mallas = mallas;
  }

  if (cuerpo.activo !== undefined) cambios.activo = cuerpo.activo;
  if (cuerpo.orden !== undefined) cambios.orden = cuerpo.orden;

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No vino ningún cambio." }, { status: 400 });
  }

  const { error } = await supabase
    .from("calidad_ensayos_productos")
    .update(cambios)
    .eq("id", cuerpo.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
