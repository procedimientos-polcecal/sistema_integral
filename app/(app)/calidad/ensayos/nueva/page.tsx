import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { traerLimites, traerProductos } from "@/lib/calidad/ensayos/consultas";
import CargarClient from "./CargarClient";

/** La carga de una muestra. Hace falta `edicion` o `admin`. */
export default async function CargarMuestraPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel === "lectura") redirect("/calidad/ensayos");

  const [productos, limites] = await Promise.all([
    traerProductos(supabase),
    traerLimites(supabase),
  ]);

  return (
    <CargarClient
      productos={productos.filter((p) => p.activo)}
      limites={limites}
      hoy={new Date().toISOString().slice(0, 10)}
    />
  );
}
