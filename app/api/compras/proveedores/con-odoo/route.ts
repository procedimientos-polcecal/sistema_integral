import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { traerTodo } from "@/lib/core/paginado";
import { normalizarCuit } from "@/lib/core/cuit";
import {
  validarAlta, parecidosEnElPadron, empresasDelRequerimiento,
  type ProveedorDelPadron,
} from "@/lib/compras/altaDeProveedor";
import { buscarCandidatos } from "@/lib/odoo/partnerDeProveedor";
import { elegirPartnerDelEmisor } from "@/lib/odoo/proveedores";
import {
  hayCredencialesOdoo, avisoDeCredencialesFaltantes, mensajeDeOdoo,
} from "@/lib/odoo/client";

/**
 * Dar de alta un proveedor desde la carga de un presupuesto.
 * `POST /api/compras/proveedores/con-odoo`
 *
 * Es el alta de `/compras/proveedores` más dos cosas: **el CUIT es
 * obligatorio** y, con él, se busca el proveedor en Odoo y se lo **enlaza si
 * ya está**. El `res.partner` nuevo **no se crea acá**: se crea al generar la
 * orden de compra, que es cuando hay una compra de verdad detrás y la empresa
 * ya está decidida.
 *
 * La ruta de siempre (`POST /api/compras/proveedores`) **no se toca** y sigue
 * aceptando altas sin CUIT: la usa la pantalla de administración, donde también
 * se cargan contratistas que nunca van a tener una orden en Odoo.
 *
 * ## Por qué esto escribe `proveedores_odoo`, que es una tabla de `admin`
 *
 * La policy de esa tabla es `es_admin()` y la única ruta que la escribía
 * (`/api/odoo/proveedores/enlazar`) está cerrada con `es_admin_check`. Acá
 * entra alguien con `edicion` en Compras, y el comentario de la migración
 * `20260903091434` dice qué pasa si un enlace está mal: **la orden de compra
 * le llega a otro proveedor**.
 *
 * Se acepta porque lo que se habilita no es «enlazar», es «enlazar cuando el
 * CUIT no deja lugar a dudas». El enlace no se elige a mano: se **deriva** del
 * CUIT que la persona tipeó, y lo acotan tres frenos —que el CUIT no esté ya
 * en el padrón, que `elegirPartnerDelEmisor` no se niegue por empate, y que
 * ese partner no sea ya de otro proveedor del SdG—. Si alguno no se cumple, no
 * se enlaza y se informa.
 *
 * ## Qué pasa si Odoo no está
 *
 * El proveedor **se da de alta igual**. Un Odoo caído no puede impedir cargar
 * un presupuesto, que es trabajo del SdG y de nadie más. El enlace queda
 * pendiente y lo resuelve después la generación de la orden o el cruce masivo.
 */

export const maxDuration = 60;

/** Los campos del alta que van tal cual a la tabla. */
const CAMPOS_OPCIONALES = [
  "rubro", "contacto", "telefono", "email", "notas",
  "es_contratista", "plazo_pago_dias", "condicion_pago", "forma_pago",
] as const;

interface Enlace {
  empresa: string;
  partnerId: number;
}

interface SinEnlazar {
  empresa: string;
  motivo: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json(
      { error: "No tenés permiso para dar de alta un proveedor" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const nombre = String(body?.nombre ?? "").trim();
  const cuit = String(body?.cuit ?? "").trim();
  const requerimientoId = String(body?.requerimiento_id ?? "").trim();

  const admin = createAdminClient();

  const padron = await traerTodo<ProveedorDelPadron>((desde, hasta) =>
    admin.from("proveedores").select("id, nombre, cuit").range(desde, hasta)
  );

  const problemas = validarAlta({ nombre, cuit }, padron);
  if (problemas.length) return NextResponse.json({ problemas }, { status: 400 });

  /*
   * El nombre parecido avisa, no frena — pero avisar después de crear no sirve
   * de nada. Así que la primera vez contesta 409 con los parecidos y la
   * pantalla pregunta; con `confirmar_parecidos` entra igual. Es el mismo
   * gesto que `confirmar_duplicados` en el cuaderno de un contratista.
   */
  const parecidos = parecidosEnElPadron(nombre, padron);
  if (parecidos.length && !body?.confirmar_parecidos) {
    return NextResponse.json({ parecidos }, { status: 409 });
  }

  const registro: Record<string, unknown> = { nombre, cuit };
  for (const campo of CAMPOS_OPCIONALES) {
    if (body && campo in body) registro[campo] = body[campo];
  }

  const { data: proveedor, error } = await admin
    .from("proveedores").insert(registro).select("*").single();

  if (error) {
    const mensaje = error.code === "23505"
      ? "Ya existe un proveedor con ese nombre"
      : error.message;
    return NextResponse.json({ problemas: [{ campo: "nombre", mensaje }] }, { status: 400 });
  }

  if (!hayCredencialesOdoo()) {
    return NextResponse.json(
      { proveedor, enlaces: [], sinEnlazar: [], avisoDeOdoo: avisoDeCredencialesFaltantes() },
      { status: 201 }
    );
  }

  // Desde acá el proveedor YA está creado: nada de lo que siga puede tirar el
  // alta abajo. Lo que falle se cuenta en `avisoDeOdoo` y se sigue.
  const enlaces: Enlace[] = [];
  const sinEnlazar: SinEnlazar[] = [];
  let avisoDeOdoo: string | null = null;
  let razonSocial: string | null = null;

  try {
    const [{ data: ri }, { data: empresas }] = await Promise.all([
      admin
        .from("compras_requerimientos")
        .select("empresa_id, paga_ambas")
        .eq("id", requerimientoId)
        .maybeSingle(),
      admin.from("empresas").select("id, nombre, odoo_company_id"),
    ]);

    const destino = ri
      ? empresasDelRequerimiento(ri, empresas ?? [])
      : // Sin requerimiento no hay empresa que mande, así que se mira en las
        // dos: enlazar de más no es un riesgo, el partner ya existe allá.
        empresasDelRequerimiento({ empresa_id: null, paga_ambas: true }, empresas ?? []);

    const nombrePorId = new Map((empresas ?? []).map((e) => [e.id as string, e.nombre as string]));

    if (!destino.length) {
      avisoDeOdoo =
        "El pedido no dice qué empresa paga, así que no se pudo buscar el proveedor en Odoo.";
    } else {
      const candidatos = await buscarCandidatos(cuit);
      const nombresEnOdoo = new Set<string>();

      for (const empresa of destino) {
        const nombreEmpresa = nombrePorId.get(empresa.id) ?? empresa.id;
        const eleccion = elegirPartnerDelEmisor(candidatos, empresa.odooCompanyId);

        if (!eleccion.partner) {
          sinEnlazar.push({ empresa: nombreEmpresa, motivo: eleccion.motivo });
          continue;
        }

        const { error: errorEnlace } = await admin.from("proveedores_odoo").insert({
          proveedor_id: proveedor.id,
          empresa_id: empresa.id,
          odoo_partner_id: eleccion.partner.id,
          cuit: normalizarCuit(cuit),
        });

        if (errorEnlace) {
          /*
           * 23505 acá es el `unique (empresa_id, odoo_partner_id)`: ese partner
           * de Odoo ya es de otro proveedor del SdG. No es un error que
           * mostrar crudo — es **la señal de que éste es un duplicado del que
           * ya está**, así que se dice de quién es.
           */
          if (errorEnlace.code === "23505") {
            const { data: duenio } = await admin
              .from("proveedores_odoo")
              .select("proveedores(nombre)")
              .eq("empresa_id", empresa.id)
              .eq("odoo_partner_id", eleccion.partner.id)
              .maybeSingle();
            const comoSeLlama =
              (duenio?.proveedores as { nombre?: string } | null)?.nombre ?? "otro proveedor";
            sinEnlazar.push({
              empresa: nombreEmpresa,
              motivo: `Ese proveedor de Odoo ya está enlazado a «${comoSeLlama}»: puede ser el mismo cargado dos veces.`,
            });
          } else {
            sinEnlazar.push({ empresa: nombreEmpresa, motivo: errorEnlace.message });
          }
          continue;
        }

        enlaces.push({ empresa: nombreEmpresa, partnerId: eleccion.partner.id });
        nombresEnOdoo.add(eleccion.partner.nombre);
      }

      /*
       * La razón social sólo si las dos empresas dicen lo mismo. Es el
       * precedente de la migración del 11/11/2026, que midió 31 CUIT con dos
       * nombres distintos en Odoo y los dejó en null a propósito: ese valor
       * termina en un documento formal, y ahí equivocarse es peor que no saber.
       */
      if (nombresEnOdoo.size === 1 && !proveedor.razon_social) {
        razonSocial = [...nombresEnOdoo][0];
        await admin.from("proveedores").update({ razon_social: razonSocial }).eq("id", proveedor.id);
      }
    }
  } catch (e) {
    // Lo que dijo Odoo, sin traducir: un diagnóstico que no se distingue de
    // otro no es un diagnóstico.
    // `as never` es como lo llaman las otras dos puntas: `ErrorDeOdoo` no se
    // exporta, y un Error de JS no es un error de Odoo.
    avisoDeOdoo = e instanceof Error ? e.message : mensajeDeOdoo(e as never);
  }

  return NextResponse.json(
    {
      proveedor: razonSocial ? { ...proveedor, razon_social: razonSocial } : proveedor,
      enlaces,
      sinEnlazar,
      avisoDeOdoo,
    },
    { status: 201 }
  );
}
