import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelDespachoDe } from "@/lib/despacho/auth";
import { productosUsadosEnOrdenes } from "@/lib/despacho/consultas";
import { clasificacionDelProducto, traerCatalogoDeProductos } from "@/lib/core/productos";
import type { Producto } from "@/lib/core/types";
import ProductosClient from "./ProductosClient";

/**
 * Clasificar el catálogo: qué material, granulometría y envase es cada producto.
 *
 * El catálogo es del núcleo y viene **sembrado** con los 49 productos que
 * salieron en 180 días (la migración 20260910104534), así que el trabajo de esta
 * pantalla no es dar de alta un mapeo: es ponerle la terna a filas que ya
 * existen. Se ordenan por cuántas órdenes de carga las usaron, porque
 * clasificar las primeras cinco cubre casi todo el volumen.
 *
 * La terna puede quedar vacía y eso es un estado válido: `MINERALES
 * ECOLOGICOS` —el más despachado de todos— no es material × granulometría ×
 * envase, igual que `BINDER` y `TOSCA`. Esos se van a ver con su nombre de Odoo
 * para siempre, y está bien.
 *
 * El puente con los renglones del papel de Producción **no está acá**: lo edita
 * `/produccion/productos`, que es la pantalla de quien sabe qué renglón del
 * parte agrupa a qué productos.
 */

/** Una fila del catálogo con cuántas órdenes de carga la usaron. */
export interface FilaDeCatalogo {
  producto: Producto;
  ordenes: number;
}

/** Un producto que apareció en una orden y no está en el catálogo. */
export interface FueraDelCatalogo {
  odoo_product_id: number | null;
  producto_raw: string | null;
  ordenes: number;
}

export default async function CatalogoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelDespachoDe(supabase, user.id);
  if (!nivel) redirect("/");
  // El nav ya lo marca `soloAdmin`, pero un enlace pegado a mano llega igual: sin
  // esto la pantalla se abre y RLS devuelve el error al guardar, que es peor.
  if (nivel !== "admin") redirect("/despacho");

  const [catalogo, usados] = await Promise.all([
    traerCatalogoDeProductos(supabase),
    productosUsadosEnOrdenes(supabase),
  ]);

  const ordenesPorOdoo = new Map<number, number>();
  for (const u of usados) {
    if (u.odoo_product_id !== null) ordenesPorOdoo.set(u.odoo_product_id, u.ordenes);
  }

  const filas: FilaDeCatalogo[] = catalogo.map((producto) => ({
    producto,
    ordenes: producto.odoo_product_id !== null
      ? (ordenesPorOdoo.get(producto.odoo_product_id) ?? 0)
      : 0,
  }));

  // Primero lo que más se usó: es la lista de trabajo. Los sembrados que todavía
  // no aparecieron en ninguna orden quedan al final, ordenados por nombre.
  const porVolumen = (a: FilaDeCatalogo, b: FilaDeCatalogo) =>
    b.ordenes - a.ordenes || a.producto.nombre.localeCompare(b.producto.nombre);

  const enElCatalogo = new Set(
    catalogo.map((p) => p.odoo_product_id).filter((x): x is number => x !== null)
  );

  return (
    <ProductosClient
      sinClasificar={filas.filter((f) => clasificacionDelProducto(f.producto) === null).sort(porVolumen)}
      clasificados={filas.filter((f) => clasificacionDelProducto(f.producto) !== null).sort(porVolumen)}
      // Un producto nuevo de Odoo que ya llegó en un remito y no está sembrado.
      // Las órdenes sin remito no tienen producto de Odoo: se muestran para que
      // se vea por qué no se pueden clasificar, pero no se pueden sumar.
      fueraDelCatalogo={usados.filter(
        (u) => u.odoo_product_id === null || !enElCatalogo.has(u.odoo_product_id)
      )}
    />
  );
}
