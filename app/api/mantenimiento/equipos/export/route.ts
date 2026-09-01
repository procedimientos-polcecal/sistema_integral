import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { xlsxMultiSheetResponse } from "@/lib/core/xlsxExport";

/**
 * Arma el Excel del listado de equipos.
 *
 * Antes esto lo hacía el navegador: la pantalla importaba `xlsx` entero —unos
 * 400 KB minificados— para generar un archivo al apretar un botón. Era la única
 * pantalla de la app que lo hacía así; el resto ya exportaba desde el servidor
 * con `xlsxResponse`. Ese peso lo pagaba todo el que abría Equipos, exportara o
 * no.
 *
 * Recibe las filas YA FILTRADAS en lugar de re-consultar con los mismos
 * filtros: los filtros son de la UI —empresa, sector, estado y un buscador de
 * texto libre— y duplicarlos acá sería garantizar que en algún momento diverjan
 * y el Excel no coincida con lo que la persona está viendo. Son ~70 filas.
 */

interface FilaEquipo {
  codigo: string;
  nombre: string;
  empresa: string;
  sector: string;
  kw: string | number;
  estado: string;
  criticidad: string;
  descripcion: string;
  notas: string;
}

const ENCABEZADO = [
  "Código", "Nombre", "Empresa", "Sector", "kW",
  "Estado", "Criticidad", "Descripción", "Notas",
];
const ANCHOS = [14, 30, 12, 20, 8, 20, 12, 35, 35];

// Los valores que el importador acepta, para que quien edite el Excel y lo
// vuelva a subir sepa qué puede escribir.
const REFERENCIA: unknown[][] = [
  ["Estado (valores válidos)", "", "Criticidad (valores válidos)"],
  ["OPERATIVO", "", "ALTA"],
  ["EN_MANTENIMIENTO", "", "MEDIA"],
  ["EN_REPARACION", "", "BAJA"],
  ["STANDBY", "", ""],
  ["FUERA_DE_SERVICIO", "", ""],
  ["DADO_DE_BAJA", "", ""],
];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { filas } = (await request.json()) as { filas?: FilaEquipo[] };
  if (!Array.isArray(filas)) {
    return NextResponse.json({ error: "Faltan las filas a exportar" }, { status: 400 });
  }

  const cuerpo = filas.map((f) => [
    f.codigo, f.nombre, f.empresa, f.sector, f.kw,
    f.estado, f.criticidad, f.descripcion, f.notas,
  ]);

  const fecha = new Date().toISOString().slice(0, 10);
  return xlsxMultiSheetResponse(`equipos_${fecha}.xlsx`, [
    { name: "Equipos", rows: [ENCABEZADO, ...cuerpo], anchos: ANCHOS },
    { name: "Referencia", rows: REFERENCIA },
  ]);
}
