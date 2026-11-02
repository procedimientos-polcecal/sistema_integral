import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DisponibilidadClient from "./DisponibilidadClient";

/**
 * Disponibilidad: quién no viene y qué día, y el ausentismo del mes.
 *
 * Fuera de todo módulo a propósito, como «Mis avisos»: que alguien no está lo
 * necesita saber quien arma un turno, quien pide un camión o quien dirige un
 * área, y de 14 usuarios 8 no tienen RRHH. La entrada del menú no lleva
 * `modulo` por lo mismo.
 *
 * **Esta página sólo pide sesión.** Quién ve qué lo decide cada ruta de API y
 * no ésta: `/api/disponibilidad` es para cualquiera que entre y entrega sólo
 * quién y qué día —nunca el motivo—; `/api/disponibilidad/reportes` recorta su
 * respuesta según quién pregunta (ver `reportesQueVe`). Repetir el control acá
 * sería una segunda copia de la regla, y la que no corre es la que se
 * desactualiza.
 *
 * Ver docs/superpowers/specs/2026-10-29-disponibilidad-y-ausentismo-design.md,
 * sección «Quién ve qué».
 */
export default async function DisponibilidadPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <DisponibilidadClient />;
}
