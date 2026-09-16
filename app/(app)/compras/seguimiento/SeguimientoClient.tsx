"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { comoLeLlego, ETIQUETA_CUMPLIO } from "@/lib/compras/seguimiento";
import { fecha } from "@/lib/compras/constants";
import FormularioRecepcion from "./FormularioRecepcion";
import type { RequerimientoConRelaciones, Cumplio } from "@/lib/compras/types";

const SIN_FILTRO = "TODAS";

/**
 * Seguimiento de la compra: qué está esperando llegar y qué ya llegó.
 *
 * La maqueta sale de `para-aprobar/BandejaClient.tsx`, la pantalla más
 * parecida: mismas tarjetas, mismos colores, mismo criterio de "abrir para
 * decidir". El juicio (`Cumplió Compras?` / `Cumplió PROV?`) lo carga la
 * persona; lo que hace `comoLeLlego()` es poner el dato duro al lado para que
 * decida mirándolo, no calcularlo por ella.
 */
export default function SeguimientoClient({
  requerimientos,
}: {
  requerimientos: RequerimientoConRelaciones[];
}) {
  const router = useRouter();
  const [solapa, setSolapa] = useState<"PEDIDO" | "RECIBIDO">("PEDIDO");
  const [area, setArea] = useState(SIN_FILTRO);
  const [proveedor, setProveedor] = useState(SIN_FILTRO);
  const [abierto, setAbierto] = useState<string | null>(null);

  const areas = useMemo(
    () => [...new Set(requerimientos.map((r) => r.compras_areas?.nombre).filter((n): n is string => !!n))].sort(),
    [requerimientos]
  );
  const proveedores = useMemo(
    () => [...new Set(requerimientos.map((r) => r.proveedores?.nombre).filter((n): n is string => !!n))].sort(),
    [requerimientos]
  );

  const filtrados = requerimientos.filter((r) => {
    if (area !== SIN_FILTRO && r.compras_areas?.nombre !== area) return false;
    if (proveedor !== SIN_FILTRO && r.proveedores?.nombre !== proveedor) return false;
    return true;
  });

  const esperando = filtrados.filter((r) => r.estado_compra === "PEDIDO");
  const recibidos = filtrados.filter((r) => r.estado_compra === "RECIBIDO");
  const visibles = solapa === "PEDIDO" ? esperando : recibidos;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Seguimiento de la compra</h1>
        <p className="text-sm text-slate-500">
          Lo que ya se compró y espera llegar, y lo que ya llegó.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-2">
          <button
            onClick={() => setSolapa("PEDIDO")}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              solapa === "PEDIDO"
                ? "bg-[var(--primary)] text-white"
                : "border border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            Esperando ({esperando.length})
          </button>
          <button
            onClick={() => setSolapa("RECIBIDO")}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              solapa === "RECIBIDO"
                ? "bg-[var(--primary)] text-white"
                : "border border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            Recibidos ({recibidos.length})
          </button>
        </nav>

        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Filtrar por área"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value={SIN_FILTRO}>Todas las áreas</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            aria-label="Filtrar por proveedor"
            value={proveedor}
            onChange={(e) => setProveedor(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value={SIN_FILTRO}>Todos los proveedores</option>
            {proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <section className="space-y-3">
        {visibles.length === 0 ? (
          <p className="text-sm text-slate-400">
            {solapa === "PEDIDO" ? "No hay compras esperando llegar." : "No hay compras recibidas."}
          </p>
        ) : (
          visibles.map((r) => (
            <Fila
              key={r.id}
              r={r}
              abierto={abierto === r.id}
              onAbrir={() => setAbierto(abierto === r.id ? null : r.id)}
              onGuardar={() => { setAbierto(null); router.refresh(); }}
            />
          ))
        )}
      </section>
    </div>
  );
}

function Fila({
  r, abierto, onAbrir, onGuardar,
}: {
  r: RequerimientoConRelaciones;
  abierto: boolean;
  onAbrir: () => void;
  onGuardar: () => void;
}) {
  const dato = comoLeLlego(r);

  return (
    <article className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/compras/requerimientos/${r.id}`}
              className="font-mono text-xs font-semibold text-[var(--primary)] hover:underline"
            >
              RI {r.nro_ri}
            </Link>
            <span className="text-xs text-slate-500">
              {r.compras_areas?.nombre ?? "Sin área"} · {r.proveedores?.nombre ?? "Sin proveedor"}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-900">{r.descripcion}</p>
          <p className="mt-1 text-xs text-slate-500">
            Pedido el {fecha(r.fecha_pedido)}
            {dato.demora && ` · ${dato.demora}`}
            {dato.cantidad && ` · ${dato.cantidad}`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Cumplió Compras: {r.cumplio_compras ? ETIQUETA_CUMPLIO[r.cumplio_compras as Cumplio] : "—"}
            {" · "}
            Cumplió el proveedor: {r.cumplio_proveedor ? ETIQUETA_CUMPLIO[r.cumplio_proveedor as Cumplio] : "—"}
          </p>
        </div>

        <button
          onClick={onAbrir}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {abierto ? "Cerrar" : "Registrar recepción"}
        </button>
      </div>

      {abierto && (
        <div className="border-t border-slate-100 px-5 py-4">
          <FormularioRecepcion requerimiento={r} alGuardar={onGuardar} />
        </div>
      )}
    </article>
  );
}
