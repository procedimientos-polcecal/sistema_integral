"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";

interface Empleado {
  id: string;
  legajo: string;
  nombre: string;
  apellido: string;
  fecha_ingreso: string;
  valor_hora_normal: number;
  horas_teoricas_diarias: number;
  activo: boolean;
  empresas: any;
  sectores: any;
  rrhh_empleados_datos: any;
}

interface Empresa {
  id: string;
  nombre: string;
}

interface Sector {
  id: string;
  nombre: string;
  activo: boolean;
}

interface PreviewResult {
  token: string;
  sheetNames: string[];
  sheet: string;
  headers: string[];
  sample: Record<string, unknown>[];
  totalRows: number;
}

const MAPPING_FIELDS = [
  ["legajo", "Legajo"],
  ["nombre", "Nombre"],
  ["apellido", "Apellido"],
  ["sindicato", "Sindicato (opcional)"],
  ["valorHoraNormal", "Valor hora normal"],
  ["fechaIngreso", "Fecha de ingreso"],
  ["empresa", "Empresa (opcional)"],
  ["sector", "Sector (opcional)"],
  ["horasTeoricasDiarias", "Horas teóricas diarias (opcional)"],
  ["fechaNacimiento", "Fecha de nacimiento (opcional)"],
  ["genero", "Género (opcional)"],
] as const;

const EMPTY_FORM = {
  legajo: "",
  nombre: "",
  apellido: "",
  sindicato: "",
  fechaIngreso: "",
  valorHoraNormal: "",
  horasTeoricasDiarias: "8",
  modalidadPago: "JORNAL",
  empresaId: "",
  sectorId: "",
};

export default function EmpleadosClient({ empleados, empresas, sectores, canEdit }: {
  empleados: Empleado[];
  empresas: Empresa[];
  sectores: Sector[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const confirmar = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const empleadosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return empleados.filter((e) => {
      if (!mostrarInactivos && !e.activo) return false;
      if (!q) return true;
      return e.legajo.toLowerCase().includes(q) || e.nombre.toLowerCase().includes(q) || e.apellido.toLowerCase().includes(q);
    });
  }, [empleados, busqueda, mostrarInactivos]);

  const [form, setForm] = useState({ ...EMPTY_FORM });

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/rrhh/empleados", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        sindicato: form.sindicato || null,
        valorHoraNormal: Number(form.valorHoraNormal),
        horasTeoricasDiarias: Number(form.horasTeoricasDiarias),
        sectorId: form.sectorId || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Error al guardar"); setSaving(false); return; }
    setSaving(false);
    setShowForm(false);
    setForm({ ...EMPTY_FORM });
    router.refresh();
  }

  // --- import masivo ---
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState({
    legajo: "", nombre: "", apellido: "", sindicato: "", valorHoraNormal: "",
    fechaIngreso: "", empresa: "", sector: "", horasTeoricasDiarias: "", fechaNacimiento: "", genero: "",
  });
  const [importResult, setImportResult] = useState<{
    creados: number;
    actualizados: number;
    errores: string[];
    /** Los que la planilla nombra y el catálogo no reconoce. Ver más abajo. */
    sectoresSinReconocer?: { nombre: string; filas: number; motivo: string }[];
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  function guessMapping(headers: string[]) {
    const guess = (needle: string) => headers.find((h) => h.toLowerCase().includes(needle)) ?? "";
    return {
      legajo: guess("legajo"), nombre: guess("nombre"), apellido: guess("apellido"),
      sindicato: guess("sindicato"), valorHoraNormal: guess("hora"), fechaIngreso: guess("ingreso"),
      empresa: guess("empresa"), sector: guess("sector"), horasTeoricasDiarias: guess("teoric"),
      fechaNacimiento: guess("nacimiento"), genero: guess("genero") || guess("género") || guess("sexo"),
    };
  }

  async function handleFile(file: File) {
    setImporting(true);
    setImportError("");
    setImportResult(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/rrhh/empleados/import/preview", { method: "POST", body: fd });
    const data = await res.json();
    setImporting(false);
    if (!res.ok) { setImportError(data.error ?? "No se pudo leer el archivo"); return; }
    setPreview(data);
    setMapping(guessMapping(data.headers));
  }

  async function cambiarHoja(sheet: string) {
    if (!preview) return;
    const res = await fetch("/api/rrhh/empleados/import/preview-sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      message: `Se van a crear o actualizar hasta ${preview.totalRows} empleados desde la planilla. Los que ya existan (por legajo) se actualizan. ¿Confirmás?`,
      confirmText: "Importar",
    });
    if (!ok) return;
    setImporting(true);
    setImportError("");
    const res = await fetch("/api/rrhh/empleados/import/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: preview.token, sheet: preview.sheet, mapping }),
    });
    const data = await res.json();
    setImporting(false);
    if (!res.ok) { setImportError(data.error ?? "No se pudo importar el archivo"); return; }
    setImportResult(data);
    setPreview(null);
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          Empleados
          <InfoTip text="Los operarios/trabajadores de la empresa (no confundir con los usuarios que entran al sistema). Podés cargarlos uno por uno o importar una planilla. Cada empleado tiene su legajo, valor hora, sector y empresa." />
        </h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={mostrarInactivos} onChange={(e) => setMostrarInactivos(e.target.checked)} />
            Mostrar inactivos
          </label>
          {canEdit && (
            <div className="flex gap-2">
              <button
                onClick={() => { setShowImport((v) => !v); setShowForm(false); }}
                className="bg-white border border-gray-300 text-gray-700 text-sm px-4 py-2 rounded-md hover:bg-gray-50"
              >
                {showImport ? "Cancelar" : "Importar planilla"}
              </button>
              <button
                onClick={() => { setShowForm((v) => !v); setShowImport(false); }}
                className="btn-primary"
              >
                {showForm ? "Cancelar" : "+ Nuevo empleado"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="relative mb-6 max-w-sm">
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por legajo o nombre..."
          className="input"
        />
      </div>

      {showImport && (
        <div className="card p-5 mb-6">
          <h2 className="font-medium text-gray-700 mb-1 flex items-center gap-1.5">
            Importar planilla de empleados
            <InfoTip text="Subís un Excel/CSV con una fila por empleado y decís qué columna es cada dato (legajo, nombre, valor hora, etc.). Si el legajo ya existe se actualizan sus datos; si no, se crea. La empresa/sector se crean solos si no existían." />
          </h2>
          <p className="text-sm text-gray-500 mb-3">
            Subí un Excel/CSV con una fila por empleado. Columnas necesarias: Legajo, Nombre, Apellido y Valor
            hora normal. Sindicato, Sector, horas teóricas diarias, fecha de nacimiento y género son opcionales.
            Si el legajo ya existe, se actualizan sus datos.
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            className="text-sm mb-3"
          />
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
              <div className="grid grid-cols-3 gap-3 mb-3">
                {MAPPING_FIELDS.map(([field, label]) => (
                  <div key={field}>
                    <label className="block text-xs text-gray-500 mb-1">{label}</label>
                    <select
                      value={mapping[field]}
                      onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                      className="input"
                    >
                      <option value="">-</option>
                      {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {!mapping.fechaIngreso && (
                <p className="text-xs text-amber-600 mb-3">
                  No mapeaste fecha de ingreso: se va a usar la fecha de hoy como provisoria y podés corregirla
                  después en la ficha de cada empleado.
                </p>
              )}
              <button
                onClick={confirmarImport}
                disabled={!mapping.legajo || !mapping.nombre || !mapping.apellido || !mapping.valorHoraNormal || importing}
                className="btn-primary disabled:opacity-50"
              >
                {importing ? "Importando..." : "Confirmar importación"}
              </button>
            </div>
          )}

          {importResult && (
            <div className="mt-4 text-sm">
              <p className="text-green-700">
                {importResult.creados} empleados creados, {importResult.actualizados} actualizados.
              </p>
              {importResult.errores.length > 0 && (
                <details className="mt-2">
                  <summary className="text-amber-600 cursor-pointer">{importResult.errores.length} filas con observaciones</summary>
                  <ul className="mt-1 text-gray-500 max-h-40 overflow-auto">
                    {importResult.errores.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}

              {/* Antes esto no se veía porque no pasaba: el sector que no
                  existía se creaba solo. Ahora el empleado se importa sin
                  sector y hay que decir cuáles, con el nombre tal como lo
                  escribió la planilla — si no, el dato falta y nadie sabe. */}
              {importResult.sectoresSinReconocer && importResult.sectoresSinReconocer.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-amber-800">
                    {importResult.sectoresSinReconocer.length === 1
                      ? "Un sector de la planilla no está en el sistema"
                      : `${importResult.sectoresSinReconocer.length} sectores de la planilla no están en el sistema`}
                    . Esos empleados quedaron sin sector; los demás datos se importaron.
                  </p>
                  <ul className="mt-1 text-amber-900">
                    {importResult.sectoresSinReconocer.map((s) => (
                      <li key={s.nombre}>
                        «{s.nombre}» — {s.filas} {s.filas === 1 ? "empleado" : "empleados"}
                        {s.motivo === "ambiguo" && " (hay más de un sector con ese nombre)"}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-amber-700">
                    Corregí el nombre en el Excel y volvé a importar, o dalo de alta en
                    Administración → Empresas y sectores y asigná el sector desde la ficha.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <form onSubmit={crear} className="card p-5 mb-6 grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Legajo</label>
            <input required value={form.legajo} onChange={(e) => setForm({ ...form, legajo: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Nombre</label>
            <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Apellido</label>
            <input required value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Sindicato</label>
            <input value={form.sindicato} onChange={(e) => setForm({ ...form, sindicato: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Fecha de ingreso</label>
            <input type="date" required value={form.fechaIngreso} onChange={(e) => setForm({ ...form, fechaIngreso: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Valor hora normal ($)</label>
            <input type="number" step="0.01" required value={form.valorHoraNormal} onChange={(e) => setForm({ ...form, valorHoraNormal: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Horas teóricas diarias</label>
            <input type="number" step="0.5" required value={form.horasTeoricasDiarias} onChange={(e) => setForm({ ...form, horasTeoricasDiarias: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Modalidad de pago</label>
            <select value={form.modalidadPago} onChange={(e) => setForm({ ...form, modalidadPago: e.target.value })} className="input">
              <option value="JORNAL">Jornal</option>
              <option value="MENSUAL">Mensual</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Empresa</label>
            <select required value={form.empresaId} onChange={(e) => setForm({ ...form, empresaId: e.target.value })} className="input">
              <option value="">Seleccionar...</option>
              {empresas.map((emp) => <option key={emp.id} value={emp.id}>{emp.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Sector</label>
            <select value={form.sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })} className="input">
              <option value="">Sin asignar</option>
              {sectores.filter((s) => s.activo).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          {error && <p className="col-span-3 text-sm text-red-600">{error}</p>}
          <div className="col-span-3">
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      )}

      <div className="card p-5">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Legajo</th>
              <th className="pb-2">Nombre</th>
              <th className="pb-2">Sindicato</th>
              <th className="pb-2">Empresa</th>
              <th className="pb-2">Sector</th>
              <th className="pb-2">Valor hora</th>
              <th className="pb-2">Ingreso</th>
            </tr>
          </thead>
          <tbody>
            {empleadosFiltrados.map((e) => (
              <tr key={e.id} className={`border-b last:border-0 ${!e.activo ? "opacity-50" : ""}`}>
                <td className="py-2">{e.legajo}</td>
                <td className="py-2">
                  <Link href={`/rrhh/empleados/${e.id}`} className="text-gray-700 hover:underline">
                    {e.apellido}, {e.nombre}
                  </Link>
                  {!e.activo && <span className="ml-2 text-xs text-red-600">(inactivo)</span>}
                </td>
                <td className="py-2">{e.rrhh_empleados_datos?.sindicato ?? "-"}</td>
                <td className="py-2">{e.empresas?.nombre ?? "-"}</td>
                <td className="py-2">{e.sectores?.nombre ?? "-"}</td>
                <td className="py-2">${Number(e.valor_hora_normal).toLocaleString("es-AR")}</td>
                <td className="py-2">{new Date(e.fecha_ingreso).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
              </tr>
            ))}
            {empleadosFiltrados.length === 0 && (
              <tr><td colSpan={7} className="py-4 text-center text-gray-400">No se encontraron empleados</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
