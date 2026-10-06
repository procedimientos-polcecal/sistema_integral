"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/Select";
import type { Determinacion, Limite, ProductoDeEnsayo } from "@/lib/calidad/ensayos/types";

const NOMBRE: Record<Determinacion, string> = {
  humedad: "Humedad",
  peso_volumetrico: "Peso volumétrico",
  cal_util_vial: "Cal útil vial",
  retenido: "Retenido en una malla",
  acumulado: "Acumulado a una malla",
};

/** La unidad de cada límite, que es la unidad en que se muestra el resultado. */
const UNIDAD: Record<Determinacion, string> = {
  humedad: "%",
  peso_volumetrico: "g/l",
  cal_util_vial: "%",
  retenido: "%",
  acumulado: "%",
};

const LLEVA_MALLA: Determinacion[] = ["retenido", "acumulado"];

/**
 * Los límites por producto.
 *
 * **Cuando un producto no tiene ninguno, la pantalla lo dice con todas las
 * letras.** Es el estado en que nace el módulo, y la diferencia entre
 * "configurado para no avisar" y "roto" tiene que estar escrita: un listado sin
 * nada en rojo puede significar que todo salió bien o que nadie cargó un
 * límite, y esas dos cosas no se parecen en nada.
 */
export default function LimitesClient({
  productos,
  limites,
}: {
  productos: ProductoDeEnsayo[];
  limites: Limite[];
}) {
  const router = useRouter();

  const [productoId, setProductoId] = useState(productos[0]?.id ?? "");
  const [determinacion, setDeterminacion] = useState<Determinacion>("humedad");
  const [malla, setMalla] = useState("");
  const [minimo, setMinimo] = useState("");
  const [maximo, setMaximo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const producto = productos.find((p) => p.id === productoId);
  const delProducto = useMemo(
    () => limites.filter((l) => l.producto_id === productoId),
    [limites, productoId]
  );

  const llevaMalla = LLEVA_MALLA.includes(determinacion);

  async function agregar() {
    setError(null);
    setGuardando(true);
    const res = await fetch("/api/calidad/ensayos/limites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        producto_id: productoId,
        determinacion,
        malla: llevaMalla ? malla : null,
        minimo,
        maximo,
      }),
    });
    setGuardando(false);

    if (!res.ok) return setError((await res.json()).error ?? "No se pudo guardar.");
    setMalla("");
    setMinimo("");
    setMaximo("");
    router.refresh();
  }

  async function borrar(id: string) {
    await fetch("/api/calidad/ensayos/limites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Límites de ensayo</h1>
        <p className="text-sm text-slate-500">
          Una muestra fuera de límite se marca en rojo en el listado. No se bloquea ni se corrige:
          el ensayo dio lo que dio.
        </p>
      </div>

      <Select
        value={productoId}
        onChange={(e) => setProductoId(e.target.value)}
        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm sm:w-72"
      >
        {productos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </Select>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {delProducto.length === 0 ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>{producto?.nombre}</strong> no tiene límites cargados, así que ninguna muestra de
          este producto se va a marcar. No es un error: es el estado en que nace el módulo.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {delProducto.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="flex-1 text-slate-900">
                {NOMBRE[l.determinacion]}
                {l.malla !== null && <span className="text-slate-500"> · #{l.malla}</span>}
              </span>
              <span className="text-slate-600">
                {l.minimo !== null && `mín ${l.minimo}`}
                {l.minimo !== null && l.maximo !== null && " · "}
                {l.maximo !== null && `máx ${l.maximo}`}{" "}
                <span className="text-slate-400">{UNIDAD[l.determinacion]}</span>
              </span>
              <button onClick={() => borrar(l.id)} className="text-slate-400 underline">
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
        <h2 className="text-sm font-semibold text-slate-700">Agregar un límite</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Select
            value={determinacion}
            onChange={(e) => setDeterminacion(e.target.value as Determinacion)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {(Object.keys(NOMBRE) as Determinacion[]).map((d) => (
              <option key={d} value={d}>
                {NOMBRE[d]}
              </option>
            ))}
          </Select>
          <input
            value={malla}
            onChange={(e) => setMalla(e.target.value)}
            disabled={!llevaMalla}
            placeholder={llevaMalla ? "Malla" : "sin malla"}
            inputMode="numeric"
            className="rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-400"
          />
          <input
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            placeholder={`Mínimo (${UNIDAD[determinacion]})`}
            inputMode="decimal"
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <input
            value={maximo}
            onChange={(e) => setMaximo(e.target.value)}
            placeholder={`Máximo (${UNIDAD[determinacion]})`}
            inputMode="decimal"
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <p className="text-xs text-slate-500">
          Alcanza con uno de los dos. Un límite de sólo máximo controla únicamente ese lado.
        </p>
        <button
          onClick={agregar}
          disabled={guardando || !productoId}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Agregar
        </button>
      </section>
    </div>
  );
}
