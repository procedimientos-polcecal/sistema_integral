import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { nivelVentasDe } from "@/lib/ventas/auth";
import OportunidadesClient from "./OportunidadesClient";

/**
 * El embudo: qué hay en juego y en qué etapa.
 *
 * Trae **todas** las oportunidades, abiertas y cerradas, y el filtro lo hace la
 * pantalla: el embudo muestra las seis columnas y la tasa de conversión se
 * calcula sobre lo cerrado, así que traer sólo lo abierto obligaría a un
 * segundo viaje para el mismo tablero.
 *
 * Los clientes se traen aparte y se cruzan con un `Map`, en vez de embeberlos:
 * las dos tablas tienen la misma policy, así que el embebido no agrega nada y
 * sí agrega la chance de un nombre en blanco si alguna vez difieren.
 */
export default async function OportunidadesPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const permiso = await nivelVentasDe(supabase, user.id);
  if (!permiso.ok) {
    throw new Error(`No se pudieron comprobar tus permisos de Ventas: ${permiso.error}`);
  }
  const nivel = permiso.nivel;
  if (!nivel) redirect("/");

  const [oportunidades, clientes, usuarios] = await Promise.all([
    traerTodo((desde, hasta) =>
      supabase
        .from("ventas_oportunidades")
        .select(
          "id, numero, cliente_id, titulo, producto_id, toneladas_estimadas, monto_estimado, moneda, etapa, vendedor_id, fecha_estimada_cierre, cerrada_el, motivo_perdida, notas"
        )
        .order("numero", { ascending: false })
        .range(desde, hasta)
    ),
    traerTodo((desde, hasta) =>
      supabase
        .from("ventas_clientes")
        .select("id, razon_social")
        .order("razon_social")
        .range(desde, hasta)
    ),
    traerTodo((desde, hasta) =>
      supabase
        .from("usuarios")
        .select("id, nombre, apellido")
        .order("apellido")
        .range(desde, hasta)
    ),
  ]);

  return (
    <OportunidadesClient
      oportunidadesIniciales={oportunidades as never}
      clientes={clientes.map((c) => ({
        id: c.id as string,
        razon_social: c.razon_social as string,
      }))}
      usuarios={usuarios.map((u) => ({
        id: u.id as string,
        nombre: `${u.nombre} ${u.apellido}`.trim(),
      }))}
      hoy={hoyEnArgentina()}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
