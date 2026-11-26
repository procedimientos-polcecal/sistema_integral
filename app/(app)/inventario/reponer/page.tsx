import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe, esNivelDeEdicion } from "@/lib/inventario/auth";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina, sumarDias } from "@/lib/core/fechas";
import {
  clasificarParaReponer, riConEntrada, DIAS_DE_CONSUMO,
  type ArticuloConFaltante, type MovimientoDelConsumo, type RequerimientoConCodigo,
  type EntradaDeRequerimiento,
} from "@/lib/inventario/reponer";
import {
  desestimacionesPorArticulo, type Desestimacion,
} from "@/lib/inventario/desestimar";
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

  const [
    articulos, movimientos, requerimientos, entradasConRi, desestimadas,
    { data: areas }, { data: empresas }, { data: ubicaciones },
  ] =
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
      // Las entradas que nombran el RI que las trajo. **No se acotan a la
      // ventana de consumo**: un pedido de hace ocho meses pudo recibirse hace
      // siete, y con el filtro de 90 días esa entrada no entraría y el RI
      // seguiría figurando como abierto para siempre. Son 766 filas hoy y
      // `traerTodo` porque crecen con cada recepción.
      traerTodo<EntradaDeRequerimiento>((d, h) =>
        supabase.from("inventario_movimientos")
          .select("requerimiento_id, tipo")
          .not("requerimiento_id", "is", null).range(d, h)
      ),
      /*
       * Los faltantes que alguien desestimó. Van con `.catch(() => [])`
       * **a propósito**: la migración que crea esta tabla la aplica una
       * persona a mano, y entre el despliegue y ese momento la consulta
       * contesta un error. Sin la red, la pantalla entera dejaría de abrir por
       * una función que todavía no existe; con ella se comporta como el día
       * anterior. Es la misma ventana que ya mordió al nombrar una columna
       * nueva en un `select()`.
       */
      traerTodo<Desestimacion>((d, h) =>
        supabase.from("inventario_faltantes_desestimados")
          .select("articulo_id, ultimo_movimiento, motivo, desestimado_por_nombre, desestimado_en")
          .range(d, h)
      ).catch(() => [] as Desestimacion[]),
      supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
      supabase.from("empresas").select("id, nombre").order("nombre"),
      supabase.from("compras_ubicaciones").select("id, nombre").eq("activo", true).order("orden"),
    ]);

  const { paraPedir, yaPedidos, desestimados } = clasificarParaReponer(
    articulos, movimientos, requerimientos, hoy,
    riConEntrada(entradasConRi), desestimacionesPorArticulo(desestimadas)
  );

  return (
    <ReponerClient
      paraPedir={paraPedir}
      yaPedidos={yaPedidos}
      desestimados={desestimados}
      puedeDesestimar={esNivelDeEdicion(nivel)}
      areas={areas ?? []}
      empresas={empresas ?? []}
      ubicaciones={ubicaciones ?? []}
    />
  );
}
