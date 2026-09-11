import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarLeer, idDeRelacion, llamar } from "./client";
import { traerTodo } from "@/lib/core/paginado";
import { normalizarCuit } from "@/lib/core/cuit";
import {
  conciliar,
  estadoSegunOdoo,
  numerosDeLaReferencia,
  type FacturaParaConciliar,
  type MovimientoDeOdoo,
} from "@/lib/facturacion/conciliacion";

/**
 * Averiguar cuáles facturas del buzón ya están cargadas en Odoo.
 *
 * Es la etapa 3 del spec: hasta ahora el estado `contabilizada` lo ponía una
 * persona apretando **Ya está en Odoo**, y el sistema le creía. Un estado que
 * nadie verifica envejece mal —alguien se olvida de apretarlo, o lo aprieta
 * antes de cargarla— y entonces el buzón deja de servir para saber qué falta.
 *
 * Hace dos cosas distintas, y conviene no mezclarlas:
 *
 * 1. **Refrescar las que ya tienen vínculo.** Casi siempre son las que empujó el
 *    propio SdG: nacen en borrador y pasan a `contabilizada` cuando contabilidad
 *    las postea. Acá no hay nada que adivinar, es leer un estado.
 * 2. **Reconocer las que cargó administración a mano**, cruzando el número del
 *    comprobante con la referencia de Odoo. Las reglas y por qué no alcanza con
 *    el importe están en `lib/facturacion/conciliacion.ts`.
 *
 * Todo lo que no se puede afirmar queda sin tocar y se informa. La conciliación
 * es el lugar donde un enlace equivocado se nota menos que en ningún otro: la
 * factura aparecería como contabilizada y nadie volvería a mirarla.
 */

const TIPOS = ["in_invoice", "in_refund"];

/** Cuánto se mira hacia atrás de la factura más vieja que falta conciliar. */
const DIAS_DE_MARGEN = 30;

export interface ResumenDeLaSincronizacion {
  /** Facturas del buzón que ya tenían vínculo y se releyeron. */
  revisadas: number;
  /** Pasaron a `contabilizada` porque Odoo las posteó. */
  contabilizadas: number;
  /** Encontradas en Odoo por el número del comprobante. */
  vinculadas: number;
  /** Empataron con más de una factura de Odoo: no se tocan. */
  ambiguas: number;
  /** El borrador quedó cancelado, o ya no existe. */
  problemas: string[];
}

interface FilaPendiente {
  id: string;
  cuit_emisor: string | null;
  punto_venta: number | null;
  numero: number | null;
  importe_total: number | null;
  fecha: string | null;
  estado: string;
  odoo_move_id: number | null;
  empresa_id: string | null;
}

/*
 * La empresa se resuelve con un mapa aparte y no con un embed. No es capricho:
 * `facturas_proveedor` tiene tres FK y los embeds hay que nombrarlos a mano, y
 * además son dos empresas — traerlas una vez y buscar en un `Map` es menos
 * código que pelearse con el tipo del embed.
 */
const SELECT =
  "id, cuit_emisor, punto_venta, numero, importe_total, fecha, estado, odoo_move_id, empresa_id";

function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

export async function sincronizarFacturasConOdoo(
  admin: SupabaseClient
): Promise<ResumenDeLaSincronizacion> {
  const resumen: ResumenDeLaSincronizacion = {
    revisadas: 0,
    contabilizadas: 0,
    vinculadas: 0,
    ambiguas: 0,
    problemas: [],
  };

  /*
   * Todo lo que todavía no cerró. `traerTodo` y no `.limit()`: PostgREST corta
   * en 1000 filas sin avisar, y con 19 facturas por día el buzón pasa esa marca
   * en dos meses.
   */
  const abiertas = await traerTodo<FilaPendiente>((desde, hasta) =>
    admin
      .from("facturas_proveedor")
      .select(SELECT)
      .neq("estado", "contabilizada")
      .order("created_at", { ascending: true })
      .range(desde, hasta)
  );

  const { data: empresas } = await admin.from("empresas").select("id, odoo_company_id");
  const empresaOdooPorId = new Map<string, number | null>(
    (empresas ?? []).map((e) => [e.id as string, (e.odoo_company_id ?? null) as number | null])
  );

  await refrescarLasQueYaTienenVinculo(admin, abiertas, resumen);
  await buscarLasQueFaltan(admin, abiertas, empresaOdooPorId, resumen);

  return resumen;
}

/**
 * Releer en Odoo las facturas que ya tienen `odoo_move_id`.
 *
 * Es el caso barato y el que cierra el círculo del push: el borrador que creó el
 * SdG pasa a `contabilizada` el día que contabilidad lo postea, sin que nadie
 * toque un botón.
 */
async function refrescarLasQueYaTienenVinculo(
  admin: SupabaseClient,
  abiertas: FilaPendiente[],
  resumen: ResumenDeLaSincronizacion
): Promise<void> {
  const conVinculo = abiertas.filter((f) => f.odoo_move_id);
  if (!conVinculo.length) return;

  const ids = [...new Set(conVinculo.map((f) => f.odoo_move_id!))];
  const movimientos = await llamar<{ id: number; name: string | null; state: string }[]>(
    "account.move",
    "read",
    [ids, ["name", "state"]]
  );

  const porId = new Map(movimientos.map((m) => [m.id, m]));
  const ahora = new Date().toISOString();

  for (const factura of conVinculo) {
    resumen.revisadas++;
    const movimiento = porId.get(factura.odoo_move_id!);

    /*
     * Que el asiento ya no esté no es un detalle: significa que el borrador se
     * borró en Odoo. Se suelta el vínculo —si no, la factura queda para siempre
     * apuntando a un id que no existe y el botón de empujar sigue bloqueado— y
     * se deja dicho por qué.
     */
    if (!movimiento) {
      resumen.problemas.push(
        `La factura ${factura.id} apuntaba al asiento ${factura.odoo_move_id} de Odoo, que ya no existe.`
      );
      await admin
        .from("facturas_proveedor")
        .update({
          odoo_move_id: null,
          odoo_nombre: null,
          odoo_estado: null,
          odoo_conciliado_por: null,
          odoo_pendiente:
            "El asiento que tenía en Odoo ya no existe: lo borraron. Se puede volver a crear el borrador.",
          odoo_sincronizado_en: ahora,
        })
        .eq("id", factura.id);
      continue;
    }

    const cambios: Record<string, unknown> = {
      odoo_nombre: movimiento.name,
      odoo_estado: movimiento.state,
      odoo_sincronizado_en: ahora,
    };

    if (movimiento.state === "cancel") {
      cambios.odoo_pendiente =
        "El borrador quedó cancelado en Odoo, así que esta factura no está contabilizada.";
      resumen.problemas.push(
        `El asiento ${movimiento.name ?? movimiento.id} está cancelado en Odoo.`
      );
    } else {
      cambios.odoo_pendiente = null;
      const estado = estadoSegunOdoo(movimiento.state);
      if (estado && estado !== factura.estado) {
        cambios.estado = estado;
        if (estado === "contabilizada") resumen.contabilizadas++;
      }
    }

    await admin.from("facturas_proveedor").update(cambios).eq("id", factura.id);
  }
}

/**
 * Buscar en Odoo las facturas que cargó administración por su cuenta.
 *
 * El pull se acota por proveedor y por fecha en vez de traerse el diario entero:
 * los partners salen del CUIT del emisor —el mismo criterio que todo el resto
 * del sistema, nunca por nombre— y la ventana arranca un mes antes de la factura
 * más vieja que falta conciliar, porque una factura de Odoo que agrupa varios
 * comprobantes lleva la fecha del más nuevo.
 */
async function buscarLasQueFaltan(
  admin: SupabaseClient,
  abiertas: FilaPendiente[],
  empresaOdooPorId: Map<string, number | null>,
  resumen: ResumenDeLaSincronizacion
): Promise<void> {
  const sinVinculo = abiertas.filter(
    (f) => !f.odoo_move_id && f.cuit_emisor && f.punto_venta !== null && f.numero !== null
  );
  if (!sinVinculo.length) return;

  const cuits = [...new Set(sinVinculo.map((f) => normalizarCuit(f.cuit_emisor)!).filter(Boolean))];
  if (!cuits.length) return;

  const partners = await buscarLeer<{ id: number; vat: string | false }>(
    "res.partner",
    [["vat", "in", cuits]],
    ["vat"],
    { limite: 2000 }
  );
  if (!partners.length) return;

  const vatPorPartner = new Map(partners.map((p) => [p.id, p.vat || null]));

  const fechas = sinVinculo.map((f) => f.fecha).filter((f): f is string => !!f);
  const desde = fechas.length
    ? restarDias(fechas.sort()[0], DIAS_DE_MARGEN)
    : restarDias(new Date().toISOString().slice(0, 10), 120);

  const crudos = await buscarLeer<{
    id: number;
    ref: string | false;
    partner_id: unknown;
    company_id: unknown;
    state: string;
    invoice_date: string | false;
    amount_total: number;
    name: string | false;
  }>(
    "account.move",
    [
      ["move_type", "in", TIPOS],
      ["state", "!=", "cancel"],
      ["partner_id", "in", [...vatPorPartner.keys()]],
      ["invoice_date", ">=", desde],
    ],
    ["ref", "partner_id", "company_id", "state", "invoice_date", "amount_total", "name"],
    { limite: 3000, orden: "id desc" }
  );

  const movimientos: MovimientoDeOdoo[] = crudos.map((m) => ({
    id: m.id,
    ref: m.ref || null,
    cuitDelPartner: vatPorPartner.get(idDeRelacion(m.partner_id) ?? -1) ?? null,
    empresaOdoo: idDeRelacion(m.company_id),
    estado: m.state,
    fecha: m.invoice_date || null,
    importeTotal: Number(m.amount_total ?? 0),
    nombre: m.name || null,
  }));

  const paraConciliar: FacturaParaConciliar[] = sinVinculo.map((f) => ({
    id: f.id,
    cuit_emisor: f.cuit_emisor,
    punto_venta: f.punto_venta,
    numero: f.numero,
    importe_total: f.importe_total,
    empresaOdoo: f.empresa_id ? (empresaOdooPorId.get(f.empresa_id) ?? null) : null,
  }));

  const { vinculos, ambiguas } = conciliar(paraConciliar, movimientos);
  const ahora = new Date().toISOString();

  for (const vinculo of vinculos) {
    const estado = estadoSegunOdoo(vinculo.odooEstado);
    await admin
      .from("facturas_proveedor")
      .update({
        odoo_move_id: vinculo.odooMoveId,
        odoo_nombre: vinculo.odooNombre,
        odoo_estado: vinculo.odooEstado,
        odoo_conciliado_por: "numero",
        odoo_pendiente: vinculo.aviso,
        odoo_sincronizado_en: ahora,
        ...(estado ? { estado } : {}),
      })
      .eq("id", vinculo.facturaId);

    resumen.vinculadas++;
    if (estado === "contabilizada") resumen.contabilizadas++;
    if (vinculo.aviso) resumen.problemas.push(vinculo.aviso);
  }

  resumen.ambiguas = ambiguas.length;
  for (const a of ambiguas) {
    resumen.problemas.push(
      `La factura ${a.facturaId} coincide con ${a.candidatos.length} asientos de Odoo (${a.candidatos.join(", ")}): hay que elegir uno a mano.`
    );
  }
}

// ── Buscar a mano, cuando el automático no alcanza ───────────

export interface CandidatoDeOdoo {
  odooMoveId: number;
  nombre: string | null;
  referencia: string | null;
  fecha: string | null;
  importeTotal: number;
  estado: string;
  /** Por qué está en la lista: lo que hace que valga la pena mirarlo. */
  porque: "el número coincide" | "el importe coincide" | "es del mismo proveedor";
}

/**
 * Los candidatos de Odoo para **una** factura del buzón.
 *
 * Existe porque la conciliación automática sólo afirma lo que puede probar, y
 * eso deja afuera a la mayoría: el 76% de las facturas de proveedor de esta
 * instancia no tienen la referencia cargada, así que su número no está escrito
 * en ningún lado y ninguna regla las puede reconocer.
 *
 * Entonces se le sirve el trabajo a la persona en vez de adivinar: las del mismo
 * proveedor, ordenadas por lo que más se parece, para que elija una. Lo que
 * elija queda marcado como `a mano`, que es información distinta de lo que
 * dedujo el sistema.
 */
export async function candidatosEnOdoo(
  admin: SupabaseClient,
  facturaId: string
): Promise<{ candidatos: CandidatoDeOdoo[]; motivo?: string }> {
  const { data } = await admin
    .from("facturas_proveedor")
    .select("cuit_emisor, punto_venta, numero, importe_total, fecha")
    .eq("id", facturaId)
    .maybeSingle();

  if (!data) return { candidatos: [], motivo: "No existe esa factura." };

  const cuit = normalizarCuit(data.cuit_emisor as string | null);
  if (!cuit) {
    return {
      candidatos: [],
      motivo: "La factura no tiene CUIT del emisor, así que no hay por dónde buscarla en Odoo.",
    };
  }

  const partners = await buscarLeer<{ id: number }>("res.partner", [["vat", "=", cuit]], ["vat"], {
    limite: 20,
  });
  if (!partners.length) {
    return { candidatos: [], motivo: `Ningún proveedor de Odoo tiene el CUIT ${cuit}.` };
  }

  const fecha = (data.fecha as string | null) ?? new Date().toISOString().slice(0, 10);
  const crudos = await buscarLeer<{
    id: number;
    name: string | false;
    ref: string | false;
    invoice_date: string | false;
    amount_total: number;
    state: string;
  }>(
    "account.move",
    [
      ["move_type", "in", TIPOS],
      ["state", "!=", "cancel"],
      ["partner_id", "in", partners.map((p) => p.id)],
      ["invoice_date", ">=", restarDias(fecha, 120)],
    ],
    ["name", "ref", "invoice_date", "amount_total", "state"],
    { limite: 60, orden: "invoice_date desc, id desc" }
  );

  const importe = Math.abs(Number(data.importe_total ?? 0));
  const puntoVenta = data.punto_venta as number | null;
  const numero = data.numero as number | null;

  const candidatos = crudos.map((m): CandidatoDeOdoo => {
    const numeros = numerosDeLaReferencia(m.ref || null);
    const porNumero =
      puntoVenta !== null &&
      numero !== null &&
      numeros.some((n) => n.puntoVenta === puntoVenta && n.numero === numero);

    return {
      odooMoveId: m.id,
      nombre: m.name || null,
      referencia: m.ref || null,
      fecha: m.invoice_date || null,
      importeTotal: Number(m.amount_total ?? 0),
      estado: m.state,
      porque: porNumero
        ? "el número coincide"
        : importe && Math.abs(Math.abs(Number(m.amount_total ?? 0)) - importe) <= 0.01
          ? "el importe coincide"
          : "es del mismo proveedor",
    };
  });

  const peso = { "el número coincide": 0, "el importe coincide": 1, "es del mismo proveedor": 2 };
  candidatos.sort((a, b) => peso[a.porque] - peso[b.porque]);

  return { candidatos };
}
