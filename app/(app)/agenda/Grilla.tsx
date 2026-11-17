"use client";

import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { acomodar, partirPorDia, type PedazoUbicado } from "@/lib/agenda/grilla";
import { diaDeLaSemana } from "@/lib/core/fechas";
import { diaYHoraDe, etiquetaDelDia, type EventoVista } from "@/lib/agenda/vista";

/**
 * La cuadrícula de la Agenda: una columna por día y las horas hacia abajo.
 *
 * **Dibuja las 24 horas y no una ventana de trabajo.** Todas las órdenes de
 * trabajo caen entre las 04:00 y las 20:00, y por eso es tentador recortar la
 * grilla a esa franja. Pero un evento puede estar a cualquier hora —Google lo
 * permite—, y uno que cae fuera de lo dibujado no se ve y nada lo dice: es la
 * falla que toda esta pantalla está para evitar. El scroll arranca donde está
 * lo que hay que mirar, así que las 24 horas no cuestan nada de lectura.
 *
 * **No lee el reloj.** La línea de «ahora» se dibuja donde dice `ahoraMin`, que
 * llega del padre derivado del instante del servidor: el mismo dato que ya
 * decide qué evento es pasado y cuál próximo, y no una segunda forma de
 * calcularlo con la hora de la máquina de quien mira.
 *
 * Qué pedazo va dónde lo decide `lib/agenda/grilla.ts`, que tiene tests; acá
 * sólo se dibuja. Los colores van por `style` y no por utilidades por el mismo
 * motivo que en el resto de la pantalla: lo que se declara fuera de toda capa
 * le gana a una utilidad de Tailwind sin avisar.
 */

/** Alto de una hora, en px. Todo lo vertical sale de acá. */
export const ALTO_DE_LA_HORA = 48;

const ALTO_DEL_DIA = 24 * ALTO_DE_LA_HORA;
const HORAS = Array.from({ length: 24 }, (_, h) => h);

/** Dónde arranca el scroll cuando el rango no trae ningún evento. */
const HORA_DE_ARRANQUE = 6;

/** Fondo del fin de semana: apenas más gris, que se distinga sin esconderlo. */
const FONDO_DEL_FIN_DE_SEMANA = "#F4F6F9";
const COLOR_DE_LA_LINEA = "#E2E8F0";
const AZUL_DE_HOY = "#2563EB";

/** Los tres colores de un bloque: relleno, borde y texto. */
const COLORES = {
  ot: { fondo: "#DCFCE7", borde: "#16A34A", texto: "#14532D" },
  propio: { fondo: "#DBEAFE", borde: "#2563EB", texto: "#1E3A8A" },
  divergido: { fondo: "#FFEDD5", borde: "#C2410C", texto: "#7C2D12" },
} as const;

function coloresDe(e: EventoVista) {
  if (e.divergencia) return COLORES.divergido;
  return e.otId !== null ? COLORES.ot : COLORES.propio;
}

const dosCifras = (n: number) => String(n).padStart(2, "0");

export default function Grilla({
  dias, eventos, hoy, ahoraMin, onEvento, onHueco,
}: {
  /** Los días que se dibujan como columnas (`YYYY-MM-DD`): uno o siete. */
  dias: string[];
  eventos: EventoVista[];
  /** El día de hoy en Argentina, del servidor. */
  hoy: string;
  /** Minutos desde la medianoche de hoy, también del servidor. */
  ahoraMin: number;
  onEvento: (e: EventoVista) => void;
  /** Un clic en un hueco: el día y la hora en punto de la fila. */
  onHueco: (dia: string, hora: string) => void;
}) {
  const ubicados = useMemo(() => acomodar(partirPorDia(eventos, dias)), [eventos, dias]);
  const porDia = useMemo(() => {
    const m = new Map<string, PedazoUbicado[]>();
    for (const p of ubicados) m.set(p.dia, [...(m.get(p.dia) ?? []), p]);
    return m;
  }, [ubicados]);

  const contenedor = useRef<HTMLDivElement>(null);
  const claveDelRango = `${dias[0]}|${dias.length}`;
  // Un pedazo que viene de ayer arranca a las 00:00 por construcción y no dice
  // dónde está lo que hay que mirar: contándolo, una semana con un solo evento
  // que cruza la medianoche abría siempre en la madrugada (visto en el
  // navegador). Sólo cuenta si no hay otra cosa.
  const propios = ubicados.filter((p) => !p.vieneDeAntes);
  const paraElScroll = propios.length > 0 ? propios : ubicados;
  const primerMin = paraElScroll.length > 0 ? Math.min(...paraElScroll.map((p) => p.desdeMin)) : null;

  // El scroll se acomoda al cambiar de rango y no con cada cambio de eventos:
  // guardar una edición recarga la lista, y mover la grilla bajo la mano de
  // quien acaba de guardar sería peor que dejarla donde estaba.
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    const desde = primerMin === null ? HORA_DE_ARRANQUE * 60 : Math.max(0, primerMin - 30);
    el.scrollTop = (desde / 60) * ALTO_DE_LA_HORA;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveDelRango]);

  if (dias.length === 0) return null;

  // Siete columnas en un teléfono dejan unos 43 px cada una: es deliberado, ver
  // la excepción de `scripts/revisar-responsive.mjs`.
  const columnas = dias.length === 1 ? "grid-cols-1" : "grid-cols-7";

  function clicEnLaColumna(ev: MouseEvent<HTMLDivElement>, dia: string) {
    const caja = ev.currentTarget.getBoundingClientRect();
    const fila = Math.floor((ev.clientY - caja.top) / ALTO_DE_LA_HORA);
    onHueco(dia, `${dosCifras(Math.min(23, Math.max(0, fila)))}:00`);
  }

  return (
    <div className="card overflow-hidden">
      {/* El encabezado queda fuera del scroll; ambos reservan el hueco de la
          barra para que las columnas de arriba y de abajo no se desalineen. */}
      <div className="flex border-b" style={{ borderColor: COLOR_DE_LA_LINEA, overflowY: "hidden", scrollbarGutter: "stable" }}>
        <div className="w-11 shrink-0" />
        <div className={`grid min-w-0 flex-1 ${columnas}`}>
          {dias.map((dia) => {
            const esHoy = dia === hoy;
            return (
              <div
                key={dia}
                className="flex flex-col items-center py-1.5"
                style={{ background: esDeFinDeSemana(dia) ? FONDO_DEL_FIN_DE_SEMANA : undefined }}
              >
                <span className="text-[11px] font-medium uppercase" style={{ color: esHoy ? AZUL_DE_HOY : "#64748B" }}>
                  {etiquetaDelDia(dia).split(" ")[0]}
                </span>
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold"
                  style={esHoy ? { background: AZUL_DE_HOY, color: "#FFFFFF" } : { color: "#0F172A" }}
                >
                  {Number(dia.slice(8))}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div ref={contenedor} className="h-[65vh] overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
        <div className="flex" style={{ height: ALTO_DEL_DIA }}>
          <div className="relative w-11 shrink-0">
            {HORAS.slice(1).map((h) => (
              <span
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px]"
                style={{ top: h * ALTO_DE_LA_HORA, color: "#94A3B8" }}
              >
                {dosCifras(h)}:00
              </span>
            ))}
          </div>

          <div className={`grid min-w-0 flex-1 ${columnas}`}>
            {dias.map((dia) => (
              <div
                key={dia}
                className="relative border-l"
                style={{
                  borderColor: COLOR_DE_LA_LINEA,
                  background: esDeFinDeSemana(dia) ? FONDO_DEL_FIN_DE_SEMANA : undefined,
                  // La línea de cada hora, sin una celda por hora: son 168 en la semana.
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${ALTO_DE_LA_HORA - 1}px, ${COLOR_DE_LA_LINEA} ${ALTO_DE_LA_HORA - 1}px, ${COLOR_DE_LA_LINEA} ${ALTO_DE_LA_HORA}px)`,
                }}
                onClick={(ev) => clicEnLaColumna(ev, dia)}
              >
                {(porDia.get(dia) ?? []).map((p) => (
                  <Bloque
                    key={`${p.evento.id}|${p.dia}`}
                    pedazo={p}
                    pasado={dia < hoy || (dia === hoy && p.hastaMin <= ahoraMin)}
                    onEvento={onEvento}
                  />
                ))}

                {dia === hoy && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-20"
                    style={{ top: (ahoraMin / 60) * ALTO_DE_LA_HORA, borderTop: "2px solid #DC2626" }}
                    aria-hidden="true"
                  >
                    <span
                      className="absolute h-2.5 w-2.5 rounded-full"
                      style={{ left: -5, top: -6, background: "#DC2626" }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Sábado y domingo: la planta opera con turno de 04:00, así que se distinguen pero no se esconden. */
function esDeFinDeSemana(dia: string): boolean {
  const d = diaDeLaSemana(dia);
  return d === 0 || d === 6;
}

function Bloque({
  pedazo: p, pasado, onEvento,
}: {
  pedazo: PedazoUbicado;
  pasado: boolean;
  onEvento: (e: EventoVista) => void;
}) {
  const { evento: e } = p;
  const c = coloresDe(e);
  const alto = ((p.hastaMin - p.desdeMin) / 60) * ALTO_DE_LA_HORA;
  const ancho = 100 / p.columnas;
  const horario = `${diaYHoraDe(e.inicio).hora} a ${diaYHoraDe(e.fin).hora}`;

  // Una esquina plana es lo que dice «esto sigue» sin gastar texto.
  const redondeoArriba = p.vieneDeAntes ? 0 : 6;
  const redondeoAbajo = p.sigueDespues ? 0 : 6;

  return (
    <button
      type="button"
      className="absolute z-10 block overflow-hidden px-1.5 py-0.5 text-left text-xs leading-tight"
      style={{
        top: (p.desdeMin / 60) * ALTO_DE_LA_HORA,
        height: alto,
        left: `calc(${p.columna * ancho}% + 1px)`,
        width: `calc(${ancho}% - 3px)`,
        background: c.fondo,
        color: c.texto,
        border: `1px solid ${c.borde}`,
        borderLeft: `3px solid ${c.borde}`,
        borderRadius: `${redondeoArriba}px ${redondeoArriba}px ${redondeoAbajo}px ${redondeoAbajo}px`,
        // Un evento divergido es una alerta: no se baja aunque ya haya pasado.
        opacity: pasado && !e.divergencia ? 0.6 : 1,
      }}
      title={`${e.titulo} · ${horario}`}
      aria-label={`${e.titulo}, ${horario}${e.divergencia ? ", divergido en Google" : ""}`}
      onClick={(ev) => {
        // El bloque está encima de un hueco que también escucha el clic.
        ev.stopPropagation();
        onEvento(e);
      }}
    >
      <span className={`block font-semibold ${alto >= 36 ? "break-words" : "truncate"}`}>{e.titulo}</span>
      {alto >= 36 && <span className="block truncate opacity-80">{horario}</span>}
    </button>
  );
}
