"use client";

import { useState } from "react";
import Link from "next/link";
import { useConfirm } from "@/components/ConfirmProvider";
import { useCargar } from "@/lib/core/useCargar";
import { hoyEnArgentina } from "@/lib/core/fechas";

/**
 * El correo de novedades, mandado a mano y a quien uno elija.
 *
 * ## Por qué la vista previa es la mitad de la pantalla
 *
 * Porque es lo único que convierte «mandar» en una decisión y no en una
 * apuesta. El correo lleva adentro las observaciones de una ausencia —cosas
 * como «Laringitis»— y a quién le llega lo decide quien aprieta el botón: ver
 * antes el texto exacto es lo que permite darse cuenta de que ese día no
 * corresponde mandárselo a toda la planta.
 *
 * ## Lo que la pantalla tiene que decir y no se ve en el dato
 *
 * - **El automático sigue existiendo.** Esto no lo reemplaza: a las 15:50 sale
 *   solo a la lista fija de Configuración. Si alguien no lo sabe, va a creer
 *   que mandándolo a mano duplica el correo —y a veces sí—, así que la
 *   pantalla lo dice y enlaza a dónde se apaga.
 * - **Acá se puede mandar aunque no haya movimientos**, y el cron no. La
 *   diferencia es que acá hay alguien mirando.
 * - **Las tildes arrancan en la lista de siempre** y se cambian para este
 *   envío nada más: destildar a alguien acá no lo saca de la lista fija.
 */

interface Candidato {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

interface Vista {
  dia: string;
  asunto: string;
  cuerpo: string;
  cuenta: {
    ausencias: number;
    vacaciones: number;
    francosTomados: number;
    francosGenerados: number;
    sinInformarPorSerPasado: number;
  };
  ausentes: { empiezanOTerminan: number; siguenAusentes: number };
  hayMovimientos: boolean;
  automaticoActivo: boolean;
  casillaConfigurada: boolean;
  candidatos: Candidato[];
  sugeridos: string[];
}

export default function CorreoNovedadesClient() {
  const confirmar = useConfirm();
  // El día de Argentina y no el del navegador: el reloj de quien mira puede
  // estar en otro huso, y el día es lo que decide qué novedades se leen.
  const [dia, setDia] = useState(hoyEnArgentina());
  const [vista, setVista] = useState<Vista | null>(null);
  const [elegidos, setElegidos] = useState<string[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [problema, setProblema] = useState<string | null>(null);
  const [mandando, setMandando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  const recargar = useCargar(
    async (vigente) => {
      setCargando(true);
      const res = await fetch(`/api/rrhh/correo-novedades/envio?dia=${dia}`);
      const d = await res.json().catch(() => null);
      if (!vigente()) return;
      setCargando(false);
      if (!res.ok) {
        setProblema(d?.error ?? "No se pudo armar la vista previa");
        setVista(null);
        return;
      }
      setProblema(null);
      setVista(d);
      // Las tildes se reponen sólo la primera vez: si alguien ya eligió a
      // quién, cambiar de día no le puede deshacer la selección.
      setElegidos((previos) => previos ?? d.sugeridos ?? []);
    },
    [dia]
  );

  function alternar(id: string) {
    setElegidos((previos) => {
      const base = previos ?? [];
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  }

  async function mandar() {
    if (!vista || !elegidos?.length) return;
    const cuantos = elegidos.length;
    const ok = await confirmar({
      title: "Mandar el correo",
      message: `Se va a mandar a ${cuantos} ${cuantos === 1 ? "persona" : "personas"} desde gestiondepersonas@polcecal.com. Un correo mandado no se puede deshacer.`,
      confirmText: "Mandarlo",
    });
    if (!ok) return;

    setMandando(true);
    setResultado(null);
    const res = await fetch("/api/rrhh/correo-novedades/envio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dia, destinatarios: elegidos }),
    });
    const d = await res.json().catch(() => null);
    setMandando(false);
    if (!res.ok) {
      setProblema(d?.error ?? "No se pudo mandar");
      return;
    }
    setProblema(null);
    const fallados = (d.envios ?? []).filter((e: { estado: string }) => e.estado !== "enviado");
    setResultado(
      fallados.length
        ? `Se mandó a ${d.enviados} y falló en ${fallados.length}: ${fallados.map((e: { para: string; estado: string }) => `${e.para} (${e.estado})`).join(", ")}`
        : `Mandado a ${d.enviados} ${d.enviados === 1 ? "persona" : "personas"}.`
    );
    // Lo que salió puede no ser lo que se vio: entre la vista previa y el
    // botón alguien pudo cargar una novedad más. Se vuelve a pedir para que lo
    // que queda en pantalla sea lo que de verdad se mandó.
    recargar();
  }

  const seleccionados = elegidos ?? [];
  const encargados = vista?.candidatos.filter((c) => c.rol === "encargado") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/rrhh" className="text-sm text-slate-500 hover:text-slate-700">
          ← RR.HH.
        </Link>
        <h1 className="text-xl font-bold text-slate-900 mt-1">Mandar las novedades del día</h1>
        <p className="text-sm text-slate-500 mt-1">
          El mismo correo que sale solo a las 15:50, pero eligiendo a quién y cuándo. Sale desde{" "}
          <strong>gestiondepersonas@polcecal.com</strong>.
        </p>
      </div>

      {problema && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {problema}
        </p>
      )}

      {vista && !vista.casillaConfigurada && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          La casilla de RR.HH. no está configurada en Vercel, así que el botón de mandar va a fallar.
        </p>
      )}

      <div className="card p-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Día</label>
            <input
              type="date"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <p className="text-xs text-slate-400 sm:col-span-2">
            {vista?.automaticoActivo
              ? "El envío automático de las 15:50 está prendido: si mandás esto, a los de la lista fija les puede llegar dos veces."
              : "El envío automático de las 15:50 está apagado, así que éste es el único correo que sale."}{" "}
            <Link href="/rrhh/configuracion" className="underline">
              Cambiarlo en Configuración
            </Link>
            .
          </p>
        </div>
      </div>

      {cargando ? (
        <p className="text-slate-500 text-sm">Armando la vista previa...</p>
      ) : !vista ? null : (
        <>
          <div className="card p-5">
            <h2 className="font-medium text-slate-700 mb-1">Así va a salir</h2>
            {!vista.hayMovimientos && (
              <p className="text-xs text-amber-700 mb-2">
                Ese día no se cargó ninguna novedad, así que el automático no lo habría mandado. Desde acá
                se puede mandar igual.
              </p>
            )}
            {vista.cuenta.sinInformarPorSerPasado > 0 && (
              <p className="text-xs text-slate-400 mb-2">
                {vista.cuenta.sinInformarPorSerPasado}{" "}
                {vista.cuenta.sinInformarPorSerPasado === 1 ? "novedad cargada" : "novedades cargadas"} ese
                día no {vista.cuenta.sinInformarPorSerPasado === 1 ? "figura" : "figuran"} porque{" "}
                {vista.cuenta.sinInformarPorSerPasado === 1 ? "terminaba" : "terminaban"} antes de ese día.
              </p>
            )}
            <p className="text-sm text-slate-600 mb-3">
              <span className="text-slate-400">Asunto: </span>
              {vista.asunto}
            </p>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
              {vista.cuerpo}
            </pre>
          </div>

          <div className="card p-5">
            <h2 className="font-medium text-slate-700 mb-1">A quién</h2>
            <p className="text-xs text-slate-500 mb-3">
              Vale para este envío nada más: lo que tildes acá no cambia la lista fija del automático.
            </p>

            <div className="flex flex-wrap gap-2 mb-3">
              <button
                type="button"
                onClick={() => setElegidos(encargados.map((c) => c.id))}
                className="btn-secondary text-xs"
              >
                Todos los encargados ({encargados.length})
              </button>
              <button type="button" onClick={() => setElegidos([])} className="btn-secondary text-xs">
                Ninguno
              </button>
              {vista.sugeridos.length > 0 && (
                <button
                  type="button"
                  onClick={() => setElegidos(vista.sugeridos)}
                  className="btn-secondary text-xs"
                >
                  Los de siempre ({vista.sugeridos.length})
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mb-4">
              {vista.candidatos.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-sm text-slate-700 py-1">
                  <input
                    type="checkbox"
                    checked={seleccionados.includes(c.id)}
                    onChange={() => alternar(c.id)}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{c.nombre}</span>
                    <span className="block truncate text-xs text-slate-400">{c.email}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={mandar}
                disabled={mandando || seleccionados.length === 0}
                className="btn-primary disabled:opacity-50"
              >
                {mandando
                  ? "Mandando..."
                  : seleccionados.length === 0
                    ? "Elegí a quién mandárselo"
                    : `Mandar a ${seleccionados.length} ${seleccionados.length === 1 ? "persona" : "personas"}`}
              </button>
              {resultado && <span className="text-sm text-emerald-600">{resultado}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
