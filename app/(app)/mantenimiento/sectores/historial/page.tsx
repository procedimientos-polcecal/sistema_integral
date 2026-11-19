import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { traerTodo } from "@/lib/core/paginado";
import { conPermanencia, type CambioDeSector } from "@/lib/mantenimiento/historialDeSectores";
import { sectoresDePlanta } from "@/lib/mantenimiento/sectores";
import HistorialDeSectoresClient from "./HistorialDeSectoresClient";

/**
 * Todas las paradas y arranques de todos los sectores, desde siempre.
 *
 * El tablero ya mostraba los últimos 20 cambios en un desplegable debajo de
 * las tarjetas, y eso alcanza para «qué pasó esta semana». No alcanza para lo
 * otro: cuántas veces paró Hidratación este año, cuánto duró cada parada, qué
 * dijo el que la paró. Esto es el archivo; aquello, el vistazo.
 *
 * **Se trae todo y se filtra en el navegador**, como el historial de
 * ejecuciones. La tabla crece con las paradas de planta, no con la operación:
 * medido el 19/11/2026 lleva **3 filas** desde el 12/11, y aun a veinte por
 * mes son doscientas al año. `traerTodo()` igual, porque el corte de 1000 de
 * PostgREST no avisa y «esta tabla es chica» es justamente el razonamiento que
 * este repo decidió no hacer.
 */
export default async function HistorialDeSectoresPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // El embebido va **sin `!inner`**, al revés que el del tablero. Un cambio
  // cuyo sector se borró tiene `sector_id` en null desde la 20261119104730, y
  // con `!inner` desaparecería justo de la pantalla que existe para que no
  // desaparezca. Acá se muestra igual, diciendo que el sector ya no está.
  const filas = await traerTodo<Record<string, any>>((desde, hasta) =>
    supabase
      .from("sectores_status_log")
      .select("id, sector_id, sector_nombre, old_status, new_status, reason, changed_at, " +
              "sector:sector_id(nombre, empresas(nombre)), " +
              "autor:changed_by(nombre, apellido)")
      .order("changed_at", { ascending: false })
      .range(desde, hasta)
  );

  const sectores = await sectoresDePlanta(supabase, "id, nombre");

  const cambios: CambioDeSector[] = filas.map((f) => ({
    id: f.id,
    sector_id: f.sector_id ?? null,
    // El nombre de **hoy** primero y el guardado como respaldo, en ese orden:
    // si el sector sigue vivo y lo renombraron, la pantalla tiene que decir
    // cómo se llama ahora, que es como lo va a buscar quien mira. El guardado
    // —`sector_nombre`, que llena un trigger desde la 20261119104730— es lo
    // único que queda cuando el sector se borró y `sector_id` quedó en null.
    //
    // Quién de los dos contestó se sabe por `sector_id`, no por el texto: un
    // sector borrado y uno vivo pueden llamarse igual.
    sector: f.sector?.nombre ?? f.sector_nombre ?? null,
    old_status: f.old_status ?? null,
    new_status: f.new_status,
    reason: f.reason ?? null,
    changed_at: f.changed_at,
    autor: f.autor
      ? `${f.autor.nombre ?? ""} ${f.autor.apellido ?? ""}`.trim() || null
      : null,
  }));

  // «Ahora» se resuelve una sola vez y acá, no en el navegador: de él sale la
  // duración de todo estado todavía abierto, y que cada fila lo calcule contra
  // su propio reloj daría números que no cierran entre sí.
  const conDuracion = conPermanencia(cambios, new Date().toISOString());

  return (
    <HistorialDeSectoresClient
      cambios={conDuracion}
      sectores={sectores as { id: string; nombre: string }[]}
    />
  );
}
