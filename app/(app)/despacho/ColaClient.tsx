"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { comoSeLee, sumarDias } from "@/lib/core/fechas";
import {
  ETIQUETA_DE_ESTADO,
  ETIQUETA_DE_HORARIO,
  ORDEN_DE_HORARIOS,
  comoSeLeenLosMinutos,
  horaComoSeEscribe,
  minutosEnCurso,
  proximoHorario,
} from "@/lib/despacho/orden";
import type { EstadoDeOrden, HorarioDeOrden, RemitoDeOdoo } from "@/lib/despacho/types";
import type { FilaDeCola } from "./page";
import NuevaOrden from "./NuevaOrden";

/**
 * Movimientos diarios, en la PC de la balanza.
 *
 * DOS DECISIONES QUE SON LA PANTALLA
 *
 * **Los cuatro horarios son campos que se tipean.** Hasta el 11/09/2026 había un
 * botón por fila —el del próximo horario— y la hora la ponía el servidor. Ese
 * diseño suponía que quien marca está mirando pasar el camión, y resultó falso:
 * **los horarios llegan tarde y de gente que no está en Despacho**, así que el
 * botón obligaba a marcar "ahora" una hora que había pasado hace rato. Se
 * completan en cualquier orden y se corrigen tipeando encima.
 *
 * Lo que quedó del diseño viejo es la guía sin la obligación: el campo del
 * próximo horario que falta va resaltado, así que sigue estando claro qué toca
 * — pero no impide cargar otro.
 *
 * **El reloj del tramo en curso corre.** Es lo único que se calcula en el
 * cliente, porque avanza mientras la pantalla está abierta, y es la mitad del
 * valor del módulo: "cargando hace 42 min" es exactamente lo que la planilla del
 * día siguiente no puede decir.
 *
 * El reloj arranca en null y se llena después de montar. Calcularlo en el
 * servidor daría un texto y el cliente otro un segundo más tarde, que es un
 * error de hidratación — y encima se congelaría hasta el próximo refresh.
 */

const COLOR_DE_ESTADO: Record<EstadoDeOrden, string> = {
  esperando: "bg-slate-100 text-slate-600",
  en_predio: "bg-amber-100 text-amber-700",
  cargando: "bg-blue-100 text-blue-700",
  cargado: "bg-indigo-100 text-indigo-700",
  cerrada: "bg-emerald-100 text-emerald-700",
};

export default function ColaClient({
  fecha,
  hoy,
  filas,
  empresas,
  puedeEditar,
}: {
  fecha: string;
  hoy: string;
  filas: FilaDeCola[];
  empresas: { id: string; nombre: string }[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [ahora, setAhora] = useState<Date | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [avisoPlanilla, setAvisoPlanilla] = useState("");
  const [creando, setCreando] = useState(false);
  const [remitos, setRemitos] = useState<(RemitoDeOdoo & { yaTieneOrden: boolean })[] | null>(null);
  const [errorRemitos, setErrorRemitos] = useState("");
  const [trayendoRemitos, setTrayendoRemitos] = useState(false);

  // Medio minuto: el dato se lee en minutos, así que refrescar más seguido es
  // gastar renders para mostrar el mismo número.
  useEffect(() => {
    setAhora(new Date());
    const t = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function traerRemitos() {
    setTrayendoRemitos(true);
    setErrorRemitos("");
    const res = await fetch(`/api/despacho/remitos?fecha=${fecha}`);
    const json = await res.json().catch(() => ({}));
    setTrayendoRemitos(false);
    if (!res.ok) {
      setErrorRemitos(json.error ?? "No se pudieron traer los remitos de Odoo.");
      setRemitos([]);
      return;
    }
    setRemitos(json.remitos ?? []);
  }

  function abrirAlta() {
    setCreando(true);
    // Odoo tarda, así que se pide al abrir el alta y no en cada tecla. Si ya se
    // trajeron, se reusan: el botón de refrescar está adentro del formulario.
    if (remitos === null) void traerRemitos();
  }

  /**
   * Guarda una hora tipeada. Se manda "HH:MM" y **la ancla el servidor** contra
   * la fecha de la orden: así la zona horaria y el reloj de esta PC no entran en
   * el dato, y la regla del cruce de medianoche se aplica en un solo lugar.
   */
  async function guardarHora(id: string, horario: HorarioDeOrden, valor: string) {
    setError("");
    setAvisoPlanilla("");
    setMarcando(id);
    const res = await fetch(`/api/despacho/ordenes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ horas: { [horario]: valor } }),
    });
    const json = await res.json().catch(() => ({}));
    setMarcando(null);

    if (!res.ok) {
      setError(json.error ?? "No se pudo guardar el horario.");
      return;
    }
    // Un fallo de escritura en la planilla no es un warning en la consola: se le
    // dice a quien hizo la acción. La orden quedó guardada igual.
    if (json.planilla_error) setAvisoPlanilla(json.planilla_error);
    router.refresh();
  }

  const abiertas = filas.filter((f) => f.estado !== "cerrada").length;

  return (
    <div className="mx-auto max-w-6xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Despacho — movimientos diarios</h1>
          <p className="text-sm text-slate-500">
            {comoSeLee(fecha)} · {filas.length} {filas.length === 1 ? "orden" : "órdenes"}
            {abiertas > 0 && ` · ${abiertas} sin cerrar`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/despacho?fecha=${sumarDias(fecha, -1)}`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            ← Día anterior
          </Link>
          {fecha !== hoy && (
            <Link
              href="/despacho"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Hoy
            </Link>
          )}
          {puedeEditar && (
            <button
              onClick={abrirAlta}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
            >
              + Nueva orden de carga
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {avisoPlanilla && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>La orden se guardó, pero no llegó a la planilla.</strong> Google
          dijo: {avisoPlanilla}
        </div>
      )}

      {creando && (
        <NuevaOrden
          fecha={fecha}
          remitos={remitos}
          trayendo={trayendoRemitos}
          error={errorRemitos}
          empresas={empresas}
          onRefrescar={traerRemitos}
          onCerrar={() => setCreando(false)}
          onCreada={(aviso) => {
            setCreando(false);
            if (aviso) setAvisoPlanilla(aviso);
            void traerRemitos();
            router.refresh();
          }}
        />
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Nº</th>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-left">Material</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-2 py-2 text-center">Entrada</th>
                <th className="px-2 py-2 text-center">Inicio carga</th>
                <th className="px-2 py-2 text-center">Fin carga</th>
                <th className="px-2 py-2 text-center">Salida</th>
                <th className="px-3 py-2 text-right">Carga</th>
                <th className="px-3 py-2 text-right">En predio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-slate-400">
                    Ninguna orden de carga este día.
                  </td>
                </tr>
              ) : (
                filas.map((f) => {
                  const siguiente = proximoHorario(f.orden);
                  const enCurso = ahora ? minutosEnCurso(f.orden, ahora) : null;
                  return (
                    <tr key={f.orden.id} className="align-top hover:bg-slate-50">
                      <td className="px-3 py-3 font-medium text-slate-900">
                        {f.orden.numero}
                        {f.atrasada && (
                          <span
                            className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-normal text-red-700"
                            title="Quedó abierta de un día anterior y todavía no llegó a la planilla"
                          >
                            {comoSeLee(f.orden.fecha)}
                          </span>
                        )}
                        <div className="text-xs font-normal text-slate-400">
                          {f.orden.odoo_picking_name ?? (
                            <span
                              className="text-amber-600"
                              title="Se cargó sin elegir un remito de Odoo. No se engancha uno parecido: queda vacío y se ve."
                            >
                              sin remito
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{f.orden.cliente_raw ?? "—"}</td>
                      <td className="px-3 py-3 text-slate-700">
                        {f.producto}
                        {f.sinClasificar && (
                          <div
                            className="text-xs text-amber-600"
                            title="El producto no está en el mapeo de Despacho: la planilla recibe el nombre crudo de Odoo"
                          >
                            sin clasificar
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">
                        {f.orden.cantidad !== null
                          ? `${f.orden.cantidad} ${f.orden.unidad ?? ""}`.trim()
                          : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${COLOR_DE_ESTADO[f.estado]}`}
                        >
                          {ETIQUETA_DE_ESTADO[f.estado]}
                        </span>
                        {enCurso !== null && (
                          <div className="mt-1 text-xs text-slate-500">
                            hace {comoSeLeenLosMinutos(enCurso)}
                          </div>
                        )}
                        {f.salteados.length > 0 && (
                          <div
                            className="mt-1 text-xs text-red-600"
                            title="Sin ese horario no se puede calcular el tiempo, y la planilla recibe la celda vacía"
                          >
                            falta {f.salteados.map((h) => ETIQUETA_DE_HORARIO[h]).join(" y ")}
                          </div>
                        )}
                        {f.orden.sheets_pendiente && (
                          <div
                            className="mt-1 text-xs text-amber-600"
                            title={f.orden.sheets_pendiente}
                          >
                            sin llegar a la planilla
                          </div>
                        )}
                      </td>
                      {ORDEN_DE_HORARIOS.map((horario) => (
                        <td key={horario} className="px-2 py-3 text-center">
                          <CampoDeHora
                            valor={horaComoSeEscribe(f.orden[horario])}
                            etiqueta={ETIQUETA_DE_HORARIO[horario]}
                            editable={puedeEditar}
                            esElQueSigue={siguiente === horario}
                            guardando={marcando === f.orden.id}
                            onGuardar={(v) => guardarHora(f.orden.id, horario, v)}
                          />
                        </td>
                      ))}
                      <td
                        className={`px-3 py-3 text-right ${
                          (f.minutosDeCarga ?? 0) < 0 ? "font-semibold text-red-600" : "text-slate-600"
                        }`}
                      >
                        {comoSeLeenLosMinutos(f.minutosDeCarga)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right ${
                          (f.minutosEnPredio ?? 0) < 0 ? "font-semibold text-red-600" : "text-slate-600"
                        }`}
                      >
                        {comoSeLeenLosMinutos(f.minutosEnPredio)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Los horarios se tipean y se guardan al salir del campo; vacío borra el
        horario. La hora va como se lee acá —hora de Argentina— y la ancla el
        servidor a la fecha de la orden. La planilla se escribe cuando la orden
        se cierra, o sea al cargar la salida del predio.
      </p>
    </div>
  );
}

/**
 * Un horario de la orden, editable.
 *
 * **Guarda al salir del campo, no en cada tecla.** Un `input type="time"`
 * dispara `change` mientras se completa —"0", "07", "07:3"— y guardar en cada
 * uno mandaría cuatro PATCH por hora tipeada, tres de ellos con una hora a
 * medio escribir que el servidor rechazaría.
 *
 * El valor local se resincroniza cuando cambia el de arriba: después de guardar,
 * la fila se vuelve a traer del servidor y lo que hay que mostrar es lo que
 * quedó guardado, no lo que se tipeó — si el servidor lo interpretó como del día
 * siguiente por el cruce de medianoche, la hora es la misma pero el instante no.
 */
function CampoDeHora({
  valor,
  etiqueta,
  editable,
  esElQueSigue,
  guardando,
  onGuardar,
}: {
  valor: string;
  etiqueta: string;
  editable: boolean;
  esElQueSigue: boolean;
  guardando: boolean;
  onGuardar: (valor: string) => void;
}) {
  const [texto, setTexto] = useState(valor);
  useEffect(() => setTexto(valor), [valor]);

  if (!editable) {
    return <span className="text-sm text-slate-600">{valor || "—"}</span>;
  }

  return (
    <input
      type="time"
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        if (texto !== valor) onGuardar(texto);
      }}
      disabled={guardando}
      aria-label={etiqueta}
      title={etiqueta}
      className={`w-[6.5rem] rounded-lg border px-2 py-1.5 text-sm disabled:opacity-50 ${
        esElQueSigue && texto === ""
          ? "border-[var(--primary)] bg-blue-50 ring-1 ring-[var(--primary)]"
          : "border-slate-300"
      }`}
    />
  );
}
