import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/core/paginado";
import { nivelRrhhDe } from "@/lib/rrhh/auth";
import DisponibilidadClient from "./DisponibilidadClient";

/**
 * Disponibilidad: quién no viene y qué día, y el ausentismo del mes.
 *
 * Fuera de todo módulo a propósito, como «Mis avisos»: que alguien no está lo
 * necesita saber quien arma un turno, quien pide un camión o quien dirige un
 * área, y de 14 usuarios 8 no tienen RRHH. La entrada del menú no lleva
 * `modulo` por lo mismo.
 *
 * **Para VER, esta página sólo pide sesión.** Quién ve qué lo decide cada ruta
 * de API y no ésta: `/api/disponibilidad` es para cualquiera que entre y
 * entrega sólo quién y qué día —nunca el motivo—; `/api/disponibilidad/reportes`
 * recorta su respuesta según quién pregunta (ver `reportesQueVe`). Repetir el
 * control acá sería una segunda copia de la regla, y la que no corre es la que
 * se desactualiza.
 *
 * **Para CARGAR sí se mira quién es, y acá el nivel no es una segunda copia
 * sino otra cosa: decide qué se dibuja.** Quien no tiene edición en RRHH no ve
 * el formulario. Lo que impide que cargue igual es
 * `POST /api/rrhh/ausencias`, que exige ese nivel con `puede_editar_check`; si
 * esto se olvidara, la ruta seguiría contestando 403.
 *
 * El padrón se trae sólo para quien puede cargar, porque es lo único que ese
 * formulario necesita y no hay motivo para mandárselo al resto. Sin filtrar por
 * `activo`: una ausencia de alguien dado de baja hace días es justo lo que
 * alguien puede estar viniendo a cargar.
 *
 * Ver docs/superpowers/specs/2026-10-29-disponibilidad-y-ausentismo-design.md,
 * sección «Quién ve qué».
 */
export default async function DisponibilidadPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelRrhhDe(supabase, user.id);
  const puedeCargar = nivel === "edicion" || nivel === "admin";

  const empleados = puedeCargar
    ? await traerTodo<{ id: string; nombre: string; apellido: string }>((desde, hasta) =>
        supabase.from("empleados").select("id, nombre, apellido").order("apellido").range(desde, hasta)
      )
    : [];

  return (
    <DisponibilidadClient
      puedeCargar={puedeCargar}
      empleados={empleados.map((e) => ({ id: e.id, nombre: `${e.apellido}, ${e.nombre}` }))}
    />
  );
}
