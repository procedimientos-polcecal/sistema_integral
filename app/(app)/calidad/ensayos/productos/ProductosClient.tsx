"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/Select";
import { mallasDesdeTexto } from "@/lib/calidad/ensayos/mallas";
import type { GrupoDeProducto, ProductoDeEnsayo } from "@/lib/calidad/ensayos/types";

/**
 * Los productos que se muestrean.
 *
 * **Esta lista no es el catálogo del núcleo**, y la pantalla lo dice en el
 * encabezado para que nadie intente enlazarlos: "Filler 1" y "Filler 2" son el
 * mismo material visto en dos líneas, y "Despacho a Emapi" es un destino. Un
 * enlace equivocado acá haría que el ensayo de una línea aparezca como el de la
 * otra, y eso no se nota nunca.
 */
export default function ProductosClient({ productos }: { productos: ProductoDeEnsayo[] }) {
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const [grupo, setGrupo] = useState<GrupoDeProducto>("proceso");
  const [mallas, setMallas] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [mallasEditadas, setMallasEditadas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function agregar() {
    setError(null);
    const parseadas = mallasDesdeTexto(mallas);
    if (parseadas.problema) return setError(parseadas.problema);

    setGuardando(true);
    const res = await fetch("/api/calidad/ensayos/productos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, grupo, mallas: parseadas.mallas }),
    });
    setGuardando(false);

    if (!res.ok) return setError((await res.json()).error ?? "No se pudo guardar.");
    setNombre("");
    setMallas("");
    router.refresh();
  }

  async function guardarMallas(id: string) {
    setError(null);
    const parseadas = mallasDesdeTexto(mallasEditadas);
    if (parseadas.problema) return setError(parseadas.problema);

    setGuardando(true);
    const res = await fetch("/api/calidad/ensayos/productos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, mallas: parseadas.mallas }),
    });
    setGuardando(false);

    if (!res.ok) return setError((await res.json()).error ?? "No se pudo guardar.");
    setEditando(null);
    router.refresh();
  }

  async function cambiarActivo(id: string, activo: boolean) {
    await fetch("/api/calidad/ensayos/productos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, activo }),
    });
    router.refresh();
  }

  function grupoDe(g: GrupoDeProducto) {
    return productos.filter((p) => p.grupo === g);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Productos de ensayo</h1>
        <p className="text-sm text-slate-500">
          Lo que el laboratorio muestrea, y el juego de tamices que la pantalla de carga propone.
          No es el catálogo de productos del sistema: acá <em>Filler 1</em> y <em>Filler 2</em> son
          el mismo material en dos líneas.
        </p>
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {(["produccion", "proceso"] as const).map((g) => (
        <section key={g} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {g === "produccion" ? "De producción" : "De proceso"}
          </h2>

          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {grupoDe(g).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                <span
                  className={`flex-1 text-sm ${p.activo ? "text-slate-900" : "text-slate-400 line-through"}`}
                >
                  {p.nombre}
                </span>

                {editando === p.id ? (
                  <>
                    <input
                      value={mallasEditadas}
                      onChange={(e) => setMallasEditadas(e.target.value)}
                      placeholder="50, 100, 200, 325"
                      inputMode="numeric"
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm sm:w-56"
                    />
                    <button
                      onClick={() => guardarMallas(p.id)}
                      disabled={guardando}
                      className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => setEditando(null)}
                      className="text-sm text-slate-500 underline"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    {p.mallas.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {p.mallas.map((m) => (
                          <span
                            key={m}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
                          >
                            #{m}
                          </span>
                        ))}
                      </span>
                    ) : (
                      // Visible y no silencioso: es el estado en que nacen los
                      // diez productos de proceso.
                      <span className="text-xs italic text-slate-400">sin juego habitual</span>
                    )}
                    <button
                      onClick={() => {
                        setEditando(p.id);
                        setMallasEditadas(p.mallas.join(", "));
                      }}
                      className="text-sm text-slate-600 underline"
                    >
                      Tamices
                    </button>
                    <button
                      onClick={() => cambiarActivo(p.id, !p.activo)}
                      className="text-sm text-slate-400 underline"
                    >
                      {p.activo ? "Desactivar" : "Activar"}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
        <h2 className="text-sm font-semibold text-slate-700">Agregar un producto</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre"
            className="rounded border border-slate-300 px-2 py-1 text-sm sm:col-span-2"
          />
          <Select
            value={grupo}
            onChange={(e) => setGrupo(e.target.value as GrupoDeProducto)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="produccion">De producción</option>
            <option value="proceso">De proceso</option>
          </Select>
          <input
            value={mallas}
            onChange={(e) => setMallas(e.target.value)}
            placeholder="Tamices: 50, 100, 200"
            inputMode="numeric"
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <button
          onClick={agregar}
          disabled={guardando || !nombre.trim()}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Agregar
        </button>
      </section>
    </div>
  );
}
