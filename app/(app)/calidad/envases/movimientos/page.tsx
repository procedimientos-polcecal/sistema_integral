import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { traerTodo } from "@/lib/core/paginado";
import MovimientosClient, {
  type MovimientoEnPantalla, type ArticuloDelSelector,
} from "./MovimientosClient";

export default async function MovimientosPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [articulos, movimientos] = await Promise.all([
    traerTodo<ArticuloDelSelector>((desde, hasta) =>
      supabase
        .from("calidad_envases_articulos")
        .select("id, codigo, descripcion, grupo")
        .eq("activo", true)
        .order("codigo")
        .range(desde, hasta)
    ),
    // `traerTodo` y no un `.limit()`: son 1.404 filas y PostgREST corta en 1000
    // sin avisar. Un `.limit(3000)` devuelve 1000 y la pantalla miente sin que
    // nada falle.
    traerTodo<MovimientoEnPantalla>((desde, hasta) =>
      supabase
        .from("calidad_envases_movimientos")
        .select("id, articulo_id, codigo, fecha, entrada, salida, rotura, despacho, observacion, sheets_pendiente")
        .order("fecha", { ascending: false })
        .range(desde, hasta)
    ),
  ]);

  return (
    <MovimientosClient
      articulos={articulos}
      movimientos={movimientos}
      puedeOperar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
