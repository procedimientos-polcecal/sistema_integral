"use client";

import Link from "next/link";
import { sumarDias } from "@/lib/core/fechas";
import { tituloDelRango, type VistaDeAgenda } from "@/lib/agenda/rango";

/**
 * La cabecera de la Agenda: `‹ › Hoy`, el título del rango, el selector de vista
 * y «Nuevo evento».
 *
 * **Las flechas y el selector son enlaces y no botones**: mover la semana es una
 * navegación, porque la lectura de eventos vive en el Server Component y lo que
 * se mira está en la URL. Un botón que cambiara un estado local mostraría una
 * semana sin sus eventos.
 *
 * **Cuánto avanza una flecha lo decide la vista y no el ancho de la pantalla**:
 * una semana salta siete días y un día salta uno. La semana se dibuja de lunes a
 * domingo a partir de cualquier día de ella, así que avanzar un solo día en la
 * vista de semana no cambiaría nada de lo que se ve —seis de cada siete
 * pulsaciones—. La lista no tiene rango que recorrer y por eso no lleva flechas.
 *
 * Los botones llevan sus colores por `style` o por las clases de la casa:
 * `.btn-*` está declarada fuera de toda capa y una utilidad de color o de
 * tamaño de letra puesta al lado pierde sin avisar.
 */

const VISTAS: { vista: VistaDeAgenda; nombre: string }[] = [
  { vista: "semana", nombre: "Semana" },
  { vista: "dia", nombre: "Día" },
  { vista: "lista", nombre: "Lista" },
];

const ENLACE_DE_FLECHA =
  "flex h-9 w-9 items-center justify-center rounded-lg border text-lg leading-none text-slate-600 hover:bg-slate-50";

export default function BarraDeLaAgenda({
  vista, dia, hoy, hrefDe, onNuevo,
}: {
  vista: VistaDeAgenda;
  /** El día que se mira (`YYYY-MM-DD`). */
  dia: string;
  /** El día de hoy en Argentina, del servidor: «Hoy» lleva ahí. */
  hoy: string;
  hrefDe: (vista: VistaDeAgenda, dia: string) => string;
  onNuevo: () => void;
}) {
  const paso = vista === "semana" ? 7 : 1;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {vista !== "lista" && (
        <div className="flex items-center gap-1">
          <Link
            href={hrefDe(vista, sumarDias(dia, -paso))}
            className={ENLACE_DE_FLECHA}
            style={{ borderColor: "#CBD5E1" }}
            aria-label={vista === "semana" ? "Semana anterior" : "Día anterior"}
          >
            ‹
          </Link>
          <Link
            href={hrefDe(vista, sumarDias(dia, paso))}
            className={ENLACE_DE_FLECHA}
            style={{ borderColor: "#CBD5E1" }}
            aria-label={vista === "semana" ? "Semana siguiente" : "Día siguiente"}
          >
            ›
          </Link>
          <Link
            href={hrefDe(vista, hoy)}
            className="flex h-9 items-center rounded-lg border px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            style={{ borderColor: "#CBD5E1" }}
          >
            Hoy
          </Link>
        </div>
      )}

      <h2 className="min-w-0 flex-1 text-base font-semibold text-slate-900">{tituloDelRango(vista, dia)}</h2>

      <nav aria-label="Vista de la agenda" className="flex overflow-hidden rounded-lg border" style={{ borderColor: "#CBD5E1" }}>
        {VISTAS.map((v) => {
          const activa = v.vista === vista;
          return (
            <Link
              key={v.vista}
              href={hrefDe(v.vista, dia)}
              aria-current={activa ? "page" : undefined}
              className="flex h-9 items-center px-3 text-sm font-medium"
              style={activa ? { background: "#1E7D34", color: "#FFFFFF" } : { color: "#475569" }}
            >
              {v.nombre}
            </Link>
          );
        })}
      </nav>

      <button type="button" className="btn-primary" onClick={onNuevo}>
        Nuevo evento
      </button>
    </div>
  );
}
