import Link from "next/link";
import type { Alerta } from "@/lib/tallerVial/tablero";
import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";

/**
 * Lo que pide acción hoy, arriba de todo. Si no hay nada lo dice igual: una
 * franja vacía no se distingue de una que no cargó.
 */
export default function AlertasDeTaller({ alertas, equipos }: { alertas: Alerta[]; equipos: EquipoTallerVial[] }) {
  if (alertas.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
        Todo en orden: ningún equipo pide atención hoy.
      </div>
    );
  }

  const nombre = (id: string | null) => {
    const e = equipos.find((x) => x.id === id);
    return e ? `${e.code} - ${e.name}` : null;
  };
  const criticas = alertas.filter((a) => a.nivel === "critica").length;

  return (
    <section className="card mt-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Para atender hoy</h2>
        <span className="text-xs text-slate-500">
          {criticas > 0 && <span className="font-medium text-red-600">{criticas} urgente{criticas > 1 ? "s" : ""}</span>}
          {criticas > 0 && alertas.length > criticas && " · "}
          {alertas.length > criticas && `${alertas.length - criticas} a revisar`}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {alertas.map((a, i) => {
          const critica = a.nivel === "critica";
          const enlace = a.tipo === "SERVICE_VENCIDO" || a.tipo === "SERVICE_PROXIMO" ? "/taller-vial/services"
            : a.tipo === "FUERA_DE_SERVICIO" ? "/taller-vial/estados"
            : "/taller-vial/cargas";
          return (
            <li
              key={`${a.tipo}-${a.equipoId ?? "flota"}-${i}`}
              className={`flex items-start gap-3 rounded-lg border-l-4 px-3 py-2 text-sm ${
                critica ? "border-red-500 bg-red-50" : "border-amber-500 bg-amber-50"
              }`}
            >
              <span className="min-w-0 flex-1">
                {nombre(a.equipoId) && <span className="font-semibold text-slate-900">{nombre(a.equipoId)} · </span>}
                <span className={critica ? "text-red-800" : "text-amber-900"}>{a.texto}</span>
              </span>
              <Link href={enlace} className="shrink-0 text-xs text-slate-500 underline">Ver →</Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
