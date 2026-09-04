"use client";

import { useMemo, useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { useConfirm } from "@/components/ConfirmProvider";
import {
  agruparSectores, loMantieneLaImportacion, type SectorAdmin,
} from "@/lib/core/sectores";

interface Empresa {
  id: string;
  nombre: string;
  activo: boolean;
}

/**
 * El catálogo de sectores, entero.
 *
 * Antes leía los sectores embebidos desde `empresas`, así que mostraba veinte
 * de treinta y nueve: los diecinueve transversales no aparecían por ningún
 * lado, y con ellos la mitad del catálogo quedaba fuera del alcance de
 * cualquiera. Corregir un nombre requería una migración.
 *
 * Muestra los organizativos —transversales primero, después los de cada
 * empresa— y al final los de planta, de sólo lectura porque los mantiene la
 * importación del libro BD Equipos.
 *
 * Cada sector dice cuántas filas del sistema le apuntan. Es el dato que faltaba
 * para poder darlo de baja sin adivinar: un sector inactivo desaparece de los
 * desplegables, y las filas que le apuntaban quedan sin forma de corregirse.
 */
export default function EmpresasSectoresManager() {
  const confirmar = useConfirm();
  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [sectores, setSectores] = useState<SectorAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editando, setEditando] = useState<string | null>(null);
  const [nombreEditado, setNombreEditado] = useState("");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoDonde, setNuevoDonde] = useState("transversal");

  const cargar = useCargar(async (vigente) => {
    const [rEmp, rSec] = await Promise.all([
      fetch("/api/administracion/empresas"),
      fetch("/api/administracion/sectores"),
    ]);
    if (!rEmp.ok || !rSec.ok) {
      if (vigente()) setError("No se pudo cargar el catálogo");
      return;
    }
    const [emp, sec] = await Promise.all([rEmp.json(), rSec.json()]);
    if (!vigente()) return;
    setEmpresas(emp);
    setSectores(sec);
  }, []);

  const grupos = useMemo(
    () => (sectores && empresas ? agruparSectores(sectores, empresas) : []),
    [sectores, empresas]
  );

  async function pedir(url: string, metodo: string, cuerpo: unknown): Promise<boolean> {
    const res = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (res.ok) {
      setError(null);
      cargar();
      return true;
    }
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? "No se pudo guardar");
    return false;
  }

  async function toggleEmpresa(e: Empresa) {
    await pedir(`/api/administracion/empresas/${e.id}`, "PUT", { activo: !e.activo });
  }

  /**
   * Dar de baja uno que se está usando esconde el problema en vez de
   * resolverlo: desaparece de los desplegables y las filas que le apuntan
   * quedan mostrando un sector que ya nadie puede elegir ni corregir.
   */
  async function toggleSector(s: SectorAdmin) {
    if (s.activo && s.usos > 0) {
      const ok = await confirmar({
        title: `Dar de baja ${s.nombre}`,
        message:
          `Hay ${s.usos.toLocaleString("es-AR")} ${s.usos === 1 ? "fila" : "filas"} apuntando a ` +
          `este sector. Al darlo de baja dejan de poder corregirse desde las pantallas: no va a ` +
          `estar en ningún desplegable. Si lo que querés es unificarlo con otro, eso se hace con ` +
          `una migración que repunte esas filas primero.`,
        confirmText: "Darlo de baja igual",
      });
      if (!ok) return;
    }
    await pedir(`/api/administracion/sectores/${s.id}`, "PUT", { activo: !s.activo });
  }

  async function guardarNombre(s: SectorAdmin) {
    const nombre = nombreEditado.trim();
    if (!nombre || nombre === s.nombre) {
      setEditando(null);
      return;
    }
    if (await pedir(`/api/administracion/sectores/${s.id}`, "PUT", { nombre })) {
      setEditando(null);
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const nombre = nuevoNombre.trim();
    if (!nombre) return;
    const ok = await pedir("/api/administracion/sectores", "POST", {
      nombre,
      transversal: nuevoDonde === "transversal",
      empresaId: nuevoDonde === "transversal" ? null : nuevoDonde,
    });
    if (ok) setNuevoNombre("");
  }

  if (!sectores || !empresas) return <p className="text-sm text-gray-500">Cargando…</p>;

  return (
    <div className="max-w-3xl space-y-4">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="card p-5">
        <h2 className="mb-3 font-medium text-gray-700">Empresas</h2>
        <ul className="space-y-1">
          {empresas.map((e) => (
            <li key={e.id} className="flex items-center justify-between text-sm text-gray-700">
              <span>{e.nombre}</span>
              <label className="flex items-center gap-2 text-gray-600">
                <input type="checkbox" checked={e.activo} onChange={() => toggleEmpresa(e)} />
                Activa
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium text-gray-700">Sectores</h2>
          <p className="text-xs text-gray-500">
            {sectores.filter((s) => s.activo).length} activos de {sectores.length}
          </p>
        </div>
        {/* La distinción no es obvia y equivocarse cuesta caro: un sector
            organizativo entre los de planta aparece en los desplegables de
            Mantenimiento al lado de "Filler 2". */}
        <p className="mb-4 text-xs text-gray-500">
          Los organizativos son dónde trabaja una persona; los de planta, dónde está una máquina.
        </p>

        <div className="space-y-5">
          {grupos.map((g) => (
            <div key={g.clave}>
              <h3 className="text-sm font-medium text-gray-800">{g.titulo}</h3>
              <p className="mb-2 text-xs text-gray-500">{g.explicacion}</p>

              {g.sectores.length === 0 ? (
                <p className="pl-3 text-sm text-gray-400">Sin sectores</p>
              ) : (
                <ul className="space-y-1">
                  {g.sectores.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-3 text-sm"
                    >
                      {editando === s.id ? (
                        <>
                          <input
                            autoFocus
                            value={nombreEditado}
                            onChange={(ev) => setNombreEditado(ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") guardarNombre(s);
                              if (ev.key === "Escape") setEditando(null);
                            }}
                            className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                          <button onClick={() => guardarNombre(s)} className="btn-ghost">
                            Guardar
                          </button>
                          <button onClick={() => setEditando(null)} className="text-xs text-gray-500 underline">
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          {s.codigo && (
                            <span className="font-mono text-xs text-gray-400">{s.codigo}</span>
                          )}
                          <span className={s.activo ? "text-gray-700" : "text-gray-400 line-through"}>
                            {s.nombre}
                          </span>
                          <span className="text-xs text-gray-400">
                            {s.usos > 0
                              ? `${s.usos.toLocaleString("es-AR")} ${s.usos === 1 ? "fila" : "filas"}`
                              : "sin uso"}
                          </span>
                          {!loMantieneLaImportacion(s) && (
                            <button
                              onClick={() => { setEditando(s.id); setNombreEditado(s.nombre); }}
                              className="text-xs text-gray-500 underline"
                            >
                              Renombrar
                            </button>
                          )}
                          <label className="ml-auto flex items-center gap-2 text-gray-600">
                            <input
                              type="checkbox"
                              checked={s.activo}
                              onChange={() => toggleSector(s)}
                            />
                            Activo
                          </label>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-medium text-gray-700">Nuevo sector</h2>
        {/* Los de planta no se crean acá: los trae la importación del libro con
            su código, y uno hecho a mano quedaría sin código y fuera de ella. */}
        <p className="mb-3 text-xs text-gray-500">
          Organizativo. Los de planta los crea la importación del libro BD Equipos.
        </p>
        <form onSubmit={crear} className="flex flex-wrap gap-2">
          <input
            placeholder="Nombre"
            value={nuevoNombre}
            onChange={(e) => setNuevoNombre(e.target.value)}
            className="min-w-40 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <select
            value={nuevoDonde}
            onChange={(e) => setNuevoDonde(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="transversal">Transversal</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>Sólo {e.nombre}</option>
            ))}
          </select>
          <button type="submit" className="btn-ghost">Agregar</button>
        </form>
      </section>
    </div>
  );
}
