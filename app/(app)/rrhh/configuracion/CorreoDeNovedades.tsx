"use client";

import { useState } from "react";
import InfoTip from "@/components/InfoTip";
import MultiSelect from "@/components/MultiSelect";
import { useCargar } from "@/lib/core/useCargar";
import { useEsAdminRrhh } from "@/lib/rrhh/context";

/**
 * El correo de novedades que RR.HH. manda al cierre del día.
 *
 * Vive en su propia tarjeta y con su propio botón de guardar, separado de las
 * reglas de cálculo. No es prolijidad: el PUT de la otra configuración dispara
 * `recalcularVentanaEnSegundoPlano()` porque sus campos entran en el cálculo de
 * horas, y cambiarle una coma al saludo de un correo no puede costar un
 * recálculo del período.
 *
 * LO QUE LA PANTALLA TIENE QUE DECIR Y NO SE VE EN EL DATO: **sin nadie
 * tildado va a todos los encargados**, resuelto en el momento del envío, y en
 * cuanto alguien tilda a una persona esa regla deja de correr. Es la diferencia
 * entre «no configuré nada» y «elegí que no le llegue a nadie más», y si la
 * pantalla no la explica, la lista vacía se lee como «no le llega a nadie».
 */

interface Candidato {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

interface Config {
  activo: boolean;
  destinatarios: string[];
  encabezado: string;
  cierre: string;
}

export default function CorreoDeNovedades() {
  const esAdmin = useEsAdminRrhh();
  const [config, setConfig] = useState<Config | null>(null);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [problema, setProblema] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  useCargar(async (vigente) => {
    const res = await fetch("/api/rrhh/correo-novedades");
    const d = await res.json().catch(() => null);
    if (!vigente()) return;
    setCargando(false);
    // Los candidatos vienen aunque la configuración falle: con la migración
    // sin aplicar, la pantalla igual puede decir qué falta.
    setCandidatos(d?.candidatos ?? []);
    if (!res.ok) {
      setProblema(d?.error ?? "No se pudo leer la configuración del correo");
      return;
    }
    setProblema(null);
    setConfig({
      activo: d.activo,
      destinatarios: d.destinatarios ?? [],
      encabezado: d.encabezado ?? "",
      cierre: d.cierre ?? "",
    });
  }, []);

  async function guardar() {
    if (!config) return;
    setGuardando(true);
    setGuardado(false);
    const res = await fetch("/api/rrhh/correo-novedades", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const d = await res.json().catch(() => null);
    setGuardando(false);
    if (!res.ok) {
      setProblema(d?.error ?? "No se pudo guardar");
      return;
    }
    setProblema(null);
    setGuardado(true);
  }

  const encargados = candidatos.filter((c) => c.rol === "encargado");
  const elegidos = config?.destinatarios ?? [];

  return (
    <div className="card p-5 max-w-3xl">
      <h2 className="font-medium text-slate-700 mb-1 flex items-center gap-1.5">
        Correo de novedades al cierre del día
        <InfoTip text="Todos los días a las 15:50 el sistema manda un correo con las novedades de personal cargadas ese día: ausencias, vacaciones y francos. Si no hubo ninguna, no se manda nada. Sale desde gestiondepersonas@polcecal.com." />
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        Sale todos los días a las 15:50 desde <strong>gestiondepersonas@polcecal.com</strong>, con las
        ausencias, vacaciones y francos cargados ese día. <strong>Si no hubo novedades, no se manda.</strong>
      </p>

      {problema && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {problema}
        </p>
      )}

      {cargando ? (
        <p className="text-slate-500 text-sm">Cargando...</p>
      ) : !config ? null : (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-700 mb-4">
            <input
              type="checkbox"
              checked={config.activo}
              disabled={!esAdmin}
              onChange={(e) => setConfig({ ...config, activo: e.target.checked })}
            />
            Mandar el correo
          </label>

          <div className="mb-4">
            <label className="block text-xs text-slate-500 mb-1">Destinatarios</label>
            <MultiSelect
              valores={elegidos}
              onCambio={(v) => esAdmin && setConfig({ ...config, destinatarios: v })}
              vacio="Todos los encargados"
              plural="personas"
              opciones={candidatos.map((c) => [c.id, `${c.nombre} — ${c.email}`])}
            />
            <p className="text-xs text-slate-400 mt-1">
              {elegidos.length === 0 ? (
                <>
                  Sin nadie tildado le llega a <strong>todos los encargados</strong> ({encargados.length} hoy),
                  y un encargado nuevo lo empieza a recibir solo. En cuanto tildes a alguien, esa regla deja
                  de correr y le llega exactamente a quien quede tildado.
                </>
              ) : (
                <>
                  Le llega sólo a estas {elegidos.length === 1 ? "persona" : `${elegidos.length} personas`}.
                  Un encargado nuevo <strong>no</strong> lo va a recibir hasta que lo agregues acá. Destildá a
                  todos para volver a «todos los encargados».
                </>
              )}
            </p>
          </div>

          <div className="mb-4">
            <label className="block text-xs text-slate-500 mb-1">Encabezado del correo</label>
            <textarea
              value={config.encabezado}
              disabled={!esAdmin}
              onChange={(e) => setConfig({ ...config, encabezado: e.target.value })}
              rows={3}
              className="input"
              placeholder="Va arriba de todo. Si lo dejás vacío, el correo arranca por las novedades."
            />
          </div>

          <div className="mb-4">
            <label className="block text-xs text-slate-500 mb-1">Cierre del correo</label>
            <textarea
              value={config.cierre}
              disabled={!esAdmin}
              onChange={(e) => setConfig({ ...config, cierre: e.target.value })}
              rows={4}
              className="input"
              placeholder="Va al final, después de las novedades. La firma, por ejemplo."
            />
          </div>

          <p className="text-xs text-slate-400 mb-4">
            El medio del correo —las novedades— no se puede editar: es el dato.
          </p>

          {esAdmin ? (
            <>
              <button onClick={guardar} disabled={guardando} className="btn-primary disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar el correo"}
              </button>
              {guardado && <span className="ml-3 text-sm text-emerald-600">Guardado.</span>}
            </>
          ) : (
            <p className="text-sm text-slate-500">Sólo un administrador de RRHH puede cambiar esto.</p>
          )}
        </>
      )}
    </div>
  );
}
