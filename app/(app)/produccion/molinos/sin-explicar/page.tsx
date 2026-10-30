import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { puedeEditarProduccion, tieneAccesoProduccion } from "@/lib/produccion/auth";
import { puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import {
  colaDeMolino,
  otsParaEnlazar,
  traerMolinos,
  type ColaDeMolino,
  type OtParaEnlazar,
} from "@/lib/produccion/molinos/consultas";
import { nombreDelMolino } from "@/lib/produccion/molinos/formato";
import ColaClient from "./ColaClient";

export interface MolinoDeLaCola {
  id: string;
  /** "molino Filler 1": siempre acompañado (ver `nombreDelMolino`). */
  nombre: string;
  umbralMinutos: number;
  desde: string;
  cola: ColaDeMolino;
}

/**
 * Los turnos de los molinos que pararon más del umbral y todavía no tienen
 * motivo. Es lo único que una persona carga en este frente.
 *
 * Usa el cliente admin, así que los dos permisos se comprueban acá arriba: ahí
 * RLS no corre. **La lista de OT sólo se lee si quien mira tiene acceso a
 * Mantenimiento** —y si no lo tiene no es una lista vacía: es `null`, y la
 * pantalla lo dice—. Las tablas de ese módulo están cerradas con su propia
 * función, y a quien no la tiene una lista vacía le llegaría sin error y se
 * leería como "no hay OT". Es la misma trampa del valor hora en
 * `rrhh_empleados_datos`.
 */
export default async function SinExplicarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await tieneAccesoProduccion(supabase, user.id))) redirect("/");

  const [puedeEditar, conMantenimiento] = await Promise.all([
    puedeEditarProduccion(supabase, user.id),
    puedeVerMantenimiento(supabase, user.id),
  ]);

  const admin = createAdminClient();
  const molinos = await traerMolinos(admin);
  const porMolino: MolinoDeLaCola[] = await Promise.all(
    molinos.map(async (m) => ({
      id: m.id,
      nombre: nombreDelMolino(m.nombre),
      umbralMinutos: m.umbral_minutos,
      desde: m.desde,
      cola: await colaDeMolino(admin, m),
    })),
  );
  const ots: OtParaEnlazar[] | null = conMantenimiento ? await otsParaEnlazar(admin, hoyEnArgentina()) : null;

  return <ColaClient molinos={porMolino} ots={ots} puedeEditar={puedeEditar} />;
}
