import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe } from "@/lib/inventario/auth";
import { traerTodo } from "@/lib/core/paginado";
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

  // Los catálogos son del núcleo: se eligen de la lista en vez de escribirse.
  // Escribirlos cada vez es cómo "Candia" y "CANDIA" terminan siendo dos.
  const [sectores, empleados, proveedores] = await Promise.all([
    traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
      supabase.from("sectores").select("id, nombre").eq("activo", true).order("nombre").range(desde, hasta)
    ),
    traerTodo<{ id: string; nombre: string; apellido: string | null }>((desde, hasta) =>
      supabase.from("empleados").select("id, nombre, apellido").eq("activo", true).order("apellido").range(desde, hasta)
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

  return (
    <NuevoMovimientoClient
      articuloInicial={articulo}
      sectores={sectores}
      empleados={empleados.map((e) => ({
        id: e.id,
        nombre: [e.apellido, e.nombre].filter(Boolean).join(", "),
      }))}
      proveedores={proveedores}
    />
  );
}
