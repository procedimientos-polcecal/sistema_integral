export interface TramoVacaciones {
  hastaAnios: number;
  dias: number;
}

export function diasCorrespondientes(fechaIngreso: Date, anio: number, escala: TramoVacaciones[]): number {
  const inicioAnio = new Date(anio, 0, 1);
  const antiguedadAnios = (inicioAnio.getTime() - fechaIngreso.getTime()) / (365.25 * 24 * 3_600_000);
  if (antiguedadAnios < 0) return 0;
  const tramos = [...escala].sort((a, b) => a.hastaAnios - b.hastaAnios);
  for (const tramo of tramos) {
    if (antiguedadAnios <= tramo.hastaAnios) return tramo.dias;
  }
  return tramos[tramos.length - 1]?.dias ?? 0;
}
