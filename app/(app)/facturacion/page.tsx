import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelFacturacionDe } from "@/lib/facturacion/auth";
import { traerCatalogos, traerElBuzon } from "@/lib/facturacion/consultas";
import type { FacturaEnPantalla } from "@/lib/facturacion/types";
import BuzonClient from "./BuzonClient";

/**
 * El buzón de facturas de proveedor.
 *
 * Es la puerta única: entra el archivo —de mail, de papel escaneado o de una
 * foto de WhatsApp— y el sistema lee el QR. De ahí salen el emisor, el número,
 * la fecha, el importe y a cuál de las dos empresas se le facturó, **sin tipear
 * nada**.
 *
 * Entran unas 19 por día (96 en los cinco días entre el 03 y el 08/09/2026), así
 * que la pantalla está armada para **varias a la vez**: se eligen todos los
 * archivos juntos, el navegador los lee mientras la persona mira, y se cargan de
 * una. Una pantalla de una factura por vez habría sido una versión más linda de
 * lo que ya hacen.
 *
 * Lo que este buzón **no** hace: postear en Odoo. La factura la sigue cargando
 * administración. El SdG propone, Odoo confirma.
 */
export default async function FacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelFacturacionDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [{ empresas, proveedores }, filas] = await Promise.all([
    traerCatalogos(supabase),
    traerElBuzon(supabase, { estado: estado ?? null }),
  ]);

  return (
    <BuzonClient
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      empresas={empresas}
      proveedores={proveedores}
      estado={estado ?? null}
      facturas={filas.map(aPantalla)}
    />
  );
}

/**
 * Aplana los embeds.
 *
 * PostgREST devuelve la relación como objeto o como arreglo según cómo esté
 * declarada, así que se aceptan las dos formas — el mismo cuidado que
 * `descripcionDelArticulo` en Compras.
 */
function aPantalla(fila: Record<string, unknown>): FacturaEnPantalla {
  const uno = (embed: unknown) => (Array.isArray(embed) ? embed[0] : embed) as Record<string, unknown> | null;

  const ri = uno(fila.compras_requerimientos);

  return {
    ...(fila as unknown as FacturaEnPantalla),
    empresa: (uno(fila.empresas)?.nombre as string) ?? null,
    proveedor: (uno(fila.proveedores)?.nombre as string) ?? null,
    requerimiento: ri?.nro_ri != null ? String(ri.nro_ri) : null,
  };
}
