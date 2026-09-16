import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelProduccionDe } from "@/lib/produccion/auth";
import { traerTodo } from "@/lib/core/paginado";
import type {
  ArticuloDelInforme, MovimientoDelInforme,
} from "@/lib/produccion/envases/informe";
import PeriodoClient from "./PeriodoClient";

export default async function PeriodoPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  if (!(await nivelProduccionDe(supabase, user.id))) redirect("/");

  const [articulos, movimientos] = await Promise.all([
    traerTodo<ArticuloDelInforme>((desde, hasta) =>
      supabase
        .from("produccion_envases_articulos")
        .select("id, codigo, grupo, stock_actual")
        .eq("activo", true)
        .range(desde, hasta)
    ),
    traerTodo<MovimientoDelInforme>((desde, hasta) =>
      supabase
        .from("produccion_envases_movimientos")
        .select("articulo_id, fecha, entrada, salida, rotura, despacho")
        .range(desde, hasta)
    ),
  ]);

  return <PeriodoClient articulos={articulos} movimientos={movimientos} />;
}
