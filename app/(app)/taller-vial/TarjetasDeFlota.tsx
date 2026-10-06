import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";
import { ETIQUETA_UNIDAD, unidadDeUso } from "@/lib/tallerVial/equipos";
import { ETIQUETA_ESTADO } from "@/lib/tallerVial/estados";
import type { TarjetaDeEquipo } from "@/lib/tallerVial/tablero";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

const COLOR_BORDE = {
  OPERATIVO: "border-emerald-500",
  OPERATIVO_CON_FALLAS: "border-amber-500",
  FUERA_DE_SERVICIO: "border-red-500",
} as const;

const COLOR_PUNTO = {
  OPERATIVO: "bg-emerald-500",
  OPERATIVO_CON_FALLAS: "bg-amber-500",
  FUERA_DE_SERVICIO: "bg-red-500",
} as const;

/** "hace 3 días", "hoy", "ayer". */
function hace(dias: number): string {
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

/**
 * Un equipo, una tarjeta: de un vistazo se ve cuáles andan y cuáles no. Sólo
 * muestra lo que se sabe; "—" es "sin dato", nunca un cero inventado.
 */
export default function TarjetasDeFlota({ tarjetas, equipos }: { tarjetas: TarjetaDeEquipo[]; equipos: EquipoTallerVial[] }) {
  return (
    <section className="mt-4">
      <h2 className="font-semibold text-slate-900">La flota, hoy</h2>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tarjetas.map((t) => {
          const equipo = equipos.find((e) => e.id === t.equipoId);
          if (!equipo) return null;
          const unidad = ETIQUETA_UNIDAD[unidadDeUso(equipo.code)];
          const borde = t.estado ? COLOR_BORDE[t.estado] : "border-slate-300";
          return (
            <div key={t.equipoId} className={`card border-l-4 p-3 ${borde}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-slate-900">{equipo.code}</span>
                <span className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  <span className={`h-2 w-2 rounded-full ${t.estado ? COLOR_PUNTO[t.estado] : "bg-slate-300"}`} />
                  {t.estado ? ETIQUETA_ESTADO[t.estado] : "Sin estado"}
                </span>
              </div>
              <p className="truncate text-xs text-slate-500" title={equipo.name}>{equipo.name}</p>
              <dl className="mt-2 space-y-0.5 text-[11px] text-slate-500">
                <div className="flex justify-between gap-2">
                  <dt>En este estado</dt>
                  <dd className="font-medium text-slate-700">{t.diasEnEstado !== null ? `${t.diasEnEstado} d` : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Marca</dt>
                  <dd className="font-medium tabular-nums text-slate-700">{t.horometro !== null ? `${num0.format(t.horometro)} ${unidad}` : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Últ. carga</dt>
                  <dd className="font-medium text-slate-700">{t.diasSinCarga !== null ? hace(t.diasSinCarga) : "—"}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}
