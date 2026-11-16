"use client";

import { useMemo, useState } from "react";
import Select from "@/components/Select";
import {
  SEMAFORO,
  estadoDeSeguimiento,
  ultimaActividadPorCliente,
  type EstadoDeSeguimiento,
} from "@/lib/ventas/crm/seguimiento";
import { ESTADOS_DE_CLIENTE, comoFecha, estadoDeCliente } from "@/lib/ventas/crm/formato";
import FichaDeCliente, { type Cliente } from "./FichaDeCliente";
import NuevoClienteModal from "./NuevoClienteModal";
import ImportarClientesModal from "./ImportarClientesModal";

/**
 * La lista de clientes, con su semáforo, y la puerta a cada ficha.
 *
 * ── EL BUSCADOR IGNORA ACENTOS Y ACEPTA LAS PALABRAS EN CUALQUIER ORDEN ──
 *
 * Es la misma regla que el `Select` con buscador del sistema
 * (`components/desplegables.ts`), y acá hace falta por lo mismo: los nombres se
 * cargaron a mano en momentos distintos, así que «Cia» y «Cía» conviven, y
 * nadie se acuerda si la ficha dice «Cal del Valle SRL» o «SRL Cal del Valle».
 *
 * Busca también en el CUIT y en la localidad **sin acentos ni guiones**: quien
 * tiene el CUIT a mano lo tipea con guiones y la ficha lo guarda sin ellos.
 *
 * ── EL SEMÁFORO SE CALCULA ACÁ Y NO VIENE DE LA BASE ────────
 *
 * «Hace cuánto que no se toca a este cliente» sale de la fecha de la última
 * actividad, en memoria. Una columna `ultima_actividad_el` sería una segunda
 * verdad que se desincroniza en cuanto alguien corrija la fecha de una
 * actividad vieja, y nada avisaría. Ver el encabezado de la migración.
 */

interface Props {
  clientesIniciales: Cliente[];
  actividades: { cliente_id: string; fecha: string }[];
  usuarios: { id: string; nombre: string; activo: boolean }[];
  productos: { id: string; nombre: string }[];
  clienteInicial: string | null;
  seguimientoInicial: string | null;
  hoy: string;
  puedeEditar: boolean;
  esAdmin: boolean;
}

/** Sin acentos, sin puntuación y en minúsculas: para comparar lo que tipea alguien. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ES_SEGUIMIENTO = new Set<string>(["al_dia", "a_destiempo", "sin_contacto", "nunca"]);

export default function ClientesClient({
  clientesIniciales,
  actividades,
  usuarios,
  productos,
  clienteInicial,
  seguimientoInicial,
  hoy,
  puedeEditar,
  esAdmin,
}: Props) {
  const [clientes, setClientes] = useState<Cliente[]>(clientesIniciales);
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("");
  const [seguimiento, setSeguimiento] = useState(
    seguimientoInicial && ES_SEGUIMIENTO.has(seguimientoInicial) ? seguimientoInicial : ""
  );
  const [abierto, setAbierto] = useState<string | null>(clienteInicial);
  const [creando, setCreando] = useState(false);
  const [importando, setImportando] = useState(false);

  const ultima = useMemo(() => ultimaActividadPorCliente(actividades), [actividades]);

  const nombreDelUsuario = useMemo(
    () => new Map(usuarios.map((u) => [u.id, u.nombre])),
    [usuarios]
  );

  const filas = useMemo(() => {
    const palabras = normalizar(busqueda).split(" ").filter(Boolean);

    return clientes
      .map((c) => ({
        cliente: c,
        ultima: ultima.get(c.id) ?? null,
        seguimiento: estadoDeSeguimiento(ultima.get(c.id), hoy),
      }))
      .filter((f) => {
        if (estado && f.cliente.estado !== estado) return false;
        if (seguimiento && f.seguimiento !== seguimiento) return false;
        if (palabras.length === 0) return true;
        const heno = normalizar(
          [
            f.cliente.razon_social,
            f.cliente.nombre_fantasia ?? "",
            f.cliente.cuit ?? "",
            f.cliente.localidad ?? "",
            f.cliente.rubro ?? "",
          ].join(" ")
        );
        return palabras.every((p) => heno.includes(p));
      });
  }, [clientes, ultima, hoy, busqueda, estado, seguimiento]);

  const elAbierto = abierto ? (clientes.find((c) => c.id === abierto) ?? null) : null;

  function reemplazar(cliente: Cliente) {
    setClientes((previos) =>
      previos
        .map((c) => (c.id === cliente.id ? { ...c, ...cliente } : c))
        .sort((a, b) => a.razon_social.localeCompare(b.razon_social, "es"))
    );
  }

  function sacar(id: string) {
    setClientes((previos) => previos.filter((c) => c.id !== id));
    setAbierto(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500">
            {filas.length} de {clientes.length}
          </p>
        </div>
        {puedeEditar && (
          <div className="flex gap-2">
            {/* Importar va antes que «Nuevo cliente» y en secundario: es lo que
                se hace una vez, al empezar, y el alta de a uno es lo de todos
                los días. El primario tiene que ser lo frecuente. */}
            <button type="button" onClick={() => setImportando(true)} className="btn-secondary text-sm">
              Importar Excel
            </button>
            <button type="button" onClick={() => setCreando(true)} className="btn-primary text-sm">
              Nuevo cliente
            </button>
          </div>
        )}
      </div>

      {/* Tres filtros: en 343 px van uno abajo del otro. `grid-cols-3` pelado
          dejaría 114 px por columna y ahí no entra una etiqueta con su campo. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="buscar" className="mb-1 block text-xs font-medium text-slate-600">
            Buscar
          </label>
          <input
            id="buscar"
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Razón social, CUIT, localidad…"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="estado" className="mb-1 block text-xs font-medium text-slate-600">
            Estado
          </label>
          <Select id="estado" value={estado} onChange={(e) => setEstado(e.target.value)} className="input">
            <option value="">Todos</option>
            {ESTADOS_DE_CLIENTE.map((e) => (
              <option key={e.clave} value={e.clave}>
                {e.nombre}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="seguimiento" className="mb-1 block text-xs font-medium text-slate-600">
            Seguimiento
          </label>
          <Select
            id="seguimiento"
            value={seguimiento}
            onChange={(e) => setSeguimiento(e.target.value)}
            className="input"
          >
            <option value="">Todos</option>
            {(Object.keys(SEMAFORO) as EstadoDeSeguimiento[]).map((clave) => (
              <option key={clave} value={clave}>
                {SEMAFORO[clave].nombre}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {filas.length === 0 ? (
        <p className="text-sm text-slate-400">
          {clientes.length === 0
            ? "Todavía no hay ningún cliente cargado."
            : "Ningún cliente coincide con eso."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filas.map((f) => {
            const semaforo = SEMAFORO[f.seguimiento];
            const suEstado = estadoDeCliente(f.cliente.estado);
            return (
              <li key={f.cliente.id}>
                <button
                  type="button"
                  onClick={() => setAbierto(f.cliente.id)}
                  className="card w-full p-3 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-slate-900">{f.cliente.razon_social}</span>
                    {f.cliente.nombre_fantasia && (
                      <span className="text-sm text-slate-500">({f.cliente.nombre_fantasia})</span>
                    )}
                    {/* El color va por `style` y no por una clase de Tailwind:
                        `.card` declara `border` sin capa, así que un
                        `border-*` al lado no se aplica. Ver CLAUDE.md. */}
                    {suEstado && (
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ background: `${suEstado.color}1A`, color: suEstado.color }}
                      >
                        {suEstado.nombre}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: semaforo.color }}
                      />
                      {semaforo.nombre}
                      {f.ultima ? ` · última: ${comoFecha(f.ultima)}` : ""}
                    </span>
                    {f.cliente.localidad && <span>{f.cliente.localidad}</span>}
                    {f.cliente.vendedor_id && (
                      <span>{nombreDelUsuario.get(f.cliente.vendedor_id) ?? ""}</span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {elAbierto && (
        <FichaDeCliente
          cliente={elAbierto}
          usuarios={usuarios}
          productos={productos}
          hoy={hoy}
          puedeEditar={puedeEditar}
          esAdmin={esAdmin}
          onCerrar={() => setAbierto(null)}
          onGuardado={reemplazar}
          onBorrado={sacar}
        />
      )}

      {importando && <ImportarClientesModal onCerrar={() => setImportando(false)} />}

      {creando && (
        <NuevoClienteModal
          usuarios={usuarios}
          esAdmin={esAdmin}
          onCerrar={() => setCreando(false)}
          onCreado={(cliente) => {
            setClientes((previos) =>
              [...previos, cliente].sort((a, b) =>
                a.razon_social.localeCompare(b.razon_social, "es")
              )
            );
            setCreando(false);
            setAbierto(cliente.id);
          }}
        />
      )}
    </div>
  );
}
