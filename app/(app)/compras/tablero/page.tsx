import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { COMPRA_LABELS, moneda } from "@/lib/compras/constants";
import { armarIndicadores } from "@/lib/compras/tablero";
import Indicador from "@/components/Indicador";
import type { EstadoCompra } from "@/lib/compras/types";

interface FilaResumen {
  estado_compra: EstadoCompra;
  cantidad: number;
  monto: number;
}

export default async function TableroPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  // Cinco filas: la vista agrupa en la base. El tablero anterior traía los
  // requerimientos para contarlos, y por eso tenía que recortar PEDIDO a los
  // últimos 90 días.
  const [{ data: resumen, error }, { puedeAprobar }] = await Promise.all([
    supabase.from("compras_resumen_por_estado").select("estado_compra, cantidad, monto"),
    // Ya lo calculó el layout: vuelve sin salir a la red.
    permisosComprasActuales(),
  ]);

  const indicadores = armarIndicadores(
    // La vista devuelve numeric, que PostgREST manda como texto para no perder
    // precisión: sin el Number() el monto se concatenaría en vez de sumar.
    ((resumen ?? []) as FilaResumen[]).map((f) => ({
      estado_compra: f.estado_compra,
      cantidad: Number(f.cantidad),
      monto: Number(f.monto),
    })),
    puedeAprobar
  );

  // Lo que de verdad es cola de trabajo: ni lo ya pedido, ni lo frenado a
  // propósito.
  const enCurso = indicadores
    .filter((i) => i.estado !== "PEDIDO" && i.estado !== "EN_ESPERA")
    .reduce((acc, i) => acc + i.cantidad, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Tablero de compras</h1>
        <p className="text-sm text-slate-500">
          {enCurso} requerimiento{enCurso === 1 ? "" : "s"} aprobados esperando algo.
          Tocá una etapa para trabajarla.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">No se pudo traer el resumen.</p>
          <p className="mt-1">
            Los indicadores están en cero por eso, no porque no haya trabajo.
          </p>
          <p className="mt-1 font-mono text-xs break-all">{error.message}</p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {indicadores.map((i) => (
          <Indicador
            key={i.estado}
            titulo={COMPRA_LABELS[i.estado].label}
            valor={i.cantidad}
            href={i.href}
            acento={i.acento}
            pie={i.monto > 0 ? moneda(i.monto) : null}
          />
        ))}
      </section>

      <p className="text-xs text-slate-400">
        El monto es lo comprometido en esa etapa: costo + IVA y envío de los
        requerimientos que ya lo tienen cargado.
      </p>
    </div>
  );
}
