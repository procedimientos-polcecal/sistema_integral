import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe } from "@/lib/inventario/auth";
import { traerTodo } from "@/lib/core/paginado";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import NuevoMovimientoClient from "./NuevoMovimientoClient";

export default async function NuevoMovimientoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelInventarioDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel === "lectura") redirect("/inventario");

  // Quién retira y a dónde va salen de la lista del pañol y no de `empleados` y
  // `sectores`: es la validación que la planilla tiene puesta en las columnas F
  // y J, e incluye contratistas y oficios que los catálogos del núcleo no
  // tienen ni deberían tener. Ver `lib/inventario/catalogos.ts`.
  const [solicitantes, destinos, proveedores] = await Promise.all([
    traerTodo<{ id: string; nombre: string; destino_id: string | null }>((desde, hasta) =>
      supabase.from("inventario_solicitantes").select("id, nombre, destino_id")
        .eq("activo", true).order("nombre").range(desde, hasta)
    ),
    traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
      supabase.from("inventario_destinos").select("id, nombre")
        .eq("activo", true).order("nombre").range(desde, hasta)
    ),
    traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
      supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre").range(desde, hasta)
    ),
  ]);

  const params = await searchParams;
  const articuloId = typeof params.articulo === "string" ? params.articulo : null;

  // Si vino elegido desde el stock se trae acá, por id. Buscarlo desde el
  // cliente entre los primeros resultados no lo encontraría: son 2.800.
  const { data: articulo } = articuloId
    ? await supabase
        .from("inventario_articulos")
        .select("id, codigo, descripcion, ubicacion, stock_actual, stock_seguridad, faltante")
        .eq("id", articuloId)
        .maybeSingle()
    : { data: null };

  // De cuándo es lo que se está mirando. Va en todas las pantallas del
  // módulo porque el botón de traer también.
  const sync = await ultimaSincronizacionDe(supabase, "inventario", "articulos");

  return (
    <NuevoMovimientoClient
      sync={sync}
      articuloInicial={articulo}
      solicitantes={solicitantes.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        destinoId: s.destino_id,
      }))}
      destinos={destinos}
      proveedores={proveedores}
    />
  );
}
