"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";

interface PreviewResult {
  token: string;
  sheetNames: string[];
  sheet: string;
  headers: string[];
  sample: Record<string, unknown>[];
  totalRows: number;
}

function formatHora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
}

export default function FichadasClient({ empleados, fichadasIniciales }: { empleados: any[]; fichadasIniciales: any[] }) {
  const router = useRouter();
  const confirmar = useConfirm();
  const [fichadas, setFichadas] = useState(fichadasIniciales);

  // --- import ---
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState({
    legajo: "", fecha: "", modo: "separado" as "separado" | "combinado", horaEntrada: "", horaSalida: "", marcaciones: "",
  });
  const [importResult, setImportResult] = useState<{ insertados: number; reemplazados: number; errores: string[] } | null>(null);
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
    setImportResult(data);
    setPreview(null);
    router.refresh();
    fetch("/api/rrhh/fichadas").then((r) => r.json()).then(setFichadas).catch(() => {});
  }

  // --- manual ---
  const [form, setForm] = useState({ employeeId: "", fecha: "", horaEntrada: "", horaSalida: "" });
  const [guardandoManual, setGuardandoManual] = useState(false);
  async function crearManual(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoManual(true);
    await fetch("/api/rrhh/fichadas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: form.employeeId,
        fecha: form.fecha,
        horaEntrada: `${form.fecha}T${form.horaEntrada}:00`,
        horaSalida: form.horaSalida ? `${form.fecha}T${form.horaSalida}:00` : null,
      }),
    });
    setGuardandoManual(false);
    setForm({ employeeId: "", fecha: "", horaEntrada: "", horaSalida: "" });
    router.refresh();
    fetch("/api/rrhh/fichadas").then((r) => r.json()).then(setFichadas).catch(() => {});
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
        Marcaciones
        <InfoTip text="Las entradas y salidas de cada empleado. Podés importarlas desde el archivo del reloj biométrico o cargarlas a mano. Con estas marcaciones el sistema calcula las horas trabajadas, extras y ausencias." />
      </h1>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="card p-5">
          <h2 className="font-medium text-gray-700 mb-3 flex items-center gap-1.5">
            Importar archivo del reloj
            <InfoTip text="Subí el Excel/CSV que exporta el reloj biométrico. Elegí qué columna es el legajo, la fecha y los horarios, y el sistema carga todas las marcaciones de una." />
          </h2>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} className="text-sm mb-3" />
          {importing && <p className="text-sm text-gray-500">Procesando...</p>}
          {importError && <p className="text-sm text-red-600">{importError}</p>}

          {preview && (
            <div className="mt-3">
              {preview.sheetNames.length > 1 && (
                <div className="mb-3">
                  <label className="block text-xs text-gray-500 mb-1">Hoja del archivo</label>
                  <select value={preview.sheet} onChange={(e) => cambiarHoja(e.target.value)} className="input">
                    {preview.sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <p className="text-sm text-gray-500 mb-2">{preview.totalRows} filas encontradas. Mapeá las columnas:</p>

              <div className="mb-3">
                <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  Formato de horarios
                  <InfoTip text="Depende de cómo viene tu archivo. 'Separadas': una columna para la hora de entrada y otra para la salida. 'Combinada': una sola columna con todo junto, ej. 'E 08:07 - S 15:56'." />
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMapping({ ...mapping, modo: "separado" })}
                    className={`flex-1 py-1.5 rounded-md text-sm ${mapping.modo === "separado" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
                    Entrada y salida en columnas separadas
                  </button>
                  <button type="button" onClick={() => setMapping({ ...mapping, modo: "combinado" })}
                    className={`flex-1 py-1.5 rounded-md text-sm ${mapping.modo === "combinado" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
                    Una columna combinada (ej: &quot;E 08:07 - S 15:56&quot;)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Legajo</label>
                  <select value={mapping.legajo} onChange={(e) => setMapping({ ...mapping, legajo: e.target.value })} className="input">
                    <option value="">-</option>
                    {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Fecha</label>
                  <select value={mapping.fecha} onChange={(e) => setMapping({ ...mapping, fecha: e.target.value })} className="input">
                    <option value="">-</option>
                    {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>

                {mapping.modo === "combinado" ? (
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Marcaciones (entrada y salida juntas)</label>
                    <select value={mapping.marcaciones} onChange={(e) => setMapping({ ...mapping, marcaciones: e.target.value })} className="input">
                      <option value="">-</option>
                      {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Hora entrada</label>
                      <select value={mapping.horaEntrada} onChange={(e) => setMapping({ ...mapping, horaEntrada: e.target.value })} className="input">
                        <option value="">-</option>
                        {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Hora salida</label>
                      <select value={mapping.horaSalida} onChange={(e) => setMapping({ ...mapping, horaSalida: e.target.value })} className="input">
                        <option value="">-</option>
                        {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </div>

              {preview.sample[0] && mapping.modo === "combinado" && mapping.marcaciones && (
                <p className="text-xs text-gray-400 mb-3">Ejemplo de la primera fila: &quot;{String(preview.sample[0][mapping.marcaciones])}&quot;</p>
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
                <p className="text-gray-500">{importResult.reemplazados} fichadas de días ya cargados se actualizaron con los datos nuevos del archivo.</p>
              )}
              {importResult.errores.length > 0 && (
                <details className="mt-2">
                  <summary className="text-red-600 cursor-pointer">{importResult.errores.length} filas con error</summary>
                  <ul className="mt-1 text-gray-500 max-h-40 overflow-auto">
                    {importResult.errores.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-medium text-gray-700 mb-3">Carga manual</h2>
          <form onSubmit={crearManual} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Empleado</label>
              <select required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="input">
                <option value="">Seleccionar...</option>
                {empleados.map((e) => <option key={e.id} value={e.id}>{e.legajo} - {e.apellido}, {e.nombre}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Fecha</label>
                <input type="date" required value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className="input" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Entrada</label>
                <input type="time" required value={form.horaEntrada} onChange={(e) => setForm({ ...form, horaEntrada: e.target.value })} className="input" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Salida</label>
                <input type="time" value={form.horaSalida} onChange={(e) => setForm({ ...form, horaSalida: e.target.value })} className="input" />
              </div>
            </div>
            <button type="submit" disabled={guardandoManual} className="btn-primary disabled:opacity-50">
              {guardandoManual ? "Guardando..." : "Guardar fichada"}
            </button>
          </form>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-gray-700">Últimas fichadas</h2>
          <a href="/api/rrhh/fichadas/export" className="text-sm text-blue-600 hover:underline">Exportar</a>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Legajo</th>
              <th className="pb-2">Empleado</th>
              <th className="pb-2">Fecha</th>
              <th className="pb-2">Entrada</th>
              <th className="pb-2">Salida</th>
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
                <td className="py-2">{f.origen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
