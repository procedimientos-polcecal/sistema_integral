"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";
import { sectoresQueElLibroCrearia } from "@/lib/mantenimiento/inventario";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  OPERATIVO:          { label: "Operativo",        color: "bg-green-100 text-green-800" },
  EN_MANTENIMIENTO:   { label: "En mantenimiento", color: "bg-blue-100 text-blue-800" },
  EN_REPARACION:      { label: "En reparación",    color: "bg-red-100 text-red-800" },
  STANDBY:            { label: "Standby",           color: "bg-yellow-100 text-yellow-800" },
  FUERA_DE_SERVICIO:  { label: "Fuera de servicio", color: "bg-gray-100 text-gray-600" },
  DADO_DE_BAJA:       { label: "Dado de baja",      color: "bg-slate-100 text-slate-500" },
};

const CRITICALITY_LABELS: Record<string, string> = {
  ALTA:  "text-red-600 font-semibold",
  MEDIA: "text-yellow-600",
  BAJA:  "text-gray-400",
};

export default function EquiposClient({ empresas, sectores, equipos, canEdit }: {
  empresas: any[];
  sectores: any[];
  equipos: any[];
  canEdit?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filterEmpresa, setFilterEmpresa] = useState("");
  const [filterSector, setFilterSector] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const confirmar = useConfirm();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<
    { updated: number; created: number; errors: string[]; extra?: string } | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const router = useRouter();

  const filteredSectores = useMemo(() =>
    filterEmpresa ? sectores.filter((s: any) => s.empresas?.nombre === filterEmpresa) : sectores,
    [sectores, filterEmpresa]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return equipos.filter((e: any) => {
      if (filterEmpresa && e.sectores?.empresas?.nombre !== filterEmpresa) return false;
      if (filterSector && e.sectores?.nombre !== filterSector) return false;
      if (filterStatus && e.status !== filterStatus) return false;
      if (q && !e.name.toLowerCase().includes(q) && !e.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [equipos, filterEmpresa, filterSector, filterStatus, search]);

  // ─── Export ───────────────────────────────────────────────────────────────
  // El Excel lo arma el servidor. Antes se armaba acá, y eso obligaba a traer
  // `xlsx` al navegador —unos 400 KB— para todo el que abriera esta pantalla,
  // exportara o no. Se le mandan las filas ya filtradas: los filtros son de la
  // UI y duplicarlos del otro lado sería asegurar que alguna vez diverjan.
  const [exportando, setExportando] = useState(false);
  async function exportExcel() {
    setExportando(true);
    try {
      const filas = filtered.map((e: any) => ({
        codigo: e.code,
        nombre: e.name,
        empresa: e.sectores?.empresas?.nombre ?? "",
        sector: e.sectores?.nombre ?? "",
        kw: e.power_kw ?? "",
        estado: e.status,
        criticidad: e.criticality,
        descripcion: e.description ?? "",
        notas: e.notes ?? "",
      }));

      const res = await fetch("/api/mantenimiento/equipos/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filas }),
      });
      if (!res.ok) throw new Error(`El servidor devolvió ${res.status}`);

      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `equipos_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`No se pudo exportar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExportando(false);
    }
  }

  // ─── Import ───────────────────────────────────────────────────────────────
  /**
   * Qué sectores traería este libro que hoy no existen.
   *
   * Se mira el archivo antes de subirlo porque la importación los crea sin
   * preguntar: reconoce los sectores por código y da de alta los que no
   * encuentra. Eso deshizo una fusión hecha a mano —los despachos de filler— y
   * nadie se enteró hasta ver los equipos en otro lado.
   *
   * Si el archivo no se puede leer acá, no se bloquea la importación: el
   * servidor la va a rechazar con un mensaje mejor que el que se puede dar
   * desde el navegador.
   */
  async function sectoresNuevosDelArchivo(file: File) {
    try {
      // `xlsx` se carga acá y no arriba: son ~400 KB que sólo hacen falta
      // cuando alguien realmente elige un archivo para importar. Importado de
      // forma estática lo pagaba todo el que abría la pantalla.
      const XLSX = await import("xlsx");
      const libro = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const hoja = (nombre: string) =>
        libro.Sheets[nombre]
          ? (XLSX.utils.sheet_to_json(libro.Sheets[nombre]) as Record<string, unknown>[])
          : [];

      // Sólo el libro BD Equipos trae sectores. La planilla plana no puede
      // crear ninguno, así que no hay de qué avisar.
      const sectores_ = hoja("SECTORES");
      if (sectores_.length === 0) return [];

      return sectoresQueElLibroCrearia(
        sectores_,
        hoja("EQUIPOS"),
        sectores.map((s: any) => s.codigo)
      );
    } catch {
      return [];
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const nuevos = await sectoresNuevosDelArchivo(file);
    if (nuevos.length > 0) {
      const lista = nuevos
        .map((s) => `• ${s.codigo} «${s.nombre}»` + (s.equipos ? ` — se lleva ${s.equipos} equipos` : ""))
        .join("\n");

      const seguir = await confirmar({
        title:
          nuevos.length === 1
            ? "El libro trae un sector que no existe"
            : `El libro trae ${nuevos.length} sectores que no existen`,
        message:
          `Importar este archivo los va a crear:\n\n${lista}\n\n` +
          "Si alguno lo uniste a otro a propósito, corregilo en el libro antes " +
          "de importar: si no, vuelve a aparecer y se lleva sus equipos con él.",
        confirmText: "Importar igual",
        danger: true,
      });
      if (!seguir) return;
    }

    setImporting(true);
    setImportResult(null);

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/mantenimiento/equipos/import", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) {
        setImportResult({ updated: 0, created: 0, errors: [data.error ?? "Error al importar"] });
        return;
      }

      // El importador acepta dos formatos y cuenta cosas distintas en cada uno:
      // del libro salen además sectores, tipos y componentes.
      setImportResult({
        created: data.equipos_nuevos ?? 0,
        updated: data.equipos_actualizados ?? 0,
        errors: [
          ...(data.errores ?? []),
          ...(data.sin_sector?.length > 0
            ? [`Sin sector en el libro, quedaron afuera: ${data.sin_sector.join(", ")}`]
            : []),
          ...(data.sin_tipo?.length > 0
            ? [`Con un tipo que no está en el catálogo, se cargaron sin él: ${data.sin_tipo.join(", ")}`]
            : []),
        ],
        extra:
          data.formato === "libro"
            ? [
                data.sectores > 0 && `${data.sectores} sectores de planta`,
                data.tipos > 0 && `${data.tipos} tipos de equipo`,
                data.componentes > 0 && `${data.componentes} componentes`,
              ].filter(Boolean).join(", ")
            : "",
      });
      if ((data.equipos_nuevos ?? 0) > 0 || (data.equipos_actualizados ?? 0) > 0) router.refresh();
    } catch {
      setImportResult({ updated: 0, created: 0, errors: ["Error de red al importar"] });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          Equipos
          <InfoTip text="Inventario de todos los equipos industriales de las plantas, con su estado, criticidad, sector y potencia. Podés buscarlos, filtrarlos, importarlos desde Excel y entrar a cada uno para ver su detalle e historial." />
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500 mr-1">{filtered.length} de {equipos.length}</span>

          <button
            onClick={exportExcel}
            disabled={exportando}
            className="flex items-center gap-1.5 rounded-lg border border-green-600 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exportando ? "Generando..." : "Exportar Excel"}
          </button>

          {canEdit && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-1.5 rounded-lg border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
                </svg>
                {importing ? "Importando..." : "Importar equipos"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImport}
              />
            </>
          )}
        </div>
      </div>


      {importResult && (
        <div className={`rounded-xl border px-4 py-3 text-sm space-y-1 ${
          importResult.errors.length > 0
            ? "border-red-200 bg-red-50"
            : "border-green-200 bg-green-50"
        }`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {importResult.created > 0 && `${importResult.created} equipo(s) creados. `}
              {importResult.updated > 0 && `${importResult.updated} equipo(s) actualizados. `}
              {importResult.extra && `Además: ${importResult.extra}. `}
              {importResult.errors.length > 0 && `${importResult.errors.length} error(es).`}
            </span>
            <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
          </div>
          {importResult.errors.length > 0 && (
            <ul className="list-disc list-inside text-red-700 space-y-0.5">
              {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input
          type="text"
          placeholder="Buscar nombre o código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="col-span-2 md:col-span-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={filterEmpresa}
          onChange={(e) => { setFilterEmpresa(e.target.value); setFilterSector(""); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todas las empresas</option>
          {empresas.map((p: any) => (
            <option key={p.id} value={p.nombre}>{p.nombre}</option>
          ))}
        </select>
        <select
          value={filterSector}
          onChange={(e) => setFilterSector(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todos los sectores</option>
          {filteredSectores.map((s: any) => (
            <option key={s.id} value={s.nombre}>{s.nombre}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Código</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Equipo</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Empresa</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Sector</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">kW</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Criticidad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((e: any) => {
              const st = STATUS_LABELS[e.status] ?? { label: e.status, color: "bg-gray-100 text-gray-600" };
              return (
                <tr key={e.id} onClick={() => router.push(`/mantenimiento/equipos/${e.id}`)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{e.code}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {e.name}
                    {e.description && (
                      <p className="text-xs text-gray-400 font-normal truncate max-w-xs">{e.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{e.sectores?.empresas?.nombre ?? "Transversal"}</td>
                  <td className="px-4 py-3 text-gray-600">{e.sectores?.nombre}</td>
                  <td className="px-4 py-3 text-gray-500">{e.power_kw ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-xs ${CRITICALITY_LABELS[e.criticality] ?? ""}`}>
                    {e.criticality}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">Sin resultados.</div>
        )}
      </div>

      <div className="md:hidden space-y-2">
        {filtered.map((e: any) => {
          const st = STATUS_LABELS[e.status] ?? { label: e.status, color: "bg-gray-100 text-gray-600" };
          return (
            <div key={e.id} onClick={() => router.push(`/mantenimiento/equipos/${e.id}`)} className="rounded-xl border border-gray-200 bg-white p-4 space-y-1 cursor-pointer active:bg-gray-50">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-900">{e.name}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${st.color}`}>
                  {st.label}
                </span>
              </div>
              <div className="text-xs text-gray-500 font-mono">{e.code}</div>
              <div className="text-xs text-gray-500">{e.sectores?.empresas?.nombre ?? "Transversal"} · {e.sectores?.nombre}</div>
              {e.description && (
                <div className="text-xs text-gray-400 line-clamp-2">{e.description}</div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-400">Sin resultados.</div>
        )}
      </div>
    </div>
  );
}
