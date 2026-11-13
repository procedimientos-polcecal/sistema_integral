import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { nivelVentasDe } from "@/lib/ventas/auth";
import ClientesClient from "./ClientesClient";

/**
 * El padrón de clientes y prospectos, con su semáforo de seguimiento.
 *
 * Trae **todos** con `traerTodo` y no con un límite: PostgREST corta en 1000
 * filas y no avisa. Los filtros y el orden se resuelven en el navegador, sobre
 * las funciones puras de `lib/ventas/crm/seguimiento.ts`, así al guardar una
 * ficha la fila se reubica sin volver a pedir nada.
 *
 * **Las actividades se traen con dos columnas y no un conteo por cliente.** El
 * semáforo sale de la fecha de la última, y PostgREST no sabe hacer un
 * `max(fecha) group by cliente_id` sin una vista. Una vista más para una tabla
 * que hoy tiene decenas de filas sería una cosa más que mantener; cuando crezca
 * va acá, y el cálculo no se mueve porque ya vive en una función con test.
 *
 * `?cliente=<id>` abre esa ficha al cargar: es adonde apunta cada fila del
 * seguimiento. No se valida contra la base —los clientes ya vienen todos—, así
 * que quien decide si el id existe es el cliente mirando la lista que ya tiene.
 *
 * `?seguimiento=sin_contacto` arranca filtrado, que es adonde lleva la tarjeta
 * de «clientes enfriados» del tablero.
 */
export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const crudos = await searchParams;
  const unValor = (v: string | string[] | undefined) =>
    typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;

  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const permiso = await nivelVentasDe(supabase, user.id);
  if (!permiso.ok) {
    throw new Error(`No se pudieron comprobar tus permisos de Ventas: ${permiso.error}`);
  }
  const nivel = permiso.nivel;
  if (!nivel) redirect("/");

  const [clientes, actividades, usuarios, productos] = await Promise.all([
    traerTodo((desde, hasta) =>
      supabase
        .from("ventas_clientes")
        .select(
          "id, numero, razon_social, nombre_fantasia, cuit, estado, vendedor_id, localidad, provincia, rubro, telefono, email, sitio_web, origen, notas"
        )
        .order("razon_social")
        .range(desde, hasta)
    ),
    traerTodo((desde, hasta) =>
      supabase.from("ventas_actividades").select("cliente_id, fecha").range(desde, hasta)
    ),
    traerTodo((desde, hasta) =>
      supabase
        .from("usuarios")
        .select("id, nombre, apellido, activo")
        .order("apellido")
        .range(desde, hasta)
    ),
    // El catálogo del núcleo, compartido con Producción y Despacho. Se pide
    // entero porque es chico y porque una oportunidad vieja tiene que poder
    // mostrar su producto aunque ya no esté activo.
    traerTodo((desde, hasta) =>
      supabase
        .from("productos")
        .select("id, nombre, odoo_default_code")
        .order("nombre")
        .range(desde, hasta)
    ),
  ]);

  return (
    // `key` con los parámetros: tocar la tarjeta del tablero estando ya en esta
    // pantalla es una navegación suave, y sin la key el `useState` de adentro
    // ignoraría los filtros nuevos — la barra de direcciones diría una cosa y la
    // pantalla otra. Es la misma razón que en `/seguridad-higiene/condiciones`.
    <ClientesClient
      key={`${unValor(crudos.cliente) ?? ""}|${unValor(crudos.seguimiento) ?? ""}`}
      clientesIniciales={clientes as never}
      actividades={actividades as never}
      usuarios={usuarios.map((u) => ({
        id: u.id as string,
        nombre: `${u.nombre} ${u.apellido}`.trim(),
        activo: u.activo as boolean,
      }))}
      productos={productos.map((p) => ({
        id: p.id as string,
        nombre: p.odoo_default_code
          ? `[${p.odoo_default_code}] ${p.nombre}`
          : (p.nombre as string),
      }))}
      clienteInicial={unValor(crudos.cliente)}
      seguimientoInicial={unValor(crudos.seguimiento)}
      hoy={hoyEnArgentina()}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      esAdmin={nivel === "admin"}
    />
  );
}
