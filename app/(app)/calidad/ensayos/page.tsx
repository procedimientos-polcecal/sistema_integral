import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import {
  traerLimites,
  traerMuestras,
  traerProductos,
  traerRetenidos,
} from "@/lib/calidad/ensayos/consultas";
import { evaluarMuestra } from "@/lib/calidad/ensayos/limites";
import { acumuladosDelListado } from "@/lib/calidad/ensayos/granulometria";
import EnsayosClient, { type FilaDeEnsayo } from "./EnsayosClient";

/** Cuántos días para atrás trae la pantalla por defecto. */
const DIAS = 90;

/**
 * El listado de muestras.
 *
 * **La evaluación se hace acá, en el servidor, una sola vez.** La pantalla sólo
 * dibuja: así la misma función pura que corre al tipear en la carga es la que
 * decide el rojo del listado, y no hay dos criterios de "fuera de límite".
 */
export default async function EnsayosPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  const desde = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [productos, limites, muestras, retenidos] = await Promise.all([
    traerProductos(supabase),
    traerLimites(supabase),
    traerMuestras(supabase, desde),
    traerRetenidos(supabase, desde),
  ]);

  const porId = new Map(productos.map((p) => [p.id, p]));

  const filas: FilaDeEnsayo[] = muestras.map((m) => {
    const suyos = retenidos.filter((r) => r.muestra_id === m.id);
    const ev = evaluarMuestra(m, suyos, limites);
    const producto = porId.get(m.producto_id);

    return {
      id: m.id,
      fecha: m.fecha,
      producto_id: m.producto_id,
      producto: producto?.nombre ?? "—",
      observaciones: m.observaciones,
      humedad: ev.humedad,
      pesoVolumetrico: ev.pesoVolumetrico,
      calUtilVial: ev.calUtilVial,
      // Las cuatro columnas del listado, alineadas con MALLAS_DEL_LISTADO. Cuál
      // de ellas va lo decide el producto, no la muestra: ver el comentario de
      // `acumuladosDelListado`.
      acumulados: acumuladosDelListado(producto?.mallas ?? [], ev.granulometria.filas),
      problemaDeGranulometria: ev.granulometria.problema,
      hayFueraDeLimite: ev.hayFueraDeLimite,
    };
  });

  return (
    <EnsayosClient
      filas={filas}
      productos={productos.map((p) => ({ id: p.id, nombre: p.nombre }))}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      hayLimites={limites.length > 0}
      dias={DIAS}
    />
  );
}
