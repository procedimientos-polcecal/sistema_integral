import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import {
  traerMuestrasConRetenidos,
  traerMuestrasDeProductos,
  traerProductos,
} from "@/lib/calidad/ensayos/consultas";
import { losQueComparten } from "@/lib/calidad/ensayos/juegoDeTamices";
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
 * **Las muestras se traen en dos consultas, con `traerMuestrasConRetenidos`.** Comparar no
 * tiene tope desde el 25/11/2026 y lo único que queda es el lote de un
 * `.in()`, así que de a una serían hasta 400 consultas para dibujar una
 * pantalla.
 *
 * **Y el selector no se limita al producto elegido desde el 26/11/2026**: una
 * casilla suma las muestras de los otros productos que declaran el mismo juego
 * de tamices, que es lo que se pidió para poder comparar Arena Chocolata con
 * Arena caliza LN. Quién entra en ese grupo lo decide `losQueComparten`, y el
 * porqué de que sea el juego *declarado* y no el medido está ahí.
 *
 * Los tamices apagados no se guardan acá: son del cliente, igual que si la
 * casilla está prendida — lo que viaja en la URL es qué muestras se comparan y
 * nunca cómo se llegó a elegirlas.
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
    traerMuestrasConRetenidos(supabase, pedidas),
  ]);

  const nombreDelProducto = new Map(productos.map((p) => [p.id, p.nombre]));

  // Una muestra que ya no está —el enlace quedó viejo— ya viene salteada de
  // `traerMuestrasConRetenidos`: las otras del enlace siguen siendo válidas.
  const muestras: MuestraParaComparar[] = traidas
    .map(({ muestra, retenidos }) => ({
      id: muestra.id,
      producto: nombreDelProducto.get(muestra.producto_id) ?? "Producto sin nombre",
      fecha: muestra.fecha,
      observaciones: muestra.observaciones,
      pesoMuestraG: muestra.granulometria_peso_muestra_g,
      retenidos: retenidos.map((r) => ({ malla: r.malla, retenido_g: r.retenido_g })),
    }));

  const productoDeLaPrimera = traidas[0]?.muestra.producto_id ?? "";
  const productoId = productos.some((p) => p.id === productoPedido)
    ? productoPedido
    : productoDeLaPrimera;

  // Los otros productos que declaran el mismo juego de tamices, para que el
  // selector pueda ofrecer sus muestras con una casilla. Se traen siempre:
  // ver `traerMuestrasDeProductos`.
  const comparten = productoId ? losQueComparten(productos, productoId) : [];
  const delSelector = productoId
    ? await traerMuestrasDeProductos(supabase, [productoId, ...comparten.map((p) => p.id)])
    : [];

  return (
    <CurvaClient
      productos={productos.map((p) => ({ id: p.id, nombre: p.nombre }))}
      productoId={productoId}
      comparten={comparten.map((p) => ({ id: p.id, nombre: p.nombre }))}
      juego={productos.find((p) => p.id === productoId)?.mallas ?? []}
      delSelector={delSelector}
      muestras={muestras}
    />
  );
}
