import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MisPedidosClient, { type ProblemaDelEnlace } from "./MisPedidosClient";

/**
 * Fuera del módulo Compras a propósito: cualquier usuario del sistema puede
 * pedir un material, seguir los pedidos **de su área** y mirar los de los
 * demás.
 *
 * De su área y no los suyos: acá los requerimientos se piden por área, así que
 * los 950 RI de Mantenimiento los tienen que ver todos los de Mantenimiento.
 * Filtrar por quién los cargó dejaba la pantalla vacía —los 1.947 vinieron de
 * la planilla y ninguno trae solicitante— y además contestaba otra pregunta.
 *
 * Lo último no es un permiso nuevo: la 018 ya dejó `compras_requerimientos` con
 * lectura abierta a todo usuario autenticado, y lo dejó escrito con su razón —
 * "el circuito de compras es transversal a toda la empresa". Lo que faltaba era
 * una pantalla que lo aprovechara, para que dos personas no pidan lo mismo la
 * misma semana.
 *
 * Los pedidos los trae el cliente, no esta página: son 1.947 y mandarlos todos
 * al navegador para mostrar cincuenta es lo que hace que una pantalla tarde en
 * abrir. Acá quedan sólo los catálogos del formulario, que son chicos y se
 * necesitan enseguida para poder pedir.
 */
export default async function MisPedidosPage({
  searchParams,
}: {
  /** `pedido`: el id del requerimiento al que lleva el enlace de un correo de mensajería. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const pedidoDelEnlace = (await searchParams).pedido;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: areas }, { data: empresas }, { data: ubicaciones }, { data: mias }] =
    await Promise.all([
      supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
      supabase.from("empresas").select("id, nombre").order("nombre"),
      supabase.from("compras_ubicaciones").select("id, nombre").eq("activo", true).order("orden"),
      // De qué áreas es esta persona. Acá se piden por área y no por nombre:
      // los RI de Mantenimiento los mira todo Mantenimiento, los haya cargado
      // quien los haya cargado.
      supabase.from("usuario_areas_compras").select("area_id").eq("usuario_id", user.id),
    ]);

  // El pedido del enlace se resuelve **acá y por su id**, no buscándolo entre los
  // que trae el cliente: ése trae una página de 50 filtrada por área o búsqueda,
  // y el pedido por el que avisaron puede ser de otra área o estar en la página
  // 30. Llegar del correo a una lista que no lo contiene sería peor que no tener
  // enlace. Lo lee con la sesión: la lectura de `compras_requerimientos` es de
  // todo autenticado, a propósito (migración 018).
  let conversacionInicial: { id: string; nroRi: number; descripcion: string } | null = null;
  // Tres cosas que pueden salir mal y que **no son lo mismo**: el enlace está
  // mal escrito, el pedido no existe, o la base no contestó. Decir «ya no
  // existe» de las tres le haría buscar un pedido que está ahí a quien sólo tuvo
  // una caída, y es lo que se evita acá.
  let problemaDelEnlace: ProblemaDelEnlace | null = null;
  if (typeof pedidoDelEnlace === "string" && pedidoDelEnlace !== "") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pedidoDelEnlace)) {
      // Un id sin forma de uuid no se manda a la base: daría un error de tipo
      // que ya no se distinguiría de una caída.
      problemaDelEnlace = { tipo: "no-valido" };
    } else {
      const { data: pedido, error } = await supabase
        .from("compras_requerimientos")
        .select("id, nro_ri, descripcion")
        .eq("id", pedidoDelEnlace)
        .maybeSingle();
      if (error) {
        // Lo que dijo la base, sin traducir.
        problemaDelEnlace = { tipo: "error", detalle: error.message };
      } else if (pedido) {
        conversacionInicial = { id: pedido.id, nroRi: pedido.nro_ri, descripcion: pedido.descripcion };
      } else {
        problemaDelEnlace = { tipo: "no-existe" };
      }
    }
  }

  return (
    <MisPedidosClient
      conversacionInicial={conversacionInicial}
      problemaDelEnlace={problemaDelEnlace}
      usuarioId={user.id}
      misAreas={(mias ?? []).map((a) => a.area_id as string)}
      areas={areas ?? []}
      empresas={empresas ?? []}
      ubicaciones={ubicaciones ?? []}
    />
  );
}
