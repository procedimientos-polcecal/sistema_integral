import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import {
  traerMuestra,
  traerMuestrasDeProducto,
  traerProductos,
} from "@/lib/calidad/ensayos/consultas";
import type { MuestraParaComparar } from "@/lib/calidad/ensayos/comparacion";
import { leerMuestrasPedidas } from "@/lib/calidad/ensayos/muestrasPedidas";
import CurvaClient from "./CurvaClient";

/** Un parámetro de la URL puede venir repetido: se toma el primero. */
function unico(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * La curva granulométrica de una muestra, o de varias superpuestas.
 *
 * Las muestras viajan en la URL para poder compartir el enlace, y se piden
 * **por id**: una muestra se dibuja esté o no en la lista del producto que
 * muestra el selector. `?producto=` es sólo el filtro de ese selector, y si no
 * viene se abre en el de la primera muestra elegida, para que un enlace
 * compartido no caiga en una lista vacía.
 *
 * **Las muestras se traen de a una, con `Promise.all`.** Son seis como mucho
 * por el tope, así que no hace falta un `.in()` —que además arma una URL que
 * PostgREST rechaza con un 400 cuando los ids son muchos— y se reusa
 * `traerMuestra`, que ya trae los retenidos.
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
  const pedidas = leerMuestrasPedidas(crudos);

  const [productos, traidas] = await Promise.all([
    traerProductos(supabase),
    Promise.all(pedidas.map((id) => traerMuestra(supabase, id))),
  ]);

  const nombreDelProducto = new Map(productos.map((p) => [p.id, p.nombre]));

  // Una muestra que ya no está —el enlace quedó viejo— se saltea en vez de
  // tirar abajo la pantalla: las otras del enlace siguen siendo válidas.
  const muestras: MuestraParaComparar[] = traidas
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map(({ muestra, retenidos }) => ({
      id: muestra.id,
      producto: nombreDelProducto.get(muestra.producto_id) ?? "Producto sin nombre",
      fecha: muestra.fecha,
      observaciones: muestra.observaciones,
      pesoMuestraG: muestra.granulometria_peso_muestra_g,
      retenidos: retenidos.map((r) => ({ malla: r.malla, retenido_g: r.retenido_g })),
    }));

  const productoDeLaPrimera = traidas.find((d) => d !== null)?.muestra.producto_id ?? "";
  const productoId = productos.some((p) => p.id === productoPedido)
    ? productoPedido
    : productoDeLaPrimera;

  const delSelector = productoId ? await traerMuestrasDeProducto(supabase, productoId) : [];

  return (
    <CurvaClient
      productos={productos.map((p) => ({ id: p.id, nombre: p.nombre }))}
      productoId={productoId}
      productoNombre={nombreDelProducto.get(productoId) ?? ""}
      delSelector={delSelector}
      muestras={muestras}
    />
  );
}
