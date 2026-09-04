import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { permisosComprasDe, aprobadoresDeCompras, aprobadoresDeOS } from "@/lib/compras/auth";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { cuentaDeServicio } from "@/lib/core/google";
import ConfiguracionClient from "./ConfiguracionClient";
import type { Sincronizacion } from "@/lib/compras/types";

export default async function ConfiguracionPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const permisos = await permisosComprasActuales();
  if (!permisos.puedeEditar) redirect("/compras");

  // La pregunta que importa es "¿ya puedo apagar la planilla?", y eso se
  // responde mirando por dónde entran los pedidos NUEVOS, no qué porcentaje del
  // histórico se tocó: los 1800 RI viejos ya están cerrados y nadie los va a
  // volver a gestionar acá, así que ese porcentaje nunca sube.
  // `react-hooks/purity` marca el `Date.now()` porque no distingue un
  // componente de servidor de uno de cliente. Acá es de servidor —lo delata el
  // `createClient` de `@/lib/supabase/server`— y se renderiza una vez por
  // request: no hay re-render que pueda dar un resultado distinto. La regla se
  // deja prendida porque en los de cliente sí encontró dos bugs de verdad.
  // eslint-disable-next-line react-hooks/purity
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const cuenta = (f: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => f(base());
  function base() {
    return supabase.from("compras_requerimientos").select("id", { count: "exact", head: true });
  }

  const [
    { data: sincronizaciones },
    { count: nuevosApp },
    { count: nuevosPlanilla },
    { count: abiertos },
    { count: abiertosGestionados },
    { count: gestionados },
    { count: total },
  ] = await Promise.all([
    supabase.from("compras_sincronizaciones").select("*").order("created_at", { ascending: false }).limit(10),
    cuenta((q) => q.eq("origen", "app").gte("fecha", hace30)),
    cuenta((q) => q.neq("origen", "app").gte("fecha", hace30)),
    cuenta((q) => q.not("estado_compra", "in", "(RECIBIDO,DENEGADO)").neq("estado_aprobacion", "DENEGADA")),
    cuenta((q) =>
      q.not("estado_compra", "in", "(RECIBIDO,DENEGADO)").neq("estado_aprobacion", "DENEGADA").eq("editado_en_app", true)
    ),
    cuenta((q) => q.eq("editado_en_app", true)),
    cuenta((q) => q),
  ]);

  // Lo que la planilla rechazó y sigue sin escribirse.
  const { data: pendientes } = await supabase
    .from("compras_requerimientos")
    .select("id, nro_ri, descripcion, sheets_pendiente, sheets_intentado_en")
    .not("sheets_pendiente", "is", null)
    .order("nro_ri", { ascending: false })
    .limit(50);

  const aprobadores = await aprobadoresDeCompras(supabase);

  // La otra lista: quién decide sobre las órdenes de servicio. Va acá al lado y
  // no en otra pantalla justamente para que se vea que son dos y no una.
  const aprobadoresOS = await aprobadoresDeOS(supabase);

  // Con qué alias figura cada uno en el desplegable de la planilla.
  const { data: alias } = await supabase
    .from("compras_aprobadores")
    .select("usuario_id, alias_planilla");
  const porUsuario = Object.fromEntries(
    (alias ?? []).map((a) => [a.usuario_id as string, a.alias_planilla as string])
  );
  const conAlias = aprobadores.map((a) => ({ ...a, alias: porUsuario[a.id] ?? null }));

  // Para poder sumar a alguien a la lista hace falta saber a quién.
  const { data: usuarios } = await supabase
    .from("usuarios")
    .select("id, nombre, apellido, email")
    .eq("activo", true)
    .order("nombre");

  return (
    <ConfiguracionClient
      cuentaDeServicio={cuentaDeServicio() ?? null}
      sincronizaciones={(sincronizaciones ?? []) as Sincronizacion[]}
      aprobadores={conAlias}
      aprobadoresOS={aprobadoresOS}
      usuarios={usuarios ?? []}
      pendientes={pendientes ?? []}
      nuevosApp={nuevosApp ?? 0}
      nuevosPlanilla={nuevosPlanilla ?? 0}
      abiertos={abiertos ?? 0}
      abiertosGestionados={abiertosGestionados ?? 0}
      gestionados={gestionados ?? 0}
      total={total ?? 0}
    />
  );
}
