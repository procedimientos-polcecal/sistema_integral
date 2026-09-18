"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PlantaDB } from "@/lib/trituracion/consultas";

export default function PlantasClient({ plantas }: { plantas: PlantaDB[] }) {
  const router = useRouter();
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cambiar(id: string, cambios: { nombre?: string; activa?: boolean }) {
    setGuardando(id);
    setError(null);
    try {
      const res = await fetch("/api/trituracion/plantas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...cambios }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/trituracion" className="text-xs text-slate-500 underline">← Trituración</Link>
      <h1 className="page-header mt-1">Plantas</h1>
      <p className="page-subheader">
        El código es el número de la pestaña en la planilla ("PLANTA {"{"}código{"}"}"); no se edita acá.
      </p>

      <div className="card mt-4 divide-y divide-slate-100">
        {plantas.map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3">
            <span className="w-10 text-sm text-slate-400">#{p.codigo}</span>
            <input
              className="input flex-1"
              defaultValue={p.nombre}
              onBlur={(e) => e.target.value !== p.nombre && cambiar(p.id, { nombre: e.target.value })}
            />
            <label className="flex items-center gap-1 text-sm text-slate-600">
              <input
                type="checkbox" checked={p.activa} disabled={guardando === p.id}
                onChange={(e) => cambiar(p.id, { activa: e.target.checked })}
              />
              Activa
            </label>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
