/**
 * Parsea una fila cruda de la pestaña "Registro" de la planilla de destape
 * a un renglón para `cantera_destape`. Puro, sin red — lo usa
 * `scripts/importar-destape-2026.mts`.
 *
 * Columnas reales (fila 3 en adelante, encabezados en la 3): Fecha, Mes,
 * Yacimiento, Frente/Sector, Tipo de recurso, Operario/Empresa,
 * Equipo/Vehículo, Horas, Cantidad de viajes, Toneladas (estimado, se
 * ignora — se despeja, no se importa), Observaciones, + 4 columnas "(aux)"
 * cacheadas que tampoco se importan (se recalculan al leer).
 */

import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { resolverFleteroDestape, resolverOperarioDestape, type EmpleadoLiviano, type FleteroLiviano } from "./destape";

export interface EquipoParaImportar {
  id: string;
  code: string;
}

export interface RegistroImportado {
  fecha: string;
  yacimiento_codigo: string | null;
  frente: string | null;
  tipo_recurso: "operario_propio" | "fletero_externo";
  operario_id: string | null;
  fletero_id: string | null;
  recurso_raw: string;
  equipo_id: string | null;
  equipo_o_vehiculo_raw: string;
  tipo_camion: "camion_grande" | "camion_chico" | null;
  horas: number;
  viajes: number | null;
  observaciones: string | null;
}

function textoONull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

const TIPO_CAMION_DE_TEXTO: Record<string, "camion_grande" | "camion_chico"> = {
  "camión grande": "camion_grande",
  "camión chico": "camion_chico",
};

export function filaDestapeDeRegistro(
  fila: unknown[],
  fleteros: FleteroLiviano[],
  empleados: EmpleadoLiviano[],
  equipos: EquipoParaImportar[]
): RegistroImportado | null {
  const fecha = fechaDeSheets(fila[0]);
  if (!fecha) return null;

  const tipoTexto = String(fila[4] ?? "").trim().toLowerCase();
  if (!tipoTexto) return null; // fila sin dato real
  const tipoRecurso: "operario_propio" | "fletero_externo" =
    tipoTexto === "operario propio" ? "operario_propio" : "fletero_externo";

  const recursoRaw = String(fila[5] ?? "").trim();
  const equipoVehiculoRaw = String(fila[6] ?? "").trim();
  const horas = Number(fila[7]);
  if (!isFinite(horas) || horas <= 0) return null;
  const viajesCrudo = fila[8];
  const viajes = viajesCrudo === "" || viajesCrudo == null ? null : Number(viajesCrudo);

  let operarioId: string | null = null;
  let fleteroId: string | null = null;
  let equipoId: string | null = null;
  let tipoCamion: "camion_grande" | "camion_chico" | null = null;

  if (tipoRecurso === "operario_propio") {
    operarioId = resolverOperarioDestape(recursoRaw, empleados);
    const codigoEquipo = equipoVehiculoRaw.split(" - ")[0]?.trim();
    equipoId = equipos.find((e) => e.code === codigoEquipo)?.id ?? null;
  } else {
    fleteroId = resolverFleteroDestape(recursoRaw, fleteros);
    tipoCamion = TIPO_CAMION_DE_TEXTO[equipoVehiculoRaw.toLowerCase()] ?? null;
  }

  return {
    fecha,
    yacimiento_codigo: textoONull(fila[2]),
    frente: textoONull(fila[3]),
    tipo_recurso: tipoRecurso,
    operario_id: operarioId,
    fletero_id: fleteroId,
    recurso_raw: recursoRaw,
    equipo_id: equipoId,
    equipo_o_vehiculo_raw: equipoVehiculoRaw,
    tipo_camion: tipoCamion,
    horas,
    viajes: viajes !== null && isFinite(viajes) ? viajes : null,
    observaciones: textoONull(fila[10]),
  };
}

/** Todas las filas reales de "Registro". Las 3 primeras son encabezados. */
export function registrosDeDestape(
  filas: unknown[][],
  fleteros: FleteroLiviano[],
  empleados: EmpleadoLiviano[],
  equipos: EquipoParaImportar[]
): { registros: RegistroImportado[]; saltadas: number } {
  const registros: RegistroImportado[] = [];
  let saltadas = 0;
  for (const fila of filas.slice(3)) {
    const r = filaDestapeDeRegistro(fila, fleteros, empleados, equipos);
    if (r) registros.push(r);
    else saltadas++;
  }
  return { registros, saltadas };
}
