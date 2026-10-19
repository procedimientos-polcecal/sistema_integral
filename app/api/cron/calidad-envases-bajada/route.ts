import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revisarElSecreto } from "@/lib/core/cron";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { traerTodo } from "@/lib/core/paginado";
import { protegerPestana } from "@/lib/core/sheets";
import { bajarElKardex, type MovimientoParaBajar } from "@/lib/calidad/envases/bajada";
import { EL_SISTEMA_MANDA_EL_KARDEX } from "@/lib/calidad/envases/sincronizar";

export const maxDuration = 300;

const TAB = () => process.env.GOOGLE_SHEETS_ENVASES_TAB_MOV ?? "Entradas  Salidas";

/**
 * Bajar el kardex de envases a la planilla, y dejarla protegida.
 *
 * Es la cara visible del cambio de dirección acordado el 19/10/2026: acá manda
 * el SdG y la planilla es el lugar donde miran los que no entran al sistema.
 *
 * ── POR QUÉ ESTO NO REEMPLAZA AL ESPEJO ─────────────────────────────────
 *
 * `espejo.ts` sigue escribiendo **cada movimiento en el momento** en que
 * alguien lo carga. Si esto fuera lo único, un movimiento cargado un martes no
 * aparecería en la planilla hasta el lunes siguiente, y la planilla es
 * justamente lo que mira el que no entra al sistema.
 *
 * Esta corrida es la **reconciliación**: reescribe el kardex entero, que es lo
 * único capaz de reflejar una corrección o un borrado —el espejo sólo sabe
 * agregar al final—.
 *
 * ── SE NIEGA SI TODAVÍA MANDA LA PLANILLA ───────────────────────────────
 *
 * Los dos no pueden estar encendidos a la vez: la bajada compacta las filas y
 * la sincronización inserta por `sheets_fila`, así que con las dos vivas una
 * escribiría los datos de una fila sobre la clave de otra. Por eso esto
 * comprueba la misma constante que apaga la importación, en vez de confiar en
 * que los dos deploys salieron juntos.
 *
 * ── LA PROTECCIÓN VA DESPUÉS Y NO ANTES ─────────────────────────────────
 *
 * Es idempotente y barata, así que se vuelve a aplicar en cada corrida: si
 * alguien la saca a mano para corregir algo, la corrida siguiente la repone.
 * Va **después** de escribir y no antes porque es lo que importa menos: una
 * protección que falla deja la planilla editable —molesto—, pero una bajada
 * que no corre deja la planilla desactualizada, que es peor.
 *
 * Que la protección falle **no tira abajo la bajada que sí funcionó**: se
 * informa aparte.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  if (!EL_SISTEMA_MANDA_EL_KARDEX) {
    return NextResponse.json(
      {
        error:
          "En envases todavía manda la planilla. Encender la bajada con la importación viva " +
          "haría que el SdG lea su propia salida: la bajada compacta las filas y la " +
          "importación inserta por sheets_fila. Poner EL_SISTEMA_MANDA_EL_KARDEX en true.",
      },
      { status: 409 }
    );
  }

  const admin = createAdminClient();

  const filas = await traerTodo<Record<string, unknown>>((desde, hasta) =>
    admin
      .from("calidad_envases_movimientos")
      .select(
        "codigo, fecha, entrada, salida, rotura, despacho, observacion, proveedor_raw, sheets_fila, created_at"
      )
      .order("id", { ascending: true })
      .range(desde, hasta)
  );

  const movimientos: MovimientoParaBajar[] = filas.map((m) => ({
    codigo: String(m.codigo ?? ""),
    entrada: Number(m.entrada ?? 0),
    salida: Number(m.salida ?? 0),
    rotura: Number(m.rotura ?? 0),
    despacho: Number(m.despacho ?? 0),
    fecha: (m.fecha as string) ?? null,
    observacion: (m.observacion as string) ?? null,
    proveedor: (m.proveedor_raw as string) ?? null,
    sheets_fila: (m.sheets_fila as number) ?? null,
    created_at: String(m.created_at ?? ""),
  }));

  const bajada = await bajarElKardex(movimientos);

  await registrarSincronizacion({
    modulo: "calidad",
    recurso: "envases_bajada",
    ok: bajada.ok,
    filas: bajada.movimientos,
    error: bajada.error ?? null,
  });

  if (!bajada.ok) return NextResponse.json({ bajada }, { status: 500 });

  let proteccion: unknown;
  try {
    proteccion = await protegerPestana(
      process.env.GOOGLE_SHEETS_ENVASES_ID ?? "",
      TAB(),
      "La escribe el SdG. Ver docs/superpowers/specs/2026-10-19-las-planillas-las-llena-el-sistema-design.md"
    );
  } catch (e) {
    proteccion = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ bajada, proteccion });
}
