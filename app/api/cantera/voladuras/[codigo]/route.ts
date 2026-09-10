import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerConsumos, traerInsumos, traerVoladura } from "@/lib/cantera/consultas";
import { esTipoDeConsumoValido } from "@/lib/cantera/vocabulario";

/**
 * Ver y editar una voladura.
 *
 * `GET` trae la fila, sus renglones de consumo y el catálogo de insumos, que es
 * todo lo que el editor necesita.
 *
 * `PATCH` guarda los campos operativos de las dos etapas —fechas, pozos, malla,
 * precio, TC, observaciones— y **reemplaza** los renglones de consumo por los
 * que vengan. Los campos de conciliación (`*_odoo_*`, `*_conforme*`) NO se
 * tocan acá: los edita finanzas por su propia ruta. Deja rastro de quién y
 * cuándo, igual que Producción y Despacho con las correcciones.
 */

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function fecha(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }

  const voladura = await traerVoladura(supabase, codigo);
  if (!voladura) return NextResponse.json({ error: "Esa voladura no existe" }, { status: 404 });

  const [consumos, insumos] = await Promise.all([
    traerConsumos(supabase, codigo),
    traerInsumos(supabase, true),
  ]);

  return NextResponse.json({ voladura, consumos, insumos });
}

const CAMPOS_FECHA = ["perf_inicio", "perf_fin", "vol_fecha_carga", "vol_fecha"] as const;
const CAMPOS_NUM = [
  "burden_m", "espaciamiento_m", "perf_precio_usd_m", "perf_tc_usd",
  "vol_burden_m", "vol_espaciamiento_m", "vol_tc_usd", "densidad_t_m3", "toneladas_planilla",
] as const;

/** Un `[{pozos, metros}]` limpio, o `null` si no tiene forma. */
function tramos(v: unknown): { pozos: number; metros: number }[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: { pozos: number; metros: number }[] = [];
  for (const t of v) {
    const pozos = Number((t as { pozos?: unknown })?.pozos);
    const metros = Number((t as { metros?: unknown })?.metros);
    if (!Number.isInteger(pozos) || pozos <= 0 || !isFinite(metros) || metros <= 0) return null;
    out.push({ pozos, metros });
  }
  return out;
}

/** La cantidad total de pozos de un arreglo de tramos. */
function totalPozos(tr: { pozos: number }[] | null): number | null {
  return tr ? tr.reduce((s, t) => s + t.pozos, 0) : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar voladuras" }, { status: 403 });
  }

  const voladura = await traerVoladura(supabase, codigo);
  if (!voladura) return NextResponse.json({ error: "Esa voladura no existe" }, { status: 404 });

  const b = await cuerpoJson(request);

  const cambios: Record<string, unknown> = {
    actualizado_por: user.id,
    actualizado_en: new Date().toISOString(),
  };
  for (const c of CAMPOS_FECHA) if (c in b) cambios[c] = fecha(b[c]);
  for (const c of CAMPOS_NUM) if (c in b) cambios[c] = num(b[c]);
  if ("explosivos_raw" in b) cambios.explosivos_raw = texto(b.explosivos_raw);
  if ("observaciones" in b) cambios.observaciones = texto(b.observaciones);
  if ("material" in b) cambios.material = texto(b.material);

  // Los pozos por profundidad. El escalar `pozos` / `metros_por_pozo` se
  // mantiene en sincronía —`pozos` = total, `metros_por_pozo` = null cuando hay
  // tramos, que ya no es un promedio único— para no dejar dos números que digan
  // cosas distintas.
  if ("perf_tramos" in b) {
    const tr = tramos(b.perf_tramos);
    cambios.perf_tramos = tr;
    cambios.pozos = totalPozos(tr);
    if (tr) cambios.metros_por_pozo = null;
  }
  if ("vol_tramos" in b) {
    const tr = tramos(b.vol_tramos);
    cambios.vol_tramos = tr;
    cambios.vol_pozos = totalPozos(tr);
    if (tr) cambios.vol_metros_por_pozo = null;
  }

  const { error: errUpd } = await supabase
    .from("cantera_voladuras")
    .update(cambios)
    .eq("codigo", codigo);
  if (errUpd) return NextResponse.json({ error: errUpd.message }, { status: 400 });

  // Los consumos: reemplazo completo. Es lo que espera el editor —una grilla que
  // se guarda entera— y evita tener que llevar el id de cada renglón.
  if (Array.isArray(b?.consumos)) {
    const renglones = b.consumos
      .map((r: Record<string, unknown>, i: number) => ({
        voladura_codigo: codigo,
        insumo_id: texto(r.insumo_id),
        insumo_raw: texto(r.insumo_raw),
        tipo: esTipoDeConsumoValido(r.tipo) ? r.tipo : null,
        cantidad: num(r.cantidad),
        precio_usd: num(r.precio_usd),
        orden: i,
      }))
      // El servicio de voladura (tipo "voladura") no se guarda: es el 4% de la
      // base y se recalcula al leer.
      .filter((r: { cantidad: number | null; tipo: string | null }) => r.cantidad !== null && r.tipo !== "voladura");

    const { error: errDel } = await supabase
      .from("cantera_consumos")
      .delete()
      .eq("voladura_codigo", codigo);
    if (errDel) return NextResponse.json({ error: errDel.message }, { status: 400 });

    if (renglones.length > 0) {
      const { error: errIns } = await supabase.from("cantera_consumos").insert(renglones);
      if (errIns) return NextResponse.json({ error: errIns.message }, { status: 400 });
    }
  }

  const [actualizada, consumos] = await Promise.all([
    traerVoladura(supabase, codigo),
    traerConsumos(supabase, codigo),
  ]);
  return NextResponse.json({ voladura: actualizada, consumos });
}
