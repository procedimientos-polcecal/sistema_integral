import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera } from "@/lib/cantera/auth";
import { correlativosUsados, traerYacimientos } from "@/lib/cantera/consultas";
import { anioParaCodigo, armarCodigo, proximoCorrelativo } from "@/lib/cantera/codigos";

/**
 * Dar de alta una voladura.
 *
 * El código se genera acá y no se acepta del navegador: es
 * `V{NN}{codigo_yac}{AA}` con `NN` el próximo correlativo de ese yacimiento en
 * ese año y `AA` los dos últimos dígitos del año de la voladura (o el año en
 * curso si todavía no hay fecha). `anio` y `correlativo` se guardan como
 * columnas para calcular el siguiente sin parsear.
 *
 * La fila nace casi vacía: se elige el yacimiento, se genera el código, y el
 * resto se completa en el editor. Devuelve el código para que el cliente
 * redirija ahí.
 *
 * OJO CON LA CARRERA: entre leer los correlativos usados y escribir el nuevo,
 * otra sesión podría tomar el mismo número. Lo ataja la constraint
 * `unique (yacimiento_id, anio, correlativo)`: un choque devuelve 23505 y se
 * reintenta con el siguiente. Es el mismo riesgo aceptado que el alta de
 * Compras a la planilla, y acá con red de contención.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar voladuras" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const yacimientoId = String(b?.yacimiento_id ?? "");
  if (!yacimientoId) {
    return NextResponse.json({ error: "Falta la cantera" }, { status: 400 });
  }

  const yacimientos = await traerYacimientos(supabase);
  const yac = yacimientos.find((y) => y.id === yacimientoId);
  if (!yac) return NextResponse.json({ error: "Esa cantera no existe" }, { status: 404 });

  const volFecha =
    typeof b?.vol_fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.vol_fecha) ? b.vol_fecha : null;
  const anio = anioParaCodigo(volFecha);

  // Hasta tres intentos: cubre un par de altas simultáneas sin caer en un bucle.
  for (let intento = 0; intento < 3; intento++) {
    const usados = await correlativosUsados(supabase, "cantera_voladuras", yacimientoId, anio);
    const correlativo = proximoCorrelativo(usados) + intento;
    const codigo = armarCodigo("V", yac.codigo, correlativo, anio);

    const { data, error } = await supabase
      .from("cantera_voladuras")
      .insert({
        codigo,
        yacimiento_id: yacimientoId,
        anio,
        correlativo,
        vol_fecha: volFecha,
        burden_m: yac.burden_m,
        espaciamiento_m: yac.espaciamiento_m,
        cargado_por: user.id,
      })
      .select("codigo")
      .single();

    if (!error) return NextResponse.json({ data });
    if (error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // 23505: alguien tomó ese correlativo. Se reintenta con el siguiente.
  }

  return NextResponse.json(
    { error: "No se pudo asignar un código libre. Probá de nuevo." },
    { status: 409 }
  );
}
