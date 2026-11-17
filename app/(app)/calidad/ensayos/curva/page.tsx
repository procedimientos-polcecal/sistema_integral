import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import {
  traerMuestra,
  traerMuestrasDeProducto,
  traerProductos,
} from "@/lib/calidad/ensayos/consultas";
import CurvaClient, { type EnsayoDeLaCurva } from "./CurvaClient";

/** Un parámetro de la URL puede venir repetido: se toma el primero. */
function unico(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * La curva granulométrica de una muestra.
 *
 * El producto y la muestra viajan en la URL para poder compartir el enlace. La
 * muestra se pide **por id**, esté o no en la lista del producto, y manda sobre
 * `?producto=`: si el enlace trae una muestra de otro producto, la pantalla
 * muestra el de la muestra y no una combinación que no existe.
 *
 * Los tamices apagados no se guardan acá: son del cliente.
 */
export default async function CurvaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const crudos = await searchParams;
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  const productoPedido = unico(crudos.producto);
  const muestraPedida = unico(crudos.muestra);

  const [productos, datos] = await Promise.all([
    traerProductos(supabase),
    muestraPedida ? traerMuestra(supabase, muestraPedida) : Promise.resolve(null),
  ]);

  const productoId =
    datos?.muestra.producto_id ?? (productos.some((p) => p.id === productoPedido) ? productoPedido : "");

  const muestras = productoId ? await traerMuestrasDeProducto(supabase, productoId) : [];

  const ensayo: EnsayoDeLaCurva | null = datos
    ? {
        id: datos.muestra.id,
        pesoMuestraG: datos.muestra.granulometria_peso_muestra_g,
        retenidos: datos.retenidos.map((r) => ({ malla: r.malla, retenido_g: r.retenido_g })),
      }
    : null;

  return (
    <CurvaClient
      productos={productos.map((p) => ({ id: p.id, nombre: p.nombre }))}
      productoId={productoId}
      muestras={muestras}
      ensayo={ensayo}
    />
  );
}
