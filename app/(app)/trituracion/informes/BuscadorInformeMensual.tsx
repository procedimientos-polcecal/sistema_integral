"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** El selector de mes del informe "oficial" — igual patrón que "Generar informe por fecha" de Cantera, pero con un solo mes en vez de un rango. */
export default function BuscadorInformeMensual({ mesGenerado }: { mesGenerado: string }) {
  const router = useRouter();
  const [mes, setMes] = useState(mesGenerado);

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="text-xs text-slate-600">
        Mes
        <input
          type="month"
          className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
        />
      </label>
      <button
        disabled={!mes}
        onClick={() => router.push(`/trituracion/informes?mes=${mes}`)}
        className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        Generar informe
      </button>
      {mesGenerado && (
        <a
          href={`/api/trituracion/informes/export?mes=${mesGenerado}`}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
        >
          Exportar a Excel
        </a>
      )}
    </div>
  );
}
