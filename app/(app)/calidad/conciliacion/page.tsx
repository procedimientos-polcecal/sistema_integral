import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { avisoDeCredencialesFaltantes, hayCredencialesOdoo } from "@/lib/odoo/client";
import { controlarContraOdoo } from "@/lib/calidad/sincronizar";
import { traerCarbonilleros } from "@/lib/calidad/consultas";
import ConciliacionClient from "./ConciliacionClient";

/**
 * El libro contra Odoo: qué camión entró sin orden de compra.
 *
 * **Es una vista, no un estado**: se calcula al abrir y no se guarda. Un
 * derivado guardado se desincroniza y nada avisa, que es la misma regla que
 * este módulo ya tiene escrita para los saldos.
 *
 * Esto era, hasta el 13/10/2026, el cron que creaba movimientos desde Odoo.
 * Ahora manda la planilla sobre el libro y Odoo quedó acá, controlando: es el
 * único lugar que dice que un camión entró sin orden, que es plata que después
 * no se puede facturar.
 *
 * **Si Odoo no contesta se dice con lo que dijo Odoo, sin traducir.** Tres
 * listas vacías se ven exactamente igual que "está todo bien", y ésa es la
 * diferencia entre un tablero y un adorno.
 *
 * Spec: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
 */
export default async function ConciliacionPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  if (!hayCredencialesOdoo()) {
    return <ConciliacionClient error={avisoDeCredencialesFaltantes()} />;
  }

  let control;
  try {
    control = await controlarContraOdoo(supabase);
  } catch (e) {
    return <ConciliacionClient error={e instanceof Error ? e.message : String(e)} />;
  }

  // `sinOrden` trae el partner de Odoo y no el nombre: el nombre vive en el
  // catálogo de carbonilleros, que es de donde se saca para mostrarlo.
  const carbonilleros = await traerCarbonilleros(supabase);
  const nombreDelPartner = new Map(
    carbonilleros.map((c) => [c.odoo_partner_id, c.nombre_planilla])
  );

  return (
    <ConciliacionClient
      leidas={control.leidas}
      sinOrden={control.sinOrden.map((c) => ({
        id: c.id,
        fecha: c.fecha,
        // NO SE INVENTA: si el partner no está en el catálogo se dice el número
        // de Odoo, que es con lo que se lo puede buscar allá.
        quien: nombreDelPartner.get(c.odooPartnerId) ?? `Partner ${c.odooPartnerId} de Odoo`,
        toneladas: c.toneladas,
      }))}
      sinCamion={control.sinCamion.map((l) => ({
        ordenNombre: l.ordenNombre,
        fecha: l.fecha,
        quien: l.partnerNombre,
        cantidad: l.cantidad,
      }))}
      cantidadDistinta={control.cantidadDistinta}
    />
  );
}
