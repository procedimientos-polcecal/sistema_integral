import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { traerDiasDeAsistencia } from "@/lib/rrhh/asistenciaDeEmpleado";
import { rangoPedido } from "@/lib/rrhh/rangoPedido";
import {
  encabezadoDeLaPlanilla,
  filasDeMarcaciones,
  nombreDelArchivo,
  totalesDeMarcaciones,
  type DiaDeLaPlanilla,
} from "@/lib/rrhh/marcacionesDelMes";
import ImprimirClient from "./ImprimirClient";

/**
 * Las marcaciones de un empleado, para imprimir o guardar en PDF.
 *
 * Los datos se arman acá, en el servidor, y no en el cliente: la pantalla se
 * manda a imprimir sola a los 600 ms de abrirse, y una tabla que todavía está
 * cargando sale en blanco.
 *
 * El acceso al módulo ya lo controla `app/(app)/rrhh/layout.tsx`, así que un
 * link directo a esta URL no se salta nada.
 */
export default async function ImprimirMarcacionesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const { id } = await params;
  const { desde: desdeParam, hasta: hastaParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { desde, hasta } = rangoPedido(
    new URLSearchParams({
      ...(desdeParam ? { desde: desdeParam } : {}),
      ...(hastaParam ? { hasta: hastaParam } : {}),
    })
  );

  const { data: empleado } = await supabase
    .from("empleados")
    .select("apellido, nombre, legajo, sectores(nombre)")
    .eq("id", id)
    .single();

  if (!empleado) notFound();

  const dias = (await traerDiasDeAsistencia(supabase, id, desde, hasta)) as unknown as DiaDeLaPlanilla[];

  const sectorEmbed = empleado.sectores as { nombre?: string } | { nombre?: string }[] | null;
  const sector = (Array.isArray(sectorEmbed) ? sectorEmbed[0] : sectorEmbed)?.nombre ?? null;
  const persona = [empleado.apellido, empleado.nombre].filter(Boolean).join(", ");

  return (
    <ImprimirClient
      titulo={persona}
      encabezado={encabezadoDeLaPlanilla({ ...empleado, sector }, desde, hasta)}
      filas={filasDeMarcaciones(dias)}
      totales={totalesDeMarcaciones(dias)}
      archivo={nombreDelArchivo(persona, desde, hasta, "pdf")}
    />
  );
}
