import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/core/route-utils";
import {
  agrupar,
  buscarLeer,
  camposDe,
  contar,
  contarPorEmpresa,
  credencialesQueFaltan,
  empresasDeOdoo,
  hayCredencialesOdoo,
  idDeRelacion,
  iniciarSesion,
  llamar,
  versionDeOdoo,
} from "@/lib/odoo/client";

/**
 * Diagnóstico de la conexión con Odoo. Se abre en el navegador estando logueado
 * como admin: GET /api/odoo/ping
 *
 * No sincroniza nada ni escribe una sola línea en Odoo. Sirve para contestar,
 * antes de diseñar la sincronización, las cuatro preguntas que hoy no sabemos:
 *
 * 1. ¿Las credenciales del usuario bot funcionan?
 * 2. ¿Ve **las dos empresas**? Odoo lleva POLCECAL y POLYSAN por separado, y si
 *    el bot tiene una sola habilitada devuelve medio grupo sin decir nada.
 * 3. ¿Qué **permisos** tiene? En Odoo un permiso faltante no se ve en ningún
 *    lado hasta que la llamada vuelve rechazada.
 * 4. ¿Los modelos que nos importan tienen los datos que suponemos, con los
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

async function sonda(nombre: string, modelo: string, fn: () => Promise<unknown>): Promise<Sonda> {
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
  const alertas: string[] = [];

  // ── Quién soy y qué empresas veo ───────────────────────────
  sondas.push(
    await sonda("usuario de integración", "res.users", async () => {
      const sesion = await iniciarSesion();
      const [yo] = await llamar<{ id: number; name: string; login: string }[]>(
        "res.users",
        "read",
        [[sesion.uid], ["name", "login"]]
      );

      /*
       * Dos empresas es el número esperado. Una sola no es un error de Odoo: es
       * la integración mirando la mitad del grupo, y no se nota en ningún lado.
       */
      if (sesion.empresas.length < 2) {
        alertas.push(
          `El usuario bot tiene ${sesion.empresas.length} empresa(s) habilitada(s), y el grupo son dos ` +
            `(POLCECAL y POLYSAN). Así, las lecturas devuelven sólo una parte sin avisar. ` +
            `Se arregla en Odoo: Ajustes → Usuarios → el usuario → Empresas permitidas.`
        );
      }

      return { ...sesion, ...yo };
    })
  );

  sondas.push(
    await sonda("empresas de Odoo", "res.company", async () => {
      const empresas = await empresasDeOdoo();
      // El mapeo con la tabla `empresas` del núcleo se hace por nombre, así que
      // lo que importa es cómo están escritas exactamente del lado de Odoo.
      return empresas.map((e) => ({ id: e.id, nombre: e.name, moneda: e.currency_id }));
    })
  );

  // ── Compras: el módulo que va a ser bidireccional ──────────
  sondas.push(
    await sonda("órdenes de compra", "purchase.order", async () => ({
      total: await contar("purchase.order"),
      porEmpresa: await contarPorEmpresa("purchase.order"),
      ultimas: await buscarLeer(
        "purchase.order",
        [],
        ["name", "company_id", "partner_id", "date_order", "amount_total", "state", "invoice_status"],
        { limite: 5, orden: "date_order desc" }
      ),
    }))
  );

  /*
   * Los proveedores son el único dato que puede ser de las dos.
   *
   * En Odoo, un `res.partner` con `company_id` vacío es compartido por todas las
   * empresas; con empresa puesta, es exclusivo de esa. Saber cuántos hay de cada
   * tipo decide si el padrón de proveedores del SdG se sincroniza una vez o dos.
   */
  sondas.push(
    await sonda("proveedores", "res.partner", async () => {
      const esProveedor = [["supplier_rank", ">", 0]];
      return {
        total: await contar("res.partner", esProveedor),
        compartidos: await contar("res.partner", [...esProveedor, ["company_id", "=", false]]),
        porEmpresa: await contarPorEmpresa("res.partner", esProveedor),
        muestra: await buscarLeer(
          "res.partner",
          esProveedor,
          ["name", "vat", "email", "phone", "company_id"],
          { limite: 5, orden: "name asc" }
        ),
      };
    })
  );

  // ── Contabilidad y Tesorería: sólo lectura, por decisión ───
  sondas.push(
    await sonda("diarios de tesorería", "account.journal", () =>
      buscarLeer(
        "account.journal",
        [["type", "in", ["bank", "cash"]]],
        ["name", "code", "type", "currency_id", "company_id"],
        { limite: 40, orden: "company_id asc, type asc, name asc" }
      )
    )
  );

  sondas.push(
    await sonda("facturas de proveedor", "account.move", async () => ({
      total: await contar("account.move", [["move_type", "=", "in_invoice"]]),
      porEmpresa: await contarPorEmpresa("account.move", [["move_type", "=", "in_invoice"]]),
      ultimas: await buscarLeer(
        "account.move",
        [["move_type", "=", "in_invoice"]],
        [
          "name",
          "company_id",
          "partner_id",
          "invoice_date",
          "amount_total",
          "state",
          "payment_state",
        ],
        { limite: 5, orden: "invoice_date desc" }
      ),
    }))
  );

  sondas.push(
    await sonda("pagos", "account.payment", async () => ({
      total: await contar("account.payment"),
      porEmpresa: await contarPorEmpresa("account.payment"),
      ultimos: await buscarLeer(
        "account.payment",
        [],
        [
          "display_name",
          "company_id",
          "date",
          "amount",
          "payment_type",
          "partner_id",
          "journal_id",
          "state",
        ],
        { limite: 5, orden: "date desc" }
      ),
    }))
  );

  /*
   * La sonda más importante de todas: los saldos de tesorería, sumados por Odoo.
   *
   * Es la prueba de que Tesorería se puede mostrar en el SdG sin traerse los
   * apuntes uno por uno. `parent_state = posted` deja afuera los borradores, que
   * es exactamente lo que hace la vista de contabilidad de Odoo.
   *
   * Ojo con lo que parece obvio y está mal: agrupar por **diario** da cero en
   * todos. Un asiento incluye su contrapartida, así que la suma de todos los
   * apuntes de un diario es cero por partida doble. El saldo son los apuntes de
   * la **cuenta** del diario (`default_account_id`), no los del diario. Se probó
   * contra la base real: por diario daba 0,00 en los 16, y por cuenta da los
   * saldos de verdad.
   *
   * Y agrupa por empresa porque un saldo del grupo, sumado de las dos, no
   * significa nada: son dos patrimonios distintos.
   */
  sondas.push(
    await sonda("saldos de tesorería (read_group)", "account.move.line", async () => {
      const diarios = await buscarLeer<{ id: number; default_account_id: unknown }>(
        "account.journal",
        [["type", "in", ["bank", "cash"]]],
        ["name", "default_account_id", "company_id"],
        { limite: 40 }
      );

      const cuentas = diarios
        .map((d) => idDeRelacion(d.default_account_id))
        .filter((id): id is number => id !== null);

      if (!cuentas.length) return { sinCuentas: true, diarios: diarios.length };

      return agrupar(
        "account.move.line",
        [
          ["account_id", "in", cuentas],
          ["parent_state", "=", "posted"],
        ],
        ["balance:sum"],
        ["company_id", "account_id"],
        { limite: 60 }
      );
    })
  );

  /*
   * El esquema real, no el que suponemos.
   *
   * `analytic_distribution` es lo que decide si el reparto de un gasto entre las
   * dos empresas se puede expresar en Odoo sin duplicar el documento: es un JSON
   * de porcentajes por cuenta analítica. Si el campo no está, esa opción se cae
   * y hay que resolverlo con dos órdenes.
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
    alertas,
    sondas,
  });
}
