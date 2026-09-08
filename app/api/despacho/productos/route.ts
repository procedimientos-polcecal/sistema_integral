import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminDespacho, tieneAccesoDespacho } from "@/lib/despacho/auth";
import {
  traerMapeoDeProductos,
  productosUsadosEnOrdenes,
} from "@/lib/despacho/consultas";
import { ENVASES, GRANULOMETRIAS, MATERIALES } from "@/lib/despacho/clasificacion";

/**
 * El mapeo de productos: qué material, granulometría y envase es cada producto
 * de Odoo.
 *
 * `GET` lo ve cualquiera con acceso al módulo: lo necesita la cola del día para
 * mostrar "Filler A granel" en vez del nombre crudo, no sólo la pantalla de
 * administración. `POST` y `PATCH` los reserva `esAdminDespacho`.
 *
 * Un producto **no se borra**: las órdenes viejas lo referencian por
 * `odoo_product_id` y perder su clasificación las dejaría sin material. Con
 * `activo: false` sale del desplegable y sigue clasificando su historia — es por
 * eso que `clasificacionDe` no mira `activo`.
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoDespacho(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Despacho" }, { status: 403 });
  }

  const [mapeo, usados] = await Promise.all([
    traerMapeoDeProductos(supabase),
    productosUsadosEnOrdenes(supabase),
  ]);

  const mapeados = new Set(mapeo.map((m) => m.odoo_product_id));

  return NextResponse.json({
    mapeo,
    // Los que aparecieron en órdenes y nadie clasificó, de mayor uso a menor.
    // Es la lista de trabajo de esta pantalla.
    sinClasificar: usados.filter(
      (u) => u.odoo_product_id === null || !mapeados.has(u.odoo_product_id)
    ),
    listas: { materiales: MATERIALES, granulometrias: GRANULOMETRIAS, envases: ENVASES },
  });
}

export async function POST(request: Request) {
  return guardar(request, "alta");
}

export async function PATCH(request: Request) {
  return guardar(request, "edicion");
}

async function guardar(request: Request, modo: "alta" | "edicion") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminDespacho(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sólo un admin de Despacho edita el mapeo de productos" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);

  /*
   * Se valida contra las listas de `clasificacion.ts` y no contra un enum de la
   * base.
   *
   * En la base son columnas de texto a propósito: un valor de enum nuevo obliga
   * a una migración sola por valor (55P04) y estas listas van a crecer mientras
   * se mapeen los 432 productos. La contra es que la base no rechaza un valor
   * inventado, así que la validación tiene que estar acá — si no, un typo entra
   * y aparece como un material nuevo en los filtros.
   */
  if (b?.material !== undefined && !MATERIALES.includes(b.material)) {
    return NextResponse.json(
      { error: `Material inválido. Son: ${MATERIALES.join(", ")}` },
      { status: 400 }
    );
  }
  if (b?.envase !== undefined && !ENVASES.includes(b.envase)) {
    return NextResponse.json(
      { error: `Envase inválido. Son: ${ENVASES.join(", ")}` },
      { status: 400 }
    );
  }
  // La granulometría puede faltar de verdad: Chocolata y Pedregullo no tienen.
  if (
    b?.granulometria !== undefined &&
    b.granulometria !== null &&
    b.granulometria !== "" &&
    !GRANULOMETRIAS.includes(b.granulometria)
  ) {
    return NextResponse.json(
      { error: `Granulometría inválida. Son: ${GRANULOMETRIAS.join(", ")}` },
      { status: 400 }
    );
  }

  if (modo === "alta") {
    if (typeof b?.odoo_product_id !== "number") {
      return NextResponse.json({ error: "Falta el producto de Odoo" }, { status: 400 });
    }
    if (!b?.material || !b?.envase) {
      return NextResponse.json(
        { error: "El mapeo necesita material y envase" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("despacho_productos")
      .insert({
        odoo_product_id: b.odoo_product_id,
        odoo_default_code: textoOpcional(b.odoo_default_code),
        // Odoo trae los nombres con espacios al final: "CAL EN TOLVA ".
        odoo_nombre: String(b.odoo_nombre ?? "").trim(),
        material: b.material,
        granulometria: textoOpcional(b.granulometria),
        envase: b.envase,
        produccion_producto_id: textoOpcional(b.produccion_producto_id),
        cargado_por: user.id,
      })
      .select(
        "id, odoo_product_id, odoo_default_code, odoo_nombre, material, granulometria, envase, produccion_producto_id, activo"
      )
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Ese producto ya está mapeado." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ data });
  }

  if (typeof b?.id !== "string" || b.id === "") {
    return NextResponse.json({ error: "Falta el id del mapeo a editar" }, { status: 400 });
  }

  const cambios: Record<string, unknown> = {
    actualizado_por: user.id,
    actualizado_en: new Date().toISOString(),
  };
  if (b.material !== undefined) cambios.material = b.material;
  if (b.envase !== undefined) cambios.envase = b.envase;
  if (b.granulometria !== undefined) cambios.granulometria = textoOpcional(b.granulometria);
  if (b.produccion_producto_id !== undefined) {
    cambios.produccion_producto_id = textoOpcional(b.produccion_producto_id);
  }
  if (typeof b.activo === "boolean") cambios.activo = b.activo;

  if (Object.keys(cambios).length === 2) {
    return NextResponse.json({ error: "No vino ningún cambio" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("despacho_productos")
    .update(cambios)
    .eq("id", b.id)
    .select(
      "id, odoo_product_id, odoo_default_code, odoo_nombre, material, granulometria, envase, produccion_producto_id, activo"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

function textoOpcional(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const s = valor.trim();
  return s === "" ? null : s;
}
