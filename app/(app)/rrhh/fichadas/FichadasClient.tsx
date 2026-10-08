"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";
import Select from "@/components/Select";
import type { UltimaSync } from "@/lib/core/sincronizaciones";
import { haceCuanto } from "@/lib/core/haceCuanto";
import { fechaHora } from "@/lib/compras/constants";
import { AVISO_DIA_SIN_PROTEGER, traeDiaSinProteger } from "@/lib/rrhh/fichadas/diaSinProteger";
import { DIAS_MAX_RANGO } from "@/lib/rrhh/lenox/rango";
import { bloqueoPorUltimaSync, rangoPorDefecto, segundosDeEspera, textoDeEspera } from "@/lib/rrhh/lenox/pantalla";
import AcreditadoDeFichada from "@/components/rrhh/AcreditadoDeFichada";
import type { TurnoLike } from "@/lib/rrhh/engine/recalcular-puro";
import { acreditarLista } from "@/lib/rrhh/fichadas/acreditado";
import AvisosDeCarga from "./AvisosDeCarga";

interface PreviewResult {
  token: string;
  sheetNames: string[];
  sheet: string;
  headers: string[];
  sample: Record<string, unknown>[];
  totalRows: number;
}

/** Lo que contesta `POST /api/rrhh/fichadas/lenox/sincronizar` cuando sincronizó. */
interface ResumenSync {
  desde: string;
  hasta: string;
  marcacionesTraidas: number;
  insertados: number;
  reemplazados: number;
  salteados: number;
  /** Algo que no se cargó. */
  avisos: string[];
  /** Trabajo heredado a mano: no es un error de la corrida. */
  pendientes: string[];
}

function formatHora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
}

export default function FichadasClient({ empleados, fichadasIniciales, turnos, ultimaSync }: {
  empleados: any[];
  fichadasIniciales: any[];
  /** Turnos activos del catálogo; null si no se pudieron leer. */
  turnos: TurnoLike[] | null;
  ultimaSync: UltimaSync | null;
}) {
  const router = useRouter();
  const confirmar = useConfirm();
  const [fichadas, setFichadas] = useState(fichadasIniciales);

  // Lo que se acredita sale de la lista que hay en pantalla y no se guarda
  // aparte: cuando una carga refresca `fichadas` con otra lista, esto se
  // recalcula solo. Calculado en el servidor se perdería en ese refresco.
  const acreditadoPorId = useMemo(
    () => (turnos ? acreditarLista(fichadas, turnos) : null),
    [fichadas, turnos]
  );

  // --- lenox ---
  const [rango, setRango] = useState(() => rangoPorDefecto(new Date()));
  const [sincronizando, setSincronizando] = useState(false);
  // Un ref además del estado: entre el clic y el `setSincronizando` hay una
  // confirmación de por medio, y cada llamada que se gasta de más es de un
  // límite escaso.
  const enCurso = useRef(false);
  const [resumenSync, setResumenSync] = useState<ResumenSync | null>(null);
  const [errorSync, setErrorSync] = useState("");
  // Hasta cuándo no se puede volver a apretar, tras un 429. Arranca ya puesto si
  // la última corrida anotada fue un 429 reciente: recargar la página no puede
  // destrabar el botón, porque el bloqueo es de la cuenta de Lenox y no de la
  // pestaña.
  const [bloqueadoHasta, setBloqueadoHasta] = useState<number | null>(() => bloqueoPorUltimaSync(ultimaSync, Date.now()));
  const [mensajeEspera, setMensajeEspera] = useState("");
  const [ahora, setAhora] = useState(() => Date.now());
  const esperando = bloqueadoHasta !== null && ahora < bloqueadoHasta;

  useEffect(() => {
    if (bloqueadoHasta === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setAhora(t);
      if (t >= bloqueadoHasta) setBloqueadoHasta(null);
    }, 1000);
    return () => clearInterval(id);
  }, [bloqueadoHasta]);

  // Trae la lista de nuevo, ya con el cálculo del día pegado (es la misma
  // función del servidor que arma la carga inicial). Si la ruta falla se deja
  // la lista como estaba: antes una respuesta de error se guardaba como si
  // fuera la lista y la pantalla se rompía.
  function recargarFichadas() {
    fetch("/api/rrhh/fichadas")
      .then((r) => (r.ok ? r.json() : null))
      .then((lista) => { if (Array.isArray(lista)) setFichadas(lista); })
      .catch(() => {});
  }

  async function sincronizarConLenox() {
    if (enCurso.current || esperando) return;
    enCurso.current = true;
    try {
      const ok = await confirmar({
        title: "Traer de Lenox",
        message: `Se van a traer las marcaciones del ${rango.desde} al ${rango.hasta}. Los días corregidos a mano y los de una liquidación cerrada no se tocan. ¿Confirmás?`,
        confirmText: "Traer",
      });
      if (!ok) return;

      setSincronizando(true);
      setErrorSync("");
      setMensajeEspera("");
      setResumenSync(null);
      try {
        const res = await fetch("/api/rrhh/fichadas/lenox/sincronizar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rango),
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 429) {
          // No es un error y no se arregla reintentando: se arregla esperando.
          // Cada intento prolonga el bloqueo, así que el botón queda trabado.
          const t = Date.now();
          setAhora(t);
          setBloqueadoHasta(t + segundosDeEspera(res.headers.get("Retry-After")) * 1000);
          setMensajeEspera(data.error ?? "Lenox pidió esperar antes de volver a consultar.");
          return;
        }
        if (!res.ok) {
          // Lo que dijo la ruta, sin traducir: es la diferencia entre un
          // diagnóstico y un cartel genérico.
          setErrorSync(data.error ?? `No se pudo sincronizar (HTTP ${res.status})`);
          return;
        }
        setResumenSync({ ...data, avisos: data.avisos ?? [], pendientes: data.pendientes ?? [] });
        router.refresh();
        recargarFichadas();
      } catch {
        setErrorSync("No se pudo comunicar con el servidor. Mirá el cartel de última sincronización antes de volver a intentar: puede que la corrida haya llegado a empezar.");
      } finally {
        setSincronizando(false);
      }
    } finally {
      enCurso.current = false;
    }
  }

  // --- import ---
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState({
    legajo: "", fecha: "", modo: "separado" as "separado" | "combinado", horaEntrada: "", horaSalida: "", marcaciones: "",
  });
  const [importResult, setImportResult] = useState<{ insertados: number; reemplazados: number; errores: string[]; pendientes: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  function guessMapping(headers: string[]) {
    const guess = (needle: string) => headers.find((h) => h.toLowerCase().includes(needle)) ?? "";
    const marcaciones = guess("marcacion");
    return {
      legajo: guess("legajo"), fecha: guess("fecha"),
      modo: (marcaciones ? "combinado" : "separado") as "separado" | "combinado",
      horaEntrada: marcaciones ? "" : guess("entrada"),
      horaSalida: marcaciones ? "" : guess("salida"),
      marcaciones,
    };
  }

  async function handleFile(file: File) {
    setImporting(true);
    setImportError("");
    setImportResult(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/rrhh/fichadas/import/preview", { method: "POST", body: fd });
    const data = await res.json();
    setImporting(false);
    if (!res.ok) { setImportError(data.error ?? "No se pudo leer el archivo"); return; }
    setPreview(data);
    setMapping(guessMapping(data.headers));
  }

  async function cambiarHoja(sheet: string) {
    if (!preview) return;
    const res = await fetch("/api/rrhh/fichadas/import/preview-sheet", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: preview.token, sheet }),
    });
    const data = await res.json();
    if (res.ok) {
      setPreview((p) => (p ? { ...p, ...data } : p));
      setMapping(guessMapping(data.headers));
    }
  }

  async function confirmarImport() {
    if (!preview) return;
    const ok = await confirmar({
      title: "Confirmar importación",
      message: `Se van a importar las marcaciones de la planilla (${preview.totalRows} filas). ¿Confirmás?`,
      confirmText: "Importar",
    });
    if (!ok) return;
    setImporting(true);
    setImportError("");
    const res = await fetch("/api/rrhh/fichadas/import/confirm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: preview.token, sheet: preview.sheet, mapping }),
    });
    const data = await res.json();
    setImporting(false);
    if (!res.ok) { setImportError(data.error ?? "No se pudo importar el archivo"); return; }
    setImportResult({ ...data, errores: data.errores ?? [], pendientes: data.pendientes ?? [] });
    setPreview(null);
    router.refresh();
    recargarFichadas();
  }

  // --- manual ---
  const [form, setForm] = useState({ employeeId: "", fecha: "", horaEntrada: "", horaSalida: "" });
  const [guardandoManual, setGuardandoManual] = useState(false);
  const [errorManual, setErrorManual] = useState("");
  const [diaSinProteger, setDiaSinProteger] = useState(false);
  async function crearManual(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoManual(true);
    setErrorManual("");
    setDiaSinProteger(false);
    const res = await fetch("/api/rrhh/fichadas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: form.employeeId,
        fecha: form.fecha,
        horaEntrada: `${form.fecha}T${form.horaEntrada}:00`,
        horaSalida: form.horaSalida ? `${form.fecha}T${form.horaSalida}:00` : null,
      }),
    });
    setGuardandoManual(false);
    if (!res.ok) {
      // El formulario queda como estaba: no se pierde lo que se tipeó.
      const data = await res.json().catch(() => ({}));
      setErrorManual(data.error ?? "No se pudo guardar la fichada");
      return;
    }
    // La fichada se guardó, pero si el día no quedó marcado la próxima
    // sincronización con Lenox lo pisa.
    setDiaSinProteger(await traeDiaSinProteger(res));
    setForm({ employeeId: "", fecha: "", horaEntrada: "", horaSalida: "" });
    router.refresh();
    recargarFichadas();
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
        Marcaciones
        <InfoTip text="Las entradas y salidas de cada empleado. Se traen del reloj a través de Lenox; si eso no alcanza, podés importar el archivo del reloj o cargarlas a mano. Con estas marcaciones el sistema calcula las horas trabajadas, extras y ausencias." />
      </h1>

      <div className="card p-5 mb-6">
        <div className="mb-3">
          <h2 className="font-medium text-slate-700 flex items-center gap-1.5">
            Traer de Lenox
            <InfoTip text="Trae las marcaciones del reloj directamente de Lenox para el rango que elijas. Los días que corregiste a mano y los de una liquidación cerrada no se tocan. Además, el sistema trae los últimos 7 días solo, una vez por día." />
          </h2>
          {/* Cuándo fue, y si falló, por qué: una fecha vieja sin explicación es
              lo que hace que nadie sepa si está mirando datos al día. */}
          {ultimaSync ? (
            ultimaSync.ok ? (
              <p className="text-xs text-slate-400 mt-1" title={fechaHora(ultimaSync.created_at)}>
                Última sincronización: {haceCuanto(ultimaSync.created_at)}
              </p>
            ) : (
              <p className="text-sm text-red-600 mt-1">
                La última sincronización falló ({haceCuanto(ultimaSync.created_at)}): {ultimaSync.error}
              </p>
            )
          ) : (
            <p className="text-xs text-slate-400 mt-1">Sin sincronizar todavía</p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Desde</label>
            <input type="date" value={rango.desde} max={rango.hasta}
              onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Hasta</label>
            <input type="date" value={rango.hasta} min={rango.desde}
              onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))} className="input" />
          </div>
          <button type="button" onClick={sincronizarConLenox}
            disabled={sincronizando || esperando || !rango.desde || !rango.hasta}
            className="btn-primary disabled:opacity-50">
            {sincronizando
              ? "Trayendo..."
              : esperando && bloqueadoHasta !== null
                ? <>Disponible en <span suppressHydrationWarning>{textoDeEspera(bloqueadoHasta - ahora)}</span></>
                : "Traer de Lenox"}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">Hasta {DIAS_MAX_RANGO} días por vez.</p>

        {/* El 429 no es un error y no es un pendiente: es "esperá". Va aparte, en
            azul, y el botón no se destraba solo hasta que pasa la espera. */}
        {esperando && bloqueadoHasta !== null && (
          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            <p className="font-medium">Lenox pidió esperar antes de volver a consultar</p>
            {mensajeEspera && <p className="mt-1">{mensajeEspera}</p>}
            <p className="mt-1 text-xs">
              No se arregla reintentando: cada intento alarga la espera. El botón se habilita solo en{" "}
              <span suppressHydrationWarning>{textoDeEspera(bloqueadoHasta - ahora)}</span>.
            </p>
          </div>
        )}

        {errorSync && (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorSync}</p>
        )}

        {resumenSync && (
          <div className="mt-3 text-sm">
            <p className="text-slate-700">
              {resumenSync.marcacionesTraidas} marcaciones del {resumenSync.desde} al {resumenSync.hasta}:{" "}
              <strong>{resumenSync.insertados}</strong> cargadas
              {resumenSync.reemplazados > 0 && <>, {resumenSync.reemplazados} reemplazadas</>}
              {resumenSync.salteados > 0 && <>, {resumenSync.salteados} {resumenSync.salteados === 1 ? "día sin tocar" : "días sin tocar"}</>}.
            </p>
            <AvisosDeCarga errores={resumenSync.avisos} pendientes={resumenSync.pendientes} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6 items-start">
        <details className="card p-5">
          <summary className="font-medium text-slate-700 cursor-pointer flex items-center gap-1.5">
            Importar archivo del reloj (respaldo)
            <InfoTip text="Respaldo para cuando Lenox no está disponible. Subí el Excel/CSV que exporta el reloj biométrico. Elegí qué columna es el legajo, la fecha y los horarios, y el sistema carga todas las marcaciones de una." />
          </summary>
          <div className="mt-3">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} className="text-sm mb-3" />
          {importing && <p className="text-sm text-slate-500">Procesando...</p>}
          {importError && <p className="text-sm text-red-600">{importError}</p>}

          {preview && (
            <div className="mt-3">
              {preview.sheetNames.length > 1 && (
                <div className="mb-3">
                  <label className="block text-xs text-slate-500 mb-1">Hoja del archivo</label>
                  <Select value={preview.sheet} onChange={(e) => cambiarHoja(e.target.value)} className="input">
                    {preview.sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </div>
              )}
              <p className="text-sm text-slate-500 mb-2">{preview.totalRows} filas encontradas. Mapeá las columnas:</p>

              <div className="mb-3">
                <label className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                  Formato de horarios
                  <InfoTip text="Depende de cómo viene tu archivo. 'Separadas': una columna para la hora de entrada y otra para la salida. 'Combinada': una sola columna con todo junto, ej. 'E 08:07 - S 15:56'." />
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMapping({ ...mapping, modo: "separado" })}
                    className={`flex-1 py-1.5 rounded-md text-sm ${mapping.modo === "separado" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
                    Entrada y salida en columnas separadas
                  </button>
                  <button type="button" onClick={() => setMapping({ ...mapping, modo: "combinado" })}
                    className={`flex-1 py-1.5 rounded-md text-sm ${mapping.modo === "combinado" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
                    Una columna combinada (ej: &quot;E 08:07 - S 15:56&quot;)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Legajo</label>
                  <Select value={mapping.legajo} onChange={(e) => setMapping({ ...mapping, legajo: e.target.value })} className="input">
                    <option value="">-</option>
                    {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Fecha</label>
                  <Select value={mapping.fecha} onChange={(e) => setMapping({ ...mapping, fecha: e.target.value })} className="input">
                    <option value="">-</option>
                    {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>

                {mapping.modo === "combinado" ? (
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-500 mb-1">Marcaciones (entrada y salida juntas)</label>
                    <Select value={mapping.marcaciones} onChange={(e) => setMapping({ ...mapping, marcaciones: e.target.value })} className="input">
                      <option value="">-</option>
                      {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Hora entrada</label>
                      <Select value={mapping.horaEntrada} onChange={(e) => setMapping({ ...mapping, horaEntrada: e.target.value })} className="input">
                        <option value="">-</option>
                        {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </Select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Hora salida</label>
                      <Select value={mapping.horaSalida} onChange={(e) => setMapping({ ...mapping, horaSalida: e.target.value })} className="input">
                        <option value="">-</option>
                        {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </Select>
                    </div>
                  </>
                )}
              </div>

              {preview.sample[0] && mapping.modo === "combinado" && mapping.marcaciones && (
                <p className="text-xs text-slate-400 mb-3">Ejemplo de la primera fila: &quot;{String(preview.sample[0][mapping.marcaciones])}&quot;</p>
              )}

              <button
                onClick={confirmarImport}
                disabled={!mapping.legajo || !mapping.fecha || (mapping.modo === "combinado" ? !mapping.marcaciones : !mapping.horaEntrada) || importing}
                className="btn-primary disabled:opacity-50"
              >
                {importing ? "Importando..." : "Confirmar importación"}
              </button>
            </div>
          )}

          {importResult && (
            <div className="mt-4 text-sm">
              <p className="text-green-700">{importResult.insertados} fichadas importadas.</p>
              {importResult.reemplazados > 0 && (
                <p className="text-slate-500">{importResult.reemplazados} fichadas de días ya cargados se actualizaron con los datos nuevos del archivo.</p>
              )}
              <AvisosDeCarga errores={importResult.errores} pendientes={importResult.pendientes} />
            </div>
          )}
          </div>
        </details>

        <div className="card p-5">
          <h2 className="font-medium text-slate-700 mb-3">Carga manual</h2>
          <form onSubmit={crearManual} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Empleado</label>
              <Select required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="input">
                <option value="">Seleccionar...</option>
                {empleados.map((e) => <option key={e.id} value={e.id}>{e.legajo} - {e.apellido}, {e.nombre}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Fecha</label>
                <input type="date" required value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className="input" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Entrada</label>
                <input type="time" required value={form.horaEntrada} onChange={(e) => setForm({ ...form, horaEntrada: e.target.value })} className="input" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Salida</label>
                <input type="time" value={form.horaSalida} onChange={(e) => setForm({ ...form, horaSalida: e.target.value })} className="input" />
              </div>
            </div>
            <button type="submit" disabled={guardandoManual} className="btn-primary disabled:opacity-50">
              {guardandoManual ? "Guardando..." : "Guardar fichada"}
            </button>
          </form>
          {errorManual && <p className="mt-3 text-sm text-red-600">{errorManual}</p>}
          {diaSinProteger && (
            <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {AVISO_DIA_SIN_PROTEGER}
            </p>
          )}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-slate-700">Últimas fichadas</h2>
          {/* Descarga, no pagina: ver el comentario en VehiculosClient. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/rrhh/fichadas/export" download className="text-sm text-blue-600 hover:underline">Exportar</a>
        </div>
        {fichadas.slice(0, 50).some((f: any) => f.calculo_dia === undefined) && (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No se pudo leer el cálculo diario: no se muestran las horas fijadas a mano, la tardanza ni el retiro anticipado.
            El rango acreditado de cada marcación sí se ve, porque sale del turno y no de esa tabla.
          </p>
        )}
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b">
              <th className="pb-2">Legajo</th>
              <th className="pb-2">Empleado</th>
              <th className="pb-2">Fecha</th>
              <th className="pb-2">Entrada</th>
              <th className="pb-2">Salida</th>
              <th className="pb-2">
                <span className="inline-flex items-center gap-1">
                  Acreditado
                  <InfoTip text="Lo que el sistema suma a la liquidación. Dentro del margen del turno se acredita desde el horario pactado y no desde la marca, así que no hace falta corregir una marca que ya cierra bien: la marca del reloj queda como está. Si coincide con la marca, sólo se ven las horas. La tardanza, el retiro anticipado y las horas fijadas a mano salen del cálculo diario ya guardado; un día que todavía no se recalculó lo dice." />
                </span>
              </th>
              <th className="pb-2">Origen</th>
            </tr>
          </thead>
          <tbody>
            {fichadas.slice(0, 50).map((f: any) => (
              <tr key={f.id} className="border-b last:border-0">
                <td className="py-2">{f.empleados?.legajo}</td>
                <td className="py-2">{f.empleados?.apellido}, {f.empleados?.nombre}</td>
                <td className="py-2">{new Date(f.fecha).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                <td className="py-2">{formatHora(f.hora_entrada)}</td>
                <td className="py-2">{f.hora_salida ? formatHora(f.hora_salida) : "-"}</td>
                <td className="py-2">
                  {acreditadoPorId?.get(f.id) && <AcreditadoDeFichada acreditado={acreditadoPorId.get(f.id)!} calculo={f.calculo_dia} />}
                </td>
                <td className="py-2">{f.origen}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
