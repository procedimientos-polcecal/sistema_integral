"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Configuración de Mantenimiento: las listas de las que come el módulo.
 *
 * Los operarios y los contratistas se cargan acá para que al registrar una
 * orden de trabajo se elijan de una lista en vez de escribirse. Escribirlos
 * cada vez es cómo terminan "Candia" y "CANDIA" siendo dos personas distintas.
 */

interface Operario { id: string; slot: number; nombre: string }
interface Contratista { id: string; nombre: string; cuit: string | null; activo: boolean }
interface Tipo {
  tipo_id: string;
  categoria: string | null;
  nombre_tipo: string | null;
  lubricante_tipo: string | null;
  frecuencia_lubricacion: string | null;
}
interface Sector { id: string; codigo: string | null; nombre: string; empresa: string | null }

/** Las tres columnas de operario que tiene la orden de trabajo. */
const SLOTS = [1, 2, 3];

export default function ConfiguracionClient({
  operarios, contratistas, tipos, sectores, esAdmin, puedeEditar,
}: {
  operarios: Operario[];
  contratistas: Contratista[];
  tipos: Tipo[];
  sectores: Sector[];
  esAdmin: boolean;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function llamar(url: string, opciones: RequestInit) {
    setError("");
    const res = await fetch(url, opciones);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo guardar.");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Configuración</h1>
        <p className="text-sm text-slate-500">
          Las listas de las que come el módulo. Cargarlas acá es lo que evita que cada orden de
          trabajo invente un nombre nuevo.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <Operarios operarios={operarios} esAdmin={esAdmin} llamar={llamar} />

      <Contratistas contratistas={contratistas} puedeEditar={puedeEditar} llamar={llamar} />

      <ProveedoresSueltos puedeEditar={puedeEditar} />

      <TiposDeEquipo tipos={tipos} />

      <SectoresDePlanta sectores={sectores} />

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Lo que se administra en otro lado</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <Acceso
            href="/mantenimiento/equipos"
            titulo="Equipos"
            que="El padrón de máquinas y su ficha técnica. Se importa del libro BD Equipos."
          />
          <Acceso
            href="/compras/proveedores"
            titulo="Proveedores"
            que="La ficha completa —CUIT, contacto, rubro—. Es la misma lista que usa Compras."
          />
          <Acceso
            href="/administracion/usuarios"
            titulo="Usuarios"
            que="Quién entra al sistema y con qué permisos en cada módulo."
          />
        </div>
      </div>
    </div>
  );
}

function Operarios({
  operarios, esAdmin, llamar,
}: {
  operarios: Operario[];
  esAdmin: boolean;
  llamar: (url: string, o: RequestInit) => Promise<boolean>;
}) {
  const [nombre, setNombre] = useState("");
  const [slot, setSlot] = useState(1);
  const [guardando, setGuardando] = useState(false);

  async function sumar() {
    if (!nombre.trim()) return;
    setGuardando(true);
    const ok = await llamar("/api/mantenimiento/operarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: nombre.trim(), slot }),
    });
    setGuardando(false);
    if (ok) setNombre("");
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">
        Operarios
        <span className="ml-2 text-xs font-normal text-slate-400">{operarios.length}</span>
      </h2>
      <p className="mb-3 mt-0.5 text-xs text-slate-500">
        La orden de trabajo tiene tres columnas de operario y cada una tiene su propia lista.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        {SLOTS.map((s) => {
          const suyos = operarios.filter((o) => o.slot === s);
          return (
            <div key={s}>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">
                Operario {s}
              </h3>
              {suyos.length === 0 ? (
                <p className="py-2 text-xs text-slate-300">Sin nadie</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {suyos.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <span className="text-slate-800">{o.nombre}</span>
                      {esAdmin && (
                        <button
                          onClick={() =>
                            llamar(`/api/mantenimiento/operarios?id=${o.id}`, { method: "DELETE" })
                          }
                          className="text-xs text-slate-400 hover:text-red-600"
                          title="Sacar de la lista"
                        >×</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {esAdmin && (
        <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre"
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <select
            value={slot}
            onChange={(e) => setSlot(Number(e.target.value))}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {SLOTS.map((s) => <option key={s} value={s}>Operario {s}</option>)}
          </select>
          <button
            onClick={sumar}
            disabled={guardando || !nombre.trim()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >Sumar</button>
        </div>
      )}
    </div>
  );
}

function Contratistas({
  contratistas, puedeEditar, llamar,
}: {
  contratistas: Contratista[];
  puedeEditar: boolean;
  llamar: (url: string, o: RequestInit) => Promise<boolean>;
}) {
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function sumar() {
    if (!nombre.trim()) return;
    setGuardando(true);
    const ok = await llamar("/api/mantenimiento/proveedores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombres: [nombre.trim()] }),
    });
    setGuardando(false);
    if (ok) setNombre("");
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">
        Contratistas
        <span className="ml-2 text-xs font-normal text-slate-400">{contratistas.length}</span>
      </h2>
      <p className="mb-3 mt-0.5 text-xs text-slate-500">
        Quienes prestan servicios. Son proveedores del SdG, los mismos que ve Compras: sacar a uno
        de acá no lo borra, sólo le quita la marca de que también hace trabajos.
      </p>

      {contratistas.length === 0 ? (
        <p className="py-3 text-sm text-slate-400">
          Todavía no hay ninguno. Aparecen solos al sincronizar las órdenes, o se cargan acá.
        </p>
      ) : (
        <ul className="grid gap-x-4 sm:grid-cols-2">
          {contratistas.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-sm">
              <span className="text-slate-800">
                {c.nombre}
                {!c.activo && <span className="ml-1 text-xs text-slate-400">(inactivo)</span>}
              </span>
              {puedeEditar && (
                <button
                  onClick={() =>
                    llamar(`/api/mantenimiento/proveedores?id=${c.id}`, { method: "DELETE" })
                  }
                  className="text-xs text-slate-400 hover:text-red-600"
                  title="Sacar de la lista de contratistas"
                >×</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {puedeEditar && (
        <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre del contratista"
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            onClick={sumar}
            disabled={guardando || !nombre.trim()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >Sumar</button>
        </div>
      )}
    </div>
  );
}

/**
 * Los proveedores que las órdenes nombran y la lista no tiene.
 *
 * Mientras no estén, ese trabajo no se puede cruzar entre Compras y
 * Mantenimiento: la orden dice quién lo hizo pero el sistema no sabe quién es.
 */
function ProveedoresSueltos({ puedeEditar }: { puedeEditar: boolean }) {
  const [nombres, setNombres] = useState<string[]>([]);
  const [parecidos, setParecidos] = useState<string[][]>([]);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [hecho, setHecho] = useState("");
  const [error, setError] = useState("");

  const traer = useCallback(async () => {
    setCargando(true);
    const res = await fetch("/api/mantenimiento/proveedores/sueltos");
    setCargando(false);
    if (!res.ok) { setError("No se pudo consultar."); return; }

    const body = await res.json();
    setNombres(body.nombres ?? []);
    setParecidos(body.parecidos ?? []);
  }, []);

  useEffect(() => { traer(); }, [traer]);

  async function resolver(sumar: boolean) {
    setTrabajando(true);
    setError("");

    const res = await fetch("/api/mantenimiento/proveedores/sueltos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sumar }),
    });
    const body = await res.json().catch(() => ({}));
    setTrabajando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo."); return; }

    const total = Object.values(body.enlazados ?? {}).reduce((a: number, b) => a + Number(b), 0);
    setHecho(
      [
        body.creados > 0 && `Se sumaron ${body.creados} proveedores.`,
        `Quedaron enlazados ${total} registros.`,
      ].filter(Boolean).join(" ")
    );
    traer();
  }

  if (cargando) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">
        Proveedores sin reconocer
        <span className="ml-2 text-xs font-normal text-slate-400">{nombres.length}</span>
      </h2>
      <p className="mb-3 mt-0.5 text-xs text-slate-500">
        Nombres que aparecen en las órdenes de trabajo, las de servicio o las comparativas y no
        están en la lista de proveedores. Hasta que estén, ese trabajo no se puede cruzar con
        Compras.
      </p>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {hecho && <p className="mb-2 text-sm font-semibold text-emerald-700">{hecho}</p>}

      {nombres.length === 0 ? (
        <p className="py-2 text-sm text-slate-400">
          Están todos reconocidos.
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-600">{nombres.join(" · ")}</p>

          {parecidos.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-semibold">
                Estos parecen el mismo escrito de dos formas — conviene unificarlos en la planilla
                antes de sumarlos, porque después hay que fusionar dos fichas:
              </p>
              <ul className="mt-1 space-y-0.5">
                {parecidos.map((g) => <li key={g[0]}>· {g.join("  =  ")}</li>)}
              </ul>
            </div>
          )}

          {puedeEditar && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => resolver(true)}
                disabled={trabajando}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {trabajando ? "Trabajando…" : "Sumarlos y enlazar todo"}
              </button>
              <button
                onClick={() => resolver(false)}
                disabled={trabajando}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Sólo enlazar los que ya están
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TiposDeEquipo({ tipos }: { tipos: Tipo[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">
        Tipos de equipo
        <span className="ml-2 text-xs font-normal text-slate-400">{tipos.length}</span>
      </h2>
      <p className="mb-3 mt-0.5 text-xs text-slate-500">
        El catálogo del libro BD Equipos: qué lleva cada clase de máquina. Se carga importando el
        libro, no a mano.
      </p>

      {tipos.length === 0 ? (
        <p className="py-3 text-sm text-slate-400">
          Todavía no se importó el libro.{" "}
          <Link href="/mantenimiento/equipos" className="text-blue-600 hover:underline">
            Importarlo desde Equipos
          </Link>.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-1.5 text-left">Código</th>
                <th className="px-2 py-1.5 text-left">Tipo</th>
                <th className="px-2 py-1.5 text-left">Categoría</th>
                <th className="px-2 py-1.5 text-left">Lubricante</th>
                <th className="px-2 py-1.5 text-left">Cada cuánto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tipos.map((t) => (
                <tr key={t.tipo_id}>
                  <td className="px-2 py-1.5 font-mono text-xs text-slate-500">{t.tipo_id}</td>
                  <td className="px-2 py-1.5 text-slate-800">{t.nombre_tipo ?? "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{t.categoria ?? "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{t.lubricante_tipo ?? "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{t.frecuencia_lubricacion ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SectoresDePlanta({ sectores }: { sectores: Sector[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">
        Sectores de planta
        <span className="ml-2 text-xs font-normal text-slate-400">{sectores.length}</span>
      </h2>
      <p className="mb-3 mt-0.5 text-xs text-slate-500">
        Dónde está una máquina, que no es lo mismo que dónde trabaja una persona: los sectores
        de RRHH son otros y no se mezclan. Vienen del libro BD Equipos.
      </p>

      {sectores.length === 0 ? (
        <p className="py-3 text-sm text-slate-400">
          Todavía no se importó el libro.{" "}
          <Link href="/mantenimiento/equipos" className="text-blue-600 hover:underline">
            Importarlo desde Equipos
          </Link>.
        </p>
      ) : (
        <ul className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          {sectores.map((s) => (
            <li key={s.id} className="border-b border-slate-100 py-1.5 text-sm">
              <span className="font-mono text-xs text-slate-400">{s.codigo ?? "—"}</span>{" "}
              <span className="text-slate-800">{s.nombre}</span>
              <span className="ml-1 text-xs text-slate-400">
                {s.empresa ?? "las dos empresas"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Acceso({ href, titulo, que }: { href: string; titulo: string; que: string }) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-slate-200 px-3 py-2 hover:border-slate-300 hover:bg-slate-50"
    >
      <span className="block text-sm font-semibold text-slate-900">{titulo}</span>
      <span className="block text-xs text-slate-500">{que}</span>
    </Link>
  );
}
