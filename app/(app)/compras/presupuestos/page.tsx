import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { ESTADOS_DECIDIDOS } from "@/lib/compras/congelada";
import { esFilaPlantilla } from "@/lib/compras/constants";
import { listarComparativas, carpetaConfigurada } from "@/lib/compras/drive";
import PresupuestosClient, { type PedidoOfrecido } from "./PresupuestosClient";

export default async function PresupuestosPage() {
  const user = await usuarioActual();
  if (!user) redirect("/login");

  // La carga escribe: quien sólo mira no tiene nada que hacer acá.
  const { puedeEditar } = await permisosComprasActuales();
  if (!puedeEditar) redirect("/compras");

  const supabase = await createClient();

  // Los pedidos a los que todavía se les puede cargar un presupuesto: aprobados
  // y sin compra decidida, que es la misma pregunta que hace la ruta al guardar.
  // Paginado: no es una cola acotada, y PostgREST corta en 1000 sin avisar.
  const pedidos = await traerTodo<{
    id: string;
    nro_ri: number;
    descripcion: string | null;
    comparativa_drive_id: string | null;
    comparativa_nombre: string | null;
    // El tipo inferido del embed es un arreglo aunque llegue un objeto.
    compras_areas: { nombre: string } | { nombre: string }[] | null;
  }>((desde, hasta) =>
    supabase
      .from("compras_requerimientos")
      .select("id, nro_ri, descripcion, comparativa_drive_id, comparativa_nombre, compras_areas(nombre)")
      .eq("estado_aprobacion", "APROBADA")
      .not("estado_compra", "in", `(${ESTADOS_DECIDIDOS.join(",")})`)
      .order("nro_ri", { ascending: false })
      .range(desde, hasta)
  );

  // El `cuit` viaja sólo para poder avisar que falta: no completa ningún campo
  // de la carga. Es el mismo criterio que en el formulario por pedido.
  const proveedores = await traerTodo<{ id: string; nombre: string; cuit: string | null }>((desde, hasta) =>
    supabase
      .from("proveedores")
      .select("id, nombre, cuit")
      .eq("activo", true)
      .order("nombre")
      .range(desde, hasta)
  );

  // La carpeta de Drive. Si no se puede leer, la pantalla sigue andando: se
  // carga igual y el aviso dice por qué no hay planilla para elegir. Google
  // pagina la lista en 200 archivos y `listarComparativas` no sigue, así que
  // `traerTodo` no aplica acá.
  let archivos: { id: string; nombre: string }[] = [];
  let avisoDeDrive: string | null = null;
  if (!carpetaConfigurada()) {
    avisoDeDrive = "La carpeta de comparativas no está configurada en este entorno: no hay planillas para elegir.";
  } else {
    try {
      archivos = (await listarComparativas())
        .filter((a) => a.esPlanillaGoogle)
        .map((a) => ({ id: a.id, nombre: a.nombre }));
    } catch (e) {
      avisoDeDrive = "No se pudo leer la carpeta de comparativas: " + (e instanceof Error ? e.message : String(e));
    }
  }

  const ofrecidos: PedidoOfrecido[] = pedidos
    .filter((p) => !esFilaPlantilla(p.nro_ri))
    .map((p) => ({
      id: p.id,
      nro_ri: p.nro_ri,
      descripcion: p.descripcion ?? "",
      area: (Array.isArray(p.compras_areas) ? p.compras_areas[0] : p.compras_areas)?.nombre ?? null,
      planillaId: p.comparativa_drive_id,
      planillaNombre: p.comparativa_nombre,
    }));

  return (
    <PresupuestosClient
      pedidos={ofrecidos}
      proveedores={proveedores}
      archivos={archivos}
      avisoDeDrive={avisoDeDrive}
      hoy={hoyEnArgentina()}
    />
  );
}
