export const TIPOS_AUSENCIA = [
  ["LICENCIA_ART", "Licencia por ART"],
  ["VACACIONES", "Vacaciones"],
  ["LICENCIA_GREMIAL", "Licencia gremial"],
  ["PERMISO_PERSONAL", "Permiso personal"],
  ["ENFERMEDAD_ACCIDENTE_INCULPABLE", "Enfermedad/accidente inculpable"],
  ["LICENCIA_SIN_GOCE_SUELDO", "Licencia sin goce de sueldo"],
  ["SUSPENSION", "Suspensión"],
  ["FALLECIMIENTO_FAMILIAR", "Fallecimiento de familiar"],
  ["EXAMEN_ESTUDIO", "Examen/estudio"],
  ["TARDANZA", "Tardanza"],
  ["INJUSTIFICADA", "Ausencia injustificada"],
  ["OTRA", "Otra (aclarar)"],
] as const;

export function labelTipoAusencia(tipo: string): string {
  return TIPOS_AUSENCIA.find(([v]) => v === tipo)?.[1] ?? tipo;
}
