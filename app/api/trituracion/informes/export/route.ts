import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoTrituracion } from "@/lib/trituracion/auth";
import { traerPartes, traerPlantas } from "@/lib/trituracion/consultas";
import { armarLibroInforme } from "@/lib/trituracion/informeExcel";
import type { ParteParaInformeMensual } from "@/lib/trituracion/informeMensual";

/**
 * El .xlsx del informe mensual de plantas de trituración. El libro lo arma
 * `lib/trituracion/informeExcel.ts`, con fórmulas sobre una hoja de partes
 * crudos (para que se vea cada cuenta); esta ruta sólo trae los datos. Usa
 * `exceljs` y no la `xlsx`/SheetJS del resto del repo, que en su edición
 * gratuita no pinta celdas al escribir.
 */

function aParteInforme(p: {
  fecha: string; estado: string; material: string | null; origen: string | null;
  horas_mantenimiento: number; horas_falta_piedra: number; horas_produccion: number; horas_otro: number;
  camiones_llegados: number | null; toneladas_procesadas: number | null;
}): ParteParaInformeMensual {
  return {
    fecha: p.fecha,
    estado: p.estado as "opero" | "no_opero",
    material: p.material,
    origen: p.origen,
    horasMantenimiento: p.horas_mantenimiento,
    horasFaltaPiedra: p.horas_falta_piedra,
    horasProduccion: p.horas_produccion,
    horasOtro: p.horas_otro,
    camionesLlegados: p.camiones_llegados,
    toneladasProcesadas: p.toneladas_procesadas,
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoTrituracion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Trituración" }, { status: 403 });
  }

  const url = new URL(request.url);
  const mes = url.searchParams.get("mes");
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: "Falta mes (YYYY-MM)" }, { status: 400 });
  }

  const plantas = await traerPlantas(supabase);
  const desde = `${mes}-01`;
  const [anio, mesNum] = mes.split("-").map(Number);
  const hasta = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);
  const partesPorPlanta = await Promise.all(
    plantas.map((p) => traerPartes(supabase, { plantaId: p.id, desde, hasta }))
  );
  const wb = armarLibroInforme(
    mes,
    plantas.map((planta, i) => ({ nombre: planta.nombre, partes: partesPorPlanta[i].map(aParteInforme) })),
    new Date().toLocaleString("es-AR")
  );

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="trituracion_informe_${mes}.xlsx"`,
    },
  });
}
