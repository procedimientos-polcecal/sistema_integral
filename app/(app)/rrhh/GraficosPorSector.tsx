"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import InfoTip from "@/components/InfoTip";

/**
 * Los tres gráficos por sector del dashboard de RRHH.
 *
 * Están en su propio archivo para que el dashboard los cargue con
 * `next/dynamic`: `recharts` son unos 350 KB y sin esto el JS de los gráficos
 * bloquea el primer pintado de la pantalla entera. Así el encabezado, los
 * filtros y las cuatro tarjetas —que ya vienen con datos del servidor— se ven
 * enseguida, y los gráficos aparecen un instante después.
 */

interface Props {
  horasSector: any[] | null;
  horasExtraSector: any[] | null;
  desdeGraficos: string;
  hastaGraficos: string;
  onSectorClick: (sel: { sectorId: string; desde: string; hasta: string }) => void;
}

export default function GraficosPorSector({
  horasSector,
  horasExtraSector,
  desdeGraficos,
  hastaGraficos,
  onSectorClick,
}: Props) {
  const alClickear = (data: any) =>
    onSectorClick({ sectorId: data.payload.sectorId, desde: desdeGraficos, hasta: hastaGraficos });

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="font-medium text-gray-700 mb-3">Horas trabajadas vs Teóricas por Sector</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={horasSector ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="sector" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="horasTrabajadas" name="Trabajadas" fill="#0ea5e9" onClick={alClickear} cursor="pointer" />
              <Bar dataKey="horasTeoricas" name="Teóricas" fill="#94a3b8" onClick={alClickear} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="font-medium text-gray-700 mb-3">Horas extra por Sector</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={horasExtraSector ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="sector" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="horasExtra50" name="Extra 50%" fill="#f59e0b" onClick={alClickear} cursor="pointer" />
              <Bar dataKey="horasExtra100" name="Extra 100%" fill="#ef4444" onClick={alClickear} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-5 mt-6">
        <h2 className="font-medium text-gray-700 flex items-center gap-1.5 mb-3">
          Costo de horas extra por Sector ($)
          <InfoTip text="Estimado a partir del valor hora normal de cada empleado y los multiplicadores configurados en Administración." />
        </h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={horasExtraSector ?? []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sector" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${Number(v).toLocaleString("es-AR")}`} />
            <Tooltip formatter={(v: any) => `$${Number(v).toLocaleString("es-AR")}`} />
            <Legend />
            <Bar dataKey="montoExtra50" name="Extra 50%" fill="#f59e0b" onClick={alClickear} cursor="pointer" />
            <Bar dataKey="montoExtra100" name="Extra 100%" fill="#ef4444" onClick={alClickear} cursor="pointer" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
