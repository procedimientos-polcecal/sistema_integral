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

  const nombreDelProducto = new Map(productos.map((p) => [p.id, p.nombre]));

  const filas: FilaDeEnsayo[] = muestras.map((m) => {
    const suyos = retenidos.filter((r) => r.muestra_id === m.id);
    const ev = evaluarMuestra(m, suyos, limites);
    const ultima = ev.granulometria.filas.at(-1);

    return {
      id: m.id,
      fecha: m.fecha,
      producto_id: m.producto_id,
      producto: nombreDelProducto.get(m.producto_id) ?? "—",
      observaciones: m.observaciones,
      humedad: ev.humedad,
      pesoVolumetrico: ev.pesoVolumetrico,
      calUtilVial: ev.calUtilVial,
      ultimaMalla: ultima?.malla ?? null,
      acumuladoFinal: ultima?.acumulado ?? { valor: null },
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
