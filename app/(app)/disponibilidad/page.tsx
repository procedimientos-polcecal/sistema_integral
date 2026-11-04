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
 * El padrón se lee para todos —de ahí sale la dotación por sector que usa el
 * resumen— pero la **lista de nombres** del formulario se le manda sólo a quien
 * puede cargar.
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

  const empleados = await traerTodo<{
    id: string;
    nombre: string;
    apellido: string;
    activo: boolean;
    sectores: unknown;
  }>((desde, hasta) =>
    supabase
      .from("empleados")
      .select("id, nombre, apellido, activo, sectores(nombre)")
      .order("apellido")
      .range(desde, hasta)
  );

  /*
   * La dotación de cada sector, para que el resumen pueda decir «3 de sus 11».
   * Va a todo el mundo y no sólo a quien puede cargar, y eso es a propósito:
   * `empleados` tiene la lectura abierta a cualquier autenticado, así que
   * cuánta gente tiene un sector ya está al alcance de todos. Lo que la sección
   * protege es el MOTIVO de una ausencia, no el organigrama — se comprobó antes
   * de ponerlo, porque la decisión del 02/11 fue justamente cerrar lo que
   * volvía identificable un agregado.
   *
   * Acá sí se cuentan sólo los **activos**: la dotación es con cuánta gente
   * cuenta hoy el sector. Es la única cuenta de toda la sección que filtra por
   * `activo`, y por eso está dicho: en los reportes, filtrar vuelve huérfanas
   * las ausencias de quien se fue (R27), pero un divisor que incluye a quien ya
   * no está diría que el sector tiene más gente de la que tiene.
   */
  const personalPorSector: Record<string, number> = {};
  for (const e of empleados) {
    if (!e.activo) continue;
    const s = Array.isArray(e.sectores) ? e.sectores[0] : e.sectores;
    const nombre = (s as { nombre?: unknown } | null | undefined)?.nombre;
    const clave = typeof nombre === "string" ? nombre : "Sin sector";
    personalPorSector[clave] = (personalPorSector[clave] ?? 0) + 1;
  }

  return (
    <DisponibilidadClient
      puedeCargar={puedeCargar}
      personalPorSector={personalPorSector}
      // El padrón del formulario va sólo a quien puede cargar, y sin filtrar
      // por `activo`: una ausencia de alguien dado de baja hace días es justo
      // lo que alguien puede venir a cargar.
      empleados={puedeCargar ? empleados.map((e) => ({ id: e.id, nombre: `${e.apellido}, ${e.nombre}` })) : []}
    />
  );
}
