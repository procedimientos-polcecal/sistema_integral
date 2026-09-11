import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminDespacho, tieneAccesoDespacho } from "@/lib/despacho/auth";
import { productosUsadosEnOrdenes } from "@/lib/despacho/consultas";
import {
  ENVASES,
  GRANULOMETRIAS,
  MATERIALES,
  clasificacionDelProducto,
  problemaDeClasificacion,
  traerCatalogoDeProductos,
} from "@/lib/core/productos";
import type { Producto } from "@/lib/core/types";

/**
 * El catálogo de productos, desde Despacho.
 *
 * `GET` lo ve cualquiera con acceso al módulo: lo necesitan los movimientos
 * diarios para mostrar "Filler A granel" en vez del nombre crudo, no sólo la
 * pantalla de administración. `POST` y `PATCH` los reserva `esAdminDespacho`.
 *
 * La tabla es del núcleo y la comparte con Producción, así que RLS la gatea con
 * `puede_editar_productos()` —admin de Producción **o** de Despacho—. Este
 * chequeo es el de esta pantalla y es más angosto a propósito: quien administra
 * Producción tiene su propia pantalla.
 *
 * Un producto **no se borra**: las órdenes viejas lo referencian por
 * `odoo_product_id` y perder su clasificación las dejaría sin material. Con
 * `activo: false` sale del alta y sigue clasificando su historia — es por eso
 * que `clasificacionPorOdoo` no mira `activo`.
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoDespacho(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Despacho" }, { status: 403 });
  }

  const [catalogo, usados] = await Promise.all([
    traerCatalogoDeProductos(supabase),
    productosUsadosEnOrdenes(supabase),
  ]);

  const enElCatalogo = new Set(
    catalogo.map((p) => p.odoo_product_id).filter((x): x is number => x !== null)
  );

  return NextResponse.json({
    catalogo,
    // Los que ya están en el catálogo y nadie clasificó: la lista de trabajo.
    sinClasificar: catalogo.filter((p) => clasificacionDelProducto(p) === null),
    // Y los que aparecieron en una orden sin estar sembrados, de mayor uso a
    // menor. Los de `odoo_product_id` null son órdenes sin remito: no hay
    // producto de Odoo que sumar.
    fueraDelCatalogo: usados.filter(
      (u) => u.odoo_product_id === null || !enElCatalogo.has(u.odoo_product_id)
    ),
    listas: { materiales: MATERIALES, granulometrias: GRANULOMETRIAS, envases: ENVASES },
  });
}

/** Sumar al catálogo un producto de Odoo que la siembra no trajo. */
export async function POST(request: Request) {
  const { supabase, user, error } = await admin();
  if (error) return error;

  const b = await cuerpoJson(request);

  if (typeof b?.odoo_product_id !== "number") {
    return NextResponse.json({ error: "Falta el producto de Odoo" }, { status: 400 });
  }
  const nombre = String(b?.nombre ?? "").trim();
  if (nombre === "") {
    return NextResponse.json({ error: "Falta el nombre del producto" }, { status: 400 });
  }

  const problema = problemaDeClasificacion(b);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  const { data, error: errorSql } = await supabase
    .from("productos")
    .insert({
      odoo_product_id: b.odoo_product_id,
      odoo_default_code: textoOpcional(b.odoo_default_code),
      nombre,
      material: textoOpcional(b.material),
      granulometria: textoOpcional(b.granulometria),
      envase: textoOpcional(b.envase),
      cargado_por: user.id,
    })
    .select(
      "id, odoo_product_id, odoo_default_code, nombre, material, granulometria, envase, kg_por_unidad, activo"
    )
    .single();

  if (errorSql) {
    // 23505 es el unique de `odoo_product_id`: el producto ya está en el
    // catálogo y lo que hay que hacer es clasificarlo, no sumarlo de nuevo.
    if (errorSql.code === "23505") {
      return NextResponse.json(
        { error: "Ese producto ya está en el catálogo." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: errorSql.message }, { status: 400 });
  }
  return NextResponse.json({ data });
}

/** Clasificar, reclasificar, o dar de baja una fila del catálogo. */
export async function PATCH(request: Request) {
  const { supabase, user, error } = await admin();
  if (error) return error;

  const b = await cuerpoJson(request);
  if (typeof b?.id !== "string" || b.id === "") {
    return NextResponse.json({ error: "Falta el id del producto" }, { status: 400 });
  }

  // Hace falta lo que hay para decidir el "los tres o ninguno": un PATCH que
  // manda sólo el envase de un producto sin material dejaría media
  // clasificación, y ése es justo el caso que el `check` de la base rechaza —
  // con un 23514 que la pantalla no sabe explicar.
  const { data: actual } = await supabase
    .from("productos")
    .select("id, odoo_product_id, odoo_default_code, nombre, material, granulometria, envase, kg_por_unidad, activo")
    .eq("id", b.id)
    .maybeSingle();

  if (!actual) {
    return NextResponse.json({ error: "Ese producto no existe" }, { status: 404 });
  }

  const problema = problemaDeClasificacion(b, clasificacionDelProducto(actual as Producto));
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  const cambios: Record<string, unknown> = {
    actualizado_por: user.id,
    actualizado_en: new Date().toISOString(),
  };
  if (b.material !== undefined) cambios.material = textoOpcional(b.material);
  if (b.envase !== undefined) cambios.envase = textoOpcional(b.envase);
  if (b.granulometria !== undefined) cambios.granulometria = textoOpcional(b.granulometria);
  if (b.kg_por_unidad !== undefined) cambios.kg_por_unidad = numeroOpcional(b.kg_por_unidad);
  if (typeof b.activo === "boolean") cambios.activo = b.activo;

  if (Object.keys(cambios).length === 2) {
    return NextResponse.json({ error: "No vino ningún cambio" }, { status: 400 });
  }

  const { data, error: errorSql } = await supabase
    .from("productos")
    .update(cambios)
    .eq("id", b.id)
    .select(
      "id, odoo_product_id, odoo_default_code, nombre, material, granulometria, envase, kg_por_unidad, activo"
    )
    .single();

  if (errorSql) return NextResponse.json({ error: errorSql.message }, { status: 400 });
  return NextResponse.json({ data });
}

/** Sesión + admin de Despacho, que es lo que las dos escrituras piden igual. */
async function admin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      supabase,
      user: null as never,
      error: NextResponse.json({ error: "No autorizado" }, { status: 401 }),
    };
  }
  if (!(await esAdminDespacho(supabase, user.id))) {
    return {
      supabase,
      user,
      error: NextResponse.json(
        { error: "Sólo un admin de Despacho edita el catálogo desde acá" },
        { status: 403 }
      ),
    };
  }
  return { supabase, user, error: null };
}

function textoOpcional(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const s = valor.trim();
  return s === "" ? null : s;
}

/** El kg por unidad puede venir vacío a propósito: el bolsón no está confirmado. */
function numeroOpcional(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "") {
    const n = Number(valor.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
