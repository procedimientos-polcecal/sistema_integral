import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { traerDiasDeAsistencia } from "@/lib/rrhh/asistenciaDeEmpleado";
import { rangoPedido } from "@/lib/rrhh/rangoPedido";
import { xlsxMultiSheetResponse } from "@/lib/core/xlsxExport";
import {
  COLUMNAS_DE_MARCACIONES,
  LEYENDA_TURNO_DE_NOCHE,
  encabezadoDeLaPlanilla,
  filasDeMarcaciones,
  nombreDelArchivo,
  totalesDeMarcaciones,
  type DiaDeLaPlanilla,
} from "@/lib/rrhh/marcacionesDelMes";

/**
 * Las marcaciones de un empleado, en .xlsx.
 *
 * Es la misma tabla que la pestaña «Fichadas» de su ficha —mismo filtro,
 * mismas sumas, misma forma de escribir el turno de noche— porque las dos
 * salen de `lib/rrhh/marcacionesDelMes.ts`. Lo que se ve es lo que se baja: un
 * informe que no coincide con la pantalla que lo generó no se puede usar para
 * discutir un sueldo.
 *
 * Las horas van como **número** y no como texto: el destino normal de este
 * archivo es que alguien le sume una columna.
 */
const ANCHOS = [12, 11, 34, 15, 11, 12, 13, 32];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { desde, hasta } = rangoPedido(new URL(request.url).searchParams);

  const { data: empleado } = await supabase
    .from("empleados")
    .select("apellido, nombre, legajo, sectores(nombre)")
    .eq("id", id)
    .single();

  if (!empleado) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  const dias = (await traerDiasDeAsistencia(supabase, id, desde, hasta)) as unknown as DiaDeLaPlanilla[];
  const filas = filasDeMarcaciones(dias);
  const totales = totalesDeMarcaciones(dias);

  // PostgREST devuelve el embed como objeto o como array de uno según cómo
  // resuelva la cardinalidad; se aceptan las dos formas, como en el resto del
  // módulo.
  const sectorEmbed = empleado.sectores as { nombre?: string } | { nombre?: string }[] | null;
  const sector = (Array.isArray(sectorEmbed) ? sectorEmbed[0] : sectorEmbed)?.nombre ?? null;
  const persona = [empleado.apellido, empleado.nombre].filter(Boolean).join(", ");

  const rows: unknown[][] = [
    ["MARCACIONES"],
    ...encabezadoDeLaPlanilla({ ...empleado, sector }, desde, hasta),
    [],
    [...COLUMNAS_DE_MARCACIONES],
    ...filas.map((f) => [
      f.fecha,
      f.dia,
      f.marcaciones,
      f.horas,
      f.extra50 || null,
      f.extra100 || null,
      f.tipoDia,
      f.observaciones,
    ]),
    [
      "TOTAL",
      `${totales.dias} ${totales.dias === 1 ? "día" : "días"}`,
      "",
      totales.horas,
      totales.extra50 || null,
      totales.extra100 || null,
      "",
      "",
    ],
    [],
    [LEYENDA_TURNO_DE_NOCHE],
  ];

  return xlsxMultiSheetResponse(nombreDelArchivo(persona, desde, hasta, "xlsx"), [
    { name: "Marcaciones", rows, anchos: ANCHOS },
  ]);
}
