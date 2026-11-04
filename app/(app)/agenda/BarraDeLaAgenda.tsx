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
 * **Cuánto avanza una flecha lo decide lo que la persona está mirando**: en el
 * teléfono la semana dibuja un solo día, y ahí una flecha que salta siete deja
 * a quien mira en el miércoles 4 y, al apretar `›`, en el miércoles 11 sin
 * poder ir a mañana; en escritorio la semana salta siete. La vista de día salta
 * uno en cualquier ancho, y la lista no tiene rango que recorrer y por eso no
 * lleva flechas.
 *
 * **El ancho se resuelve con CSS y no con `window.matchMedia`**: en la semana se
 * dibujan los dos pares de flechas y uno se esconde (`hidden sm:flex` /
 * `sm:hidden`). Con `matchMedia` el servidor tiene que adivinar un ancho que no
 * conoce y el navegador lo corrige después —un salto en la hidratación—; así el
 * HTML del servidor ya es el correcto para los dos y no hay nada que corregir.
 * Se aparta del texto del plan, que prescribía `matchMedia`, pero no de su
 * intención: que el paso coincida con lo que se ve.
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

/** El par `‹ ›`, con el salto que le toca. */
function Flechas({
  vista, dia, paso, hrefDe,
}: {
  vista: VistaDeAgenda;
  dia: string;
  paso: number;
  hrefDe: (vista: VistaDeAgenda, dia: string) => string;
}) {
  const unidad = paso === 7 ? "Semana" : "Día";
  return (
    <>
      <Link
        href={hrefDe(vista, sumarDias(dia, -paso))}
        className={ENLACE_DE_FLECHA}
        style={{ borderColor: "#CBD5E1" }}
        aria-label={`${unidad} anterior`}
      >
        ‹
      </Link>
      <Link
        href={hrefDe(vista, sumarDias(dia, paso))}
        className={ENLACE_DE_FLECHA}
        style={{ borderColor: "#CBD5E1" }}
        aria-label={`${unidad} siguiente`}
      >
        ›
      </Link>
    </>
  );
}

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
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {vista !== "lista" && (
        <div className="flex items-center gap-1">
          {vista === "semana" ? (
            <>
              <span className="hidden items-center gap-1 sm:flex">
                <Flechas vista={vista} dia={dia} paso={7} hrefDe={hrefDe} />
              </span>
              <span className="flex items-center gap-1 sm:hidden">
                <Flechas vista={vista} dia={dia} paso={1} hrefDe={hrefDe} />
              </span>
            </>
          ) : (
            <Flechas vista={vista} dia={dia} paso={1} hrefDe={hrefDe} />
          )}
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
