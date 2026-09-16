import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { saldoCorrido, traerCarbonilleros, traerMovimientos } from "@/lib/calidad/consultas";
import MovimientosClient from "./MovimientosClient";

/**
 * El libro entero, con filtros. Acá —y sólo acá— se ven los `sin_separar`.
 *
 * El saldo corrido se calcula sobre **todo** el libro y recién después se
 * filtra: el saldo de una fila es lo que había después de ella, y filtrar antes
 * daría un saldo que empieza en cero a mitad de año.
 */
export default async function MovimientosPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [movimientos, carbonilleros] = await Promise.all([
    traerMovimientos(supabase),
    traerCarbonilleros(supabase),
  ]);

  const libro = saldoCorrido(movimientos)
    .reverse()
    .map((f) => ({
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
    }));

  return (
    <MovimientosClient
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      libro={libro}
      carbonilleros={carbonilleros.map((c) => ({ id: c.id, nombre: c.nombre_planilla }))}
    />
  );
}
