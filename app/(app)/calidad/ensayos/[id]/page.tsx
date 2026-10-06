import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { traerLimites, traerMuestra, traerProductos } from "@/lib/calidad/ensayos/consultas";
import MuestraClient from "./MuestraClient";

/** Una muestra: la medición al lado del resultado, y se corrige acá mismo. */
export default async function MuestraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [datos, productos, limites] = await Promise.all([
    traerMuestra(supabase, id),
    traerProductos(supabase),
    traerLimites(supabase),
  ]);

  if (!datos) notFound();

  const { data: quienes } = await supabase
    .from("usuarios")
    .select("id, nombre")
    .in(
      "id",
      [datos.muestra.cargado_por, datos.muestra.actualizado_por].filter(
        (x): x is string => x !== null
      )
    );

  const nombreDe = (id: string | null) =>
    id ? (quienes ?? []).find((u) => u.id === id)?.nombre ?? "alguien" : null;

  return (
    <MuestraClient
      muestra={datos.muestra}
      retenidos={datos.retenidos}
      productos={productos}
      limites={limites}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      cargadoPor={nombreDe(datos.muestra.cargado_por)}
      actualizadoPor={nombreDe(datos.muestra.actualizado_por)}
    />
  );
}
