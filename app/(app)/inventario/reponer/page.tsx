import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe } from "@/lib/inventario/auth";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina, sumarDias } from "@/lib/core/fechas";
import {
  clasificarParaReponer, DIAS_DE_CONSUMO,
  type ArticuloConFaltante, type MovimientoDelConsumo, type RequerimientoConCodigo,
} from "@/lib/inventario/reponer";
import ReponerClient from "./ReponerClient";

/**
 * Qué hay que reponer: faltante **y** consumo reciente.
 *
 * El faltante solo no alcanza —521 artículos lo tienen, el 45% del catálogo—
 * así que lo que decide es la función pura de `lib/inventario/reponer.ts`, que
 * tiene los números medidos y el porqué del corte.
 *
 * Los catálogos del formulario de Compras se traen acá, chicos y enseguida,
 * porque el modal del alta los necesita apenas alguien aprieta Pedir. Es lo
 * mismo que hace `/mis-pedidos`.
 */
export default async function ReponerPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelInventarioDe(supabase, user.id);
  if (!nivel) redirect("/");

  const hoy = hoyEnArgentina();
  const desde = sumarDias(hoy, -DIAS_DE_CONSUMO);

  const [articulos, movimientos, requerimientos, { data: areas }, { data: empresas }, { data: ubicaciones }] =
    await Promise.all([
      // `traerTodo` y no `.limit()`: PostgREST corta en 1000 y no avisa, y hoy
      // hay 521 artículos con faltante.
      traerTodo<ArticuloConFaltante>((d, h) =>
        supabase.from("inventario_articulos")
          .select("id, codigo, descripcion, stock_actual, stock_seguridad, faltante, activo")
          .gt("faltante", 0).eq("activo", true).range(d, h)
      ),
      // Filtrado por fecha en la consulta: son ~4.200 movimientos en total y
      // traerlos todos para mirar un trimestre no tiene sentido. El tipo **no**
      // se filtra acá —lo hace la función pura, que es donde se puede probar
      // que una entrada no justifica un pedido.
      traerTodo<MovimientoDelConsumo>((d, h) =>
        supabase.from("inventario_movimientos")
          .select("codigo, tipo, fecha").gte("fecha", desde).range(d, h)
      ),
      traerTodo<RequerimientoConCodigo>((d, h) =>
        supabase.from("compras_requerimientos")
          .select("id, nro_ri, codigo, fecha, estado_aprobacion, estado_compra")
          .not("codigo", "is", null).range(d, h)
      ),
      supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
      supabase.from("empresas").select("id, nombre").order("nombre"),
      supabase.from("compras_ubicaciones").select("id, nombre").eq("activo", true).order("orden"),
    ]);

  const { paraPedir, yaPedidos } = clasificarParaReponer(articulos, movimientos, requerimientos, hoy);

  return (
    <ReponerClient
      paraPedir={paraPedir}
      yaPedidos={yaPedidos}
      areas={areas ?? []}
      empresas={empresas ?? []}
      ubicaciones={ubicaciones ?? []}
    />
  );
}
