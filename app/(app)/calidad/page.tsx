import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import {
  saldoCorrido,
  traerBandeja,
  traerCarbonilleros,
  traerElStock,
} from "@/lib/calidad/consultas";
import StockClient from "./StockClient";

/**
 * El stock de carbonilla: los dos saldos, el consumo del día y el libro reciente.
 *
 * Es la pantalla que se abre a la tarde para cargar lo que se quemó, que es lo
 * que se hace **224 de 256 días**. Todo lo demás está, pero más chico.
 *
 * El saldo corrido se calcula acá y no en el cliente: es una pasada sobre el
 * libro entero, y el libro arranca con veinte meses importados.
 *
 * Spec: docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md
 */
export default async function CalidadPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [stock, bandeja, carbonilleros, sync] = await Promise.all([
    traerElStock(supabase),
    traerBandeja(supabase),
    traerCarbonilleros(supabase),
    ultimaSincronizacionDe(supabase, "calidad", "carbonilla-odoo"),
  ]);

  const libro = saldoCorrido(stock.movimientos).slice(-60).reverse();

  return (
    <StockClient
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      saldos={stock.saldos}
      ultimaFecha={stock.ultimaFecha}
      ultimoConsumo={stock.ultimoConsumo}
      libro={libro.map((f) => ({
        id: f.movimiento.id,
        fecha: f.fecha,
        tipo: f.movimiento.tipo,
        carbon: f.movimiento.carbon,
        toneladas: Number(f.movimiento.toneladas),
        motivo: f.movimiento.motivo,
        origen: f.movimiento.origen,
        orden: f.movimiento.odoo_purchase_name,
        carbonillero_id: f.movimiento.carbonillero_id,
        sheets_pendiente: f.movimiento.sheets_pendiente,
        saldoVegetal: f.saldoVegetal,
        saldoResidual: f.saldoResidual,
        saldoTotal: f.saldoTotal,
      }))}
      carbonilleros={carbonilleros
        .filter((c) => c.activo)
        .map((c) => ({ id: c.id, nombre: c.nombre_planilla, carbon: c.carbon }))}
      bandeja={bandeja}
      sync={sync}
    />
  );
}
