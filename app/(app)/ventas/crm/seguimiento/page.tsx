import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { nivelVentasDe } from "@/lib/ventas/auth";
import SeguimientoClient from "./SeguimientoClient";

/**
 * El seguimiento: qué hay que hacer, ordenado por lo más atrasado.
 *
 * Es la primera pantalla del menú de Ventas y no «Clientes», a propósito: un
 * CRM cuya puerta es el padrón de clientes se convierte en una agenda de
 * teléfonos. Lo que hace que alguien lo abra a la mañana es que le diga qué
 * tiene pendiente.
 *
 * **Trae sólo lo que tiene próximo paso sin cumplir**, y sin recorte de fecha:
 * lo vencido es todo lo vencido. Esconder lo de hace dos meses es exactamente
 * cómo se pierde un cliente; el recorte a una semana es del conteo del tablero
 * y no de esta lista.
 *
 * Los clientes se traen enteros y chicos (id y razón social) para poder poner
 * el nombre al lado de cada paso sin un join: PostgREST sabe embeber, pero el
 * embebido depende de que RLS deje ver la fila del otro lado y acá las dos
 * tablas tienen la misma policy, así que una lectura más y un `Map` es más
 * fácil de leer y no puede devolver un nombre en blanco.
 */
export default async function SeguimientoPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const permiso = await nivelVentasDe(supabase, user.id);
  if (!permiso.ok) {
    throw new Error(`No se pudieron comprobar tus permisos de Ventas: ${permiso.error}`);
  }
  const nivel = permiso.nivel;
  if (!nivel) redirect("/");

  const [pendientes, clientes, usuarios] = await Promise.all([
    traerTodo((desde, hasta) =>
      supabase
        .from("ventas_actividades")
        .select(
          "id, cliente_id, oportunidad_id, tipo, fecha, resumen, proximo_paso, proximo_paso_el, cumplido_el, hecha_por"
        )
        .not("proximo_paso_el", "is", null)
        .is("cumplido_el", null)
        .order("proximo_paso_el")
        .range(desde, hasta)
    ),
    traerTodo((desde, hasta) =>
      supabase
        .from("ventas_clientes")
        .select("id, razon_social, estado")
        .order("razon_social")
        .range(desde, hasta)
    ),
    traerTodo((desde, hasta) =>
      supabase
        .from("usuarios")
        .select("id, nombre, apellido, activo")
        .order("apellido")
        .range(desde, hasta)
    ),
  ]);

  return (
    <SeguimientoClient
      pendientesIniciales={pendientes as never}
      clientes={clientes.map((c) => ({
        id: c.id as string,
        razon_social: c.razon_social as string,
      }))}
      usuarios={usuarios.map((u) => ({
        id: u.id as string,
        nombre: `${u.nombre} ${u.apellido}`.trim(),
      }))}
      yo={user.id}
      hoy={hoyEnArgentina()}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
