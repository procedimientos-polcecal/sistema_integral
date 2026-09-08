import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelProduccionDe } from "@/lib/produccion/auth";
import { esTurno, parteAnterior, comoSeLeeElTurno } from "@/lib/produccion/turnos";
import { traerProductos, traerParte, traerDepositoDe } from "@/lib/produccion/consultas";
import ParteClient from "./ParteClient";

/**
 * La carga de un parte, en el orden del papel: cabecera y capataz, depósito
 * agrupado en Filler / 0-2 / Cal, renglones de despacho, y los tres textos.
 * Transcribir tiene que ser leer de arriba abajo, no saltar.
 */
export default async function PartePage({
  params,
}: {
  params: Promise<{ fecha: string; turno: string }>;
}) {
  const { fecha, turno } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !esTurno(turno)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelProduccionDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [productos, completo, depositoAnterior, empleados] = await Promise.all([
    traerProductos(supabase),
    traerParte(supabase, { fecha, turno }),
    traerDepositoDe(supabase, parteAnterior({ fecha, turno })),
    // Apellido y nombre, y sólo activos: el capataz elige de una lista de
    // gente que trabaja hoy, y con nombres repetidos el apellido es lo que
    // distingue a un Fabricio de otro. El orden es el mismo que usa el resto
    // del sistema para listar personas (`apellido, nombre`).
    supabase.from("empleados").select("id, nombre, apellido").eq("activo", true).order("apellido").order("nombre"),
  ]);

  return (
    <ParteClient
      fecha={fecha}
      turno={turno}
      turnoLegible={comoSeLeeElTurno(turno)}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      productos={productos}
      parte={completo?.parte ?? null}
      deposito={completo?.deposito ?? {}}
      despachos={completo?.despachos ?? []}
      // Null acá es el dato que hace que la pantalla diga "no calculable" en vez
      // de mostrar una producción que sale de restar contra cero.
      depositoAnterior={depositoAnterior}
      parteAnterior={parteAnterior({ fecha, turno })}
      empleados={empleados.data ?? []}
    />
  );
}
