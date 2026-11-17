import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { buscar } from "@/lib/calidad/historico/consultas";
import HistoricoClient from "./HistoricoClient";

/**
 * El rango de arranque: **todo**, no el mes en curso.
 *
 * Este módulo existe para mirar tres años atrás. Arrancar en octubre hacía que
 * un reclamo por un despacho de 2024 devolviera «no hay determinaciones» sin
 * ninguna señal de que el problema eran las fechas.
 */
const DESDE_SIEMPRE = "2023-01-01";

function arranque(): { desde: string; hasta: string } {
  const hoy = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { desde: DESDE_SIEMPRE, hasta: iso(hoy) };
}

/**
 * El histórico del laboratorio.
 *
 * La búsqueda corre en el servidor y vuelve por la URL, así que un resultado se
 * puede mandar por chat: quien atiende un reclamo comparte el enlace en vez de
 * explicar qué filtros puso.
 */
export default async function HistoricoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; desde?: string; hasta?: string }>;
}) {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");
  if (!(await nivelCalidadDe(supabase, user.id))) redirect("/");

  const params = await searchParams;
  const inicial = arranque();
  const texto = params.q ?? "";
  const desde = params.desde ?? inicial.desde;
  const hasta = params.hasta ?? inicial.hasta;

  // La migración la corre una persona, así que entre el deploy y esa corrida la
  // tabla puede no existir. Sin esto, `traerTodo` lanza y la pantalla se cae en
  // vez de decir qué falta — y el estreno del módulo sería un error.
  let filas: Awaited<ReturnType<typeof buscar>> = [];
  let error: string | null = null;
  try {
    filas = await buscar(supabase, { texto, desde, hasta });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <HistoricoClient filas={filas} texto={texto} desde={desde} hasta={hasta} error={error} />
  );
}
