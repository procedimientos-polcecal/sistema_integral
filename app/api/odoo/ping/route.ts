import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/core/route-utils";
import {
  agrupar,
  autenticar,
  buscarLeer,
  camposDe,
  contar,
  credencialesQueFaltan,
  hayCredencialesOdoo,
  llamar,
  versionDeOdoo,
} from "@/lib/odoo/client";

/**
 * Diagnóstico de la conexión con Odoo. Se abre en el navegador estando logueado
 * como admin: GET /api/odoo/ping
 *
 * No sincroniza nada ni escribe una sola línea en Odoo. Sirve para contestar,
 * antes de diseñar la sincronización, las tres preguntas que hoy no sabemos:
 *
 * 1. ¿Las credenciales del usuario bot funcionan?
 * 2. ¿Qué **permisos** tiene ese usuario? En Odoo un permiso faltante no se ve
 *    en ningún lado hasta que la llamada vuelve rechazada.
 * 3. ¿Los modelos que nos importan tienen los datos que suponemos, con los
 *    nombres de campo que suponemos?
 *
 * Cada sonda va en su propio try: el valor de esto es justamente el mapa de qué
 * anda y qué no. Si una excepción cortara todo, el primer permiso faltante
 * taparía las diez respuestas que vienen después.
 */

export const maxDuration = 60;

interface Sonda {
  nombre: string;
  modelo: string;
  ok: boolean;
  detalle?: unknown;
  error?: string;
}

async function sonda(
  nombre: string,
  modelo: string,
  fn: () => Promise<unknown>
): Promise<Sonda> {
  const arranque = Date.now();
  try {
    return { nombre, modelo, ok: true, detalle: await fn() };
  } catch (e) {
    return {
      nombre,
      modelo,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      detalle: { ms: Date.now() - arranque },
    };
  }
}

export async function GET() {
  const supabase = await createClient();
  const noAutorizado = await es_admin_check(supabase);
  if (noAutorizado) return noAutorizado;

  if (!hayCredencialesOdoo()) {
    return NextResponse.json(
      {
        error: `Faltan variables de entorno de Odoo: ${credencialesQueFaltan().join(", ")}`,
        comoSeArregla:
          "Cargarlas en .env.local (y en Vercel, cuando pase de spike). La API key se genera en Odoo: " +
          "perfil del usuario → Seguridad de la cuenta → API Keys.",
      },
      { status: 503 }
    );
  }

  /*
   * La versión primero y aparte: no necesita credenciales, sólo la URL. Si esto
   * contesta y todo lo demás falla, el problema es la API key y no la red.
   */
  let version: unknown;
  try {
    version = await versionDeOdoo();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), etapa: "version" },
      { status: 502 }
    );
  }

  const sondas: Sonda[] = [];

  // ── Quién soy y dónde estoy ────────────────────────────────
  sondas.push(
    await sonda("usuario de integración", "res.users", async () => {
      const uid = await autenticar();
      const [yo] = await llamar<{ id: number; name: string; login: string; company_id: unknown }[]>(
        "res.users",
        "read",
        [[uid], ["name", "login", "company_id"]]
      );
      return { uid, ...yo };
    })
  );

  sondas.push(
    await sonda("empresas visibles", "res.company", () =>
      buscarLeer("res.company", [], ["name", "currency_id"], { limite: 20 })
    )
  );

  // ── Compras: el módulo que va a ser bidireccional ──────────
  sondas.push(
    await sonda("órdenes de compra", "purchase.order", async () => ({
      total: await contar("purchase.order"),
      ultimas: await buscarLeer(
        "purchase.order",
        [],
        ["name", "partner_id", "date_order", "amount_total", "state", "invoice_status"],
        { limite: 5, orden: "date_order desc" }
      ),
    }))
  );

  sondas.push(
    await sonda("proveedores", "res.partner", async () => ({
      total: await contar("res.partner", [["supplier_rank", ">", 0]]),
      muestra: await buscarLeer(
        "res.partner",
        [["supplier_rank", ">", 0]],
        ["name", "vat", "email", "phone"],
        { limite: 5, orden: "name asc" }
      ),
    }))
  );

  // ── Contabilidad y Tesorería: sólo lectura, por decisión ───
  sondas.push(
    await sonda("diarios de tesorería", "account.journal", () =>
      buscarLeer(
        "account.journal",
        [["type", "in", ["bank", "cash"]]],
        ["name", "code", "type", "currency_id", "company_id"],
        { limite: 20, orden: "type asc, name asc" }
      )
    )
  );

  sondas.push(
    await sonda("facturas de proveedor", "account.move", async () => ({
      total: await contar("account.move", [["move_type", "=", "in_invoice"]]),
      ultimas: await buscarLeer(
        "account.move",
        [["move_type", "=", "in_invoice"]],
        ["name", "partner_id", "invoice_date", "amount_total", "state", "payment_state"],
        { limite: 5, orden: "invoice_date desc" }
      ),
    }))
  );

  sondas.push(
    await sonda("pagos", "account.payment", async () => ({
      total: await contar("account.payment"),
      ultimos: await buscarLeer(
        "account.payment",
        [],
        ["display_name", "date", "amount", "payment_type", "partner_id", "journal_id", "state"],
        { limite: 5, orden: "date desc" }
      ),
    }))
  );

  /*
   * La sonda más importante de todas: los saldos por diario, sumados por Odoo.
   *
   * Es la prueba de que Tesorería se puede mostrar en el SdG sin traerse los
   * apuntes uno por uno. `parent_state = posted` deja afuera los borradores, que
   * es exactamente lo que hace la vista de contabilidad de Odoo.
   */
  sondas.push(
    await sonda("saldos por diario (read_group)", "account.move.line", () =>
      agrupar(
        "account.move.line",
        [
          ["journal_id.type", "in", ["bank", "cash"]],
          ["parent_state", "=", "posted"],
        ],
        ["balance:sum"],
        ["journal_id"],
        { limite: 20 }
      )
    )
  );

  /*
   * El esquema real de purchase.order, no el que suponemos.
   *
   * Sólo los nombres: el detalle completo son cientos de líneas. Alcanza para
   * saber si esta base tiene campos propios (los `x_`) y si la localización
   * argentina agregó los suyos, antes de escribir el primer mapeo.
   */
  sondas.push(
    await sonda("campos de purchase.order", "purchase.order", async () => {
      const campos = await camposDe("purchase.order");
      const nombres = Object.keys(campos);
      return {
        cantidad: nombres.length,
        propios: nombres.filter((n) => n.startsWith("x_")),
        deLocalizacion: nombres.filter((n) => n.startsWith("l10n_")),
      };
    })
  );

  const fallaron = sondas.filter((s) => !s.ok);

  return NextResponse.json({
    version,
    resumen: {
      sondas: sondas.length,
      ok: sondas.length - fallaron.length,
      fallaron: fallaron.length,
      // Los permisos se dan por modelo, así que la lista de fallas es la lista
      // de grupos que hay que revisarle al usuario bot en Odoo.
      revisarPermisosDe: fallaron.map((s) => s.modelo),
    },
    sondas,
  });
}
