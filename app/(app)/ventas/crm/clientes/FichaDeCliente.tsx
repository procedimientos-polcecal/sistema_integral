"use client";

import { useCallback, useState } from "react";
import { useConfirm } from "@/components/ConfirmProvider";
import { useCargar } from "@/lib/core/useCargar";
import Select from "@/components/Select";
import { etapaDe, ETAPAS_ABIERTAS } from "@/lib/ventas/crm/etapas";
import {
  ESTADOS_DE_CLIENTE,
  TIPOS_DE_ACTIVIDAD,
  comoFecha,
  comoMonto,
  comoToneladas,
  estadoDeCliente,
  nombreDelTipo,
} from "@/lib/ventas/crm/formato";

/**
 * La ficha de un cliente: quién es, con quién se habla, qué se le está
 * vendiendo y todo lo que se habló.
 *
 * ── EL HISTORIAL VA PRIMERO Y COMPLETO ──────────────────────
 *
 * Es lo que hace que el CRM valga algo seis meses después, y lo que alguien
 * abre antes de levantar el teléfono. Las oportunidades y los contactos están
 * arriba porque son cortos; lo que ocupa la pantalla es la conversación.
 *
 * ── LA FICHA SE PIDE AL ABRIRLA Y NO VIENE CON LA LISTA ─────
 *
 * La lista trae 300 clientes con seis columnas; traer además sus contactos,
 * oportunidades y actividades sería traer todo el módulo para mostrar una fila.
 * Al abrir se pide `/api/ventas/clientes/<id>`, que devuelve las cuatro cosas
 * en un solo viaje.
 *
 * ── DESPUÉS DE GUARDAR SE VUELVE A PEDIR ────────────────────
 *
 * Con `useCargar`, que descarta las respuestas que llegan tarde. Es lo que
 * evita que al cargar dos actividades seguidas la respuesta de la primera
 * repinte la lista sin la segunda.
 */

export interface Cliente {
  id: string;
  numero: number;
  razon_social: string;
  nombre_fantasia: string | null;
  cuit: string | null;
  estado: string;
  vendedor_id: string | null;
  localidad: string | null;
  provincia: string | null;
  rubro: string | null;
  telefono: string | null;
  email: string | null;
  sitio_web: string | null;
  origen: string | null;
  notas: string | null;
}

interface Contacto {
  id: string;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  email: string | null;
  es_principal: boolean;
  activo: boolean;
  notas: string | null;
}

interface Oportunidad {
  id: string;
  numero: number;
  titulo: string;
  producto_id: string | null;
  toneladas_estimadas: number | null;
  monto_estimado: number | null;
  moneda: string;
  etapa: string;
  vendedor_id: string | null;
  fecha_estimada_cierre: string | null;
  cerrada_el: string | null;
  motivo_perdida: string | null;
  notas: string | null;
}

interface Actividad {
  id: string;
  contacto_id: string | null;
  oportunidad_id: string | null;
  tipo: string;
  fecha: string;
  resumen: string;
  proximo_paso: string | null;
  proximo_paso_el: string | null;
  cumplido_el: string | null;
  hecha_por: string | null;
  creada_en: string;
}

interface Props {
  cliente: Cliente;
  usuarios: { id: string; nombre: string; activo: boolean }[];
  productos: { id: string; nombre: string }[];
  hoy: string;
  puedeEditar: boolean;
  esAdmin: boolean;
  onCerrar: () => void;
  onGuardado: (cliente: Cliente) => void;
  onBorrado: (id: string) => void;
}

export default function FichaDeCliente({
  cliente,
  usuarios,
  productos,
  hoy,
  puedeEditar,
  esAdmin,
  onCerrar,
  onGuardado,
  onBorrado,
}: Props) {
  const confirmar = useConfirm();

  const [contactos, setContactos] = useState<Contacto[] | null>(null);
  const [oportunidades, setOportunidades] = useState<Oportunidad[] | null>(null);
  const [actividades, setActividades] = useState<Actividad[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);

  const recargar = useCargar(
    async (vigente) => {
      try {
        const r = await fetch(`/api/ventas/clientes/${cliente.id}`);
        const cuerpo = await r.json().catch(() => ({}));
        if (!vigente()) return;
        if (!r.ok) throw new Error(cuerpo.error ?? `El servidor contestó ${r.status}`);
        setContactos(cuerpo.contactos);
        setOportunidades(cuerpo.oportunidades);
        setActividades(cuerpo.actividades);
        setError(null);
      } catch (e) {
        if (!vigente()) return;
        setError(`No se pudo leer la ficha: ${(e as Error).message}`);
      }
    },
    [cliente.id]
  );

  const nombreDelUsuario = useCallback(
    (id: string | null) => (id ? (usuarios.find((u) => u.id === id)?.nombre ?? "") : ""),
    [usuarios]
  );

  async function borrar() {
    const cuantas = [
      contactos ? `${contactos.length} contactos` : null,
      oportunidades ? `${oportunidades.length} oportunidades` : null,
      actividades ? `${actividades.length} actividades` : null,
    ]
      .filter(Boolean)
      .join(", ");

    // Qué se lleva la cascada va **en la pregunta**: un borrado que no dice qué
    // se lleva es cómo se pierde un año de trabajo con un clic.
    const ok = await confirmar({
      title: "Borrar cliente",
      message:
        `¿Borrar «${cliente.razon_social}»? Se van también sus ${cuantas}. ` +
        `No se puede deshacer, y queda registrado quién lo hizo.`,
      confirmText: "Borrar",
      danger: true,
    });
    if (!ok) return;

    try {
      const r = await fetch(`/api/ventas/clientes/${cliente.id}`, { method: "DELETE" });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(cuerpo.error ?? `El servidor contestó ${r.status}`);
      onBorrado(cliente.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const suEstado = estadoDeCliente(cliente.estado);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="card my-8 w-full max-w-3xl space-y-5 p-5" style={{ background: "var(--surface, #fff)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-lg font-bold text-slate-900">{cliente.razon_social}</h2>
              {suEstado && (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{ background: `${suEstado.color}1A`, color: suEstado.color }}
                >
                  {suEstado.nombre}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {[
                cliente.nombre_fantasia,
                cliente.cuit,
                [cliente.localidad, cliente.provincia].filter(Boolean).join(", "),
                cliente.rubro,
                cliente.telefono,
                cliente.email,
                cliente.vendedor_id ? `Atiende: ${nombreDelUsuario(cliente.vendedor_id)}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Sin más datos cargados."}
            </p>
            {cliente.notas && <p className="mt-1 text-sm text-slate-700">{cliente.notas}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            {puedeEditar && (
              <button type="button" onClick={() => setEditando((v) => !v)} className="btn-secondary text-sm">
                {editando ? "Dejar de editar" : "Editar"}
              </button>
            )}
            <button type="button" onClick={onCerrar} className="btn-ghost text-sm">
              Cerrar
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {editando && (
          <FormularioDeCliente
            cliente={cliente}
            usuarios={usuarios}
            esAdmin={esAdmin}
            onGuardado={(c) => {
              onGuardado(c);
              setEditando(false);
            }}
            onError={setError}
          />
        )}

        <Seccion titulo="Contactos" cantidad={contactos?.length}>
          {contactos === null ? (
            <Cargando />
          ) : (
            <>
              {contactos.length === 0 ? (
                <p className="text-sm text-slate-400">Todavía no hay contactos cargados.</p>
              ) : (
                <ul className="space-y-1.5">
                  {contactos.map((c) => (
                    <li key={c.id} className="text-sm">
                      <span className={c.activo ? "font-medium text-slate-900" : "text-slate-400 line-through"}>
                        {c.nombre}
                      </span>
                      {c.es_principal && (
                        <span className="ml-1.5 text-xs font-semibold text-emerald-700">principal</span>
                      )}
                      <span className="text-slate-500">
                        {[c.cargo, c.telefono, c.email].filter(Boolean).length > 0
                          ? ` · ${[c.cargo, c.telefono, c.email].filter(Boolean).join(" · ")}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {puedeEditar && (
                <NuevoContacto clienteId={cliente.id} onCreado={recargar} onError={setError} />
              )}
            </>
          )}
        </Seccion>

        <Seccion titulo="Oportunidades" cantidad={oportunidades?.length}>
          {oportunidades === null ? (
            <Cargando />
          ) : (
            <>
              {oportunidades.length === 0 ? (
                <p className="text-sm text-slate-400">Todavía no hay oportunidades abiertas.</p>
              ) : (
                <ul className="space-y-2">
                  {oportunidades.map((o) => {
                    const etapa = etapaDe(o.etapa);
                    return (
                      <li key={o.id} className="rounded-lg border border-slate-200 p-2.5">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-xs text-slate-400">N° {o.numero}</span>
                          <span className="font-medium text-slate-900">{o.titulo}</span>
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-semibold"
                            style={{
                              background: `${etapa?.color ?? "#64748B"}1A`,
                              color: etapa?.color ?? "#64748B",
                            }}
                          >
                            {etapa?.nombre ?? o.etapa}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {o.monto_estimado != null
                            ? comoMonto(o.monto_estimado, o.moneda === "USD" ? "USD" : "ARS")
                            : "sin monto"}
                          {" · "}
                          {comoToneladas(o.toneladas_estimadas)}
                          {o.fecha_estimada_cierre
                            ? ` · cierre estimado ${comoFecha(o.fecha_estimada_cierre)}`
                            : ""}
                          {o.motivo_perdida ? ` · perdida: ${o.motivo_perdida}` : ""}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {puedeEditar && (
                <NuevaOportunidad
                  clienteId={cliente.id}
                  productos={productos}
                  onCreada={recargar}
                  onError={setError}
                />
              )}
            </>
          )}
        </Seccion>

        <Seccion titulo="Lo que se habló" cantidad={actividades?.length}>
          {actividades === null ? (
            <Cargando />
          ) : (
            <>
              {puedeEditar && (
                <NuevaActividad
                  clienteId={cliente.id}
                  contactos={contactos ?? []}
                  oportunidades={oportunidades ?? []}
                  hoy={hoy}
                  onCreada={recargar}
                  onError={setError}
                />
              )}
              {actividades.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Todavía no se registró ninguna conversación con este cliente.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {actividades.map((a) => (
                    <li key={a.id} className="border-l-2 border-slate-200 pl-3">
                      <div className="text-xs text-slate-500">
                        {comoFecha(a.fecha)} · {nombreDelTipo(a.tipo)}
                        {a.hecha_por ? ` · ${nombreDelUsuario(a.hecha_por)}` : ""}
                      </div>
                      <p className="text-sm text-slate-800">{a.resumen}</p>
                      {a.proximo_paso && (
                        <p
                          className="mt-0.5 text-xs"
                          style={{
                            color: a.cumplido_el
                              ? "#64748B"
                              : (a.proximo_paso_el ?? "") < hoy
                                ? "#B91C1C"
                                : "#B45309",
                          }}
                        >
                          {a.cumplido_el ? "✓ " : "→ "}
                          {a.proximo_paso} ({comoFecha(a.proximo_paso_el)}
                          {a.cumplido_el ? `, hecho el ${comoFecha(a.cumplido_el)}` : ""})
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Seccion>

        {esAdmin && (
          <div className="border-t border-slate-200 pt-3">
            <button type="button" onClick={() => void borrar()} className="btn-danger text-sm">
              Borrar cliente
            </button>
            <p className="mt-1 text-xs text-slate-500">
              Se lleva sus contactos, sus oportunidades y todo su historial. Si dejó de comprar,
              lo que corresponde es marcarlo como inactivo.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Seccion({
  titulo,
  cantidad,
  children,
}: {
  titulo: string;
  cantidad?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
        {titulo}
        {cantidad != null && <span className="ml-1.5 font-normal text-slate-400">{cantidad}</span>}
      </h3>
      {children}
    </section>
  );
}

function Cargando() {
  return <p className="text-sm text-slate-400">Cargando…</p>;
}

// ── Corregir el cliente ─────────────────────────────────────

function FormularioDeCliente({
  cliente,
  usuarios,
  esAdmin,
  onGuardado,
  onError,
}: {
  cliente: Cliente;
  usuarios: { id: string; nombre: string; activo: boolean }[];
  esAdmin: boolean;
  onGuardado: (c: Cliente) => void;
  onError: (e: string | null) => void;
}) {
  const [campos, setCampos] = useState(cliente);
  const [guardando, setGuardando] = useState(false);

  function set<K extends keyof Cliente>(campo: K, valor: Cliente[K]) {
    setCampos((previos) => ({ ...previos, [campo]: valor }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setGuardando(true);
    try {
      const cuerpo: Record<string, unknown> = {
        razon_social: campos.razon_social,
        nombre_fantasia: campos.nombre_fantasia ?? "",
        cuit: campos.cuit ?? "",
        estado: campos.estado,
        localidad: campos.localidad ?? "",
        provincia: campos.provincia ?? "",
        rubro: campos.rubro ?? "",
        telefono: campos.telefono ?? "",
        email: campos.email ?? "",
        sitio_web: campos.sitio_web ?? "",
        origen: campos.origen ?? "",
        notas: campos.notas ?? "",
      };
      // El vendedor sólo si es admin: la ruta contesta 403 si viene de otro, y
      // mandarlo siempre haría que un `edicion` no pueda corregir nada.
      if (esAdmin) cuerpo.vendedor_id = campos.vendedor_id;

      const r = await fetch(`/api/ventas/clientes/${cliente.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const respuesta = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(respuesta.error ?? `El servidor contestó ${r.status}`);
      if (respuesta.aviso) window.alert(respuesta.aviso);
      onGuardado(campos);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-3 rounded-lg bg-slate-50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Rotulo htmlFor="f-razon">Razón social *</Rotulo>
          <input
            id="f-razon"
            value={campos.razon_social}
            onChange={(e) => set("razon_social", e.target.value)}
            required
            className="input"
          />
        </div>
        <TextoEditable id="f-fantasia" etiqueta="Nombre de fantasía" valor={campos.nombre_fantasia} set={(v) => set("nombre_fantasia", v)} />
        <TextoEditable id="f-cuit" etiqueta="CUIT" valor={campos.cuit} set={(v) => set("cuit", v)} />
        <div>
          <Rotulo htmlFor="f-estado">Estado</Rotulo>
          <Select id="f-estado" value={campos.estado} onChange={(e) => set("estado", e.target.value)} className="input">
            {ESTADOS_DE_CLIENTE.map((e) => (
              <option key={e.clave} value={e.clave}>
                {e.nombre}
              </option>
            ))}
          </Select>
        </div>
        {esAdmin && (
          <div>
            <Rotulo htmlFor="f-vendedor">Quién lo atiende</Rotulo>
            <Select
              id="f-vendedor"
              value={campos.vendedor_id ?? ""}
              onChange={(e) => set("vendedor_id", e.target.value || null)}
              className="input"
            >
              <option value="">Sin asignar</option>
              {usuarios
                .filter((u) => u.activo || u.id === campos.vendedor_id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
            </Select>
          </div>
        )}
        <TextoEditable id="f-localidad" etiqueta="Localidad" valor={campos.localidad} set={(v) => set("localidad", v)} />
        <TextoEditable id="f-provincia" etiqueta="Provincia" valor={campos.provincia} set={(v) => set("provincia", v)} />
        <TextoEditable id="f-rubro" etiqueta="Rubro" valor={campos.rubro} set={(v) => set("rubro", v)} />
        <TextoEditable id="f-telefono" etiqueta="Teléfono" valor={campos.telefono} set={(v) => set("telefono", v)} />
        <TextoEditable id="f-email" etiqueta="Correo" valor={campos.email} set={(v) => set("email", v)} tipo="email" />
        <TextoEditable id="f-origen" etiqueta="De dónde salió" valor={campos.origen} set={(v) => set("origen", v)} />
        <div className="sm:col-span-2">
          <Rotulo htmlFor="f-notas">Notas</Rotulo>
          <textarea
            id="f-notas"
            value={campos.notas ?? ""}
            onChange={(e) => set("notas", e.target.value)}
            rows={2}
            className="input"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={guardando} className="btn-primary text-sm">
          {guardando ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}

function Rotulo({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-600">
      {children}
    </label>
  );
}

function TextoEditable({
  id,
  etiqueta,
  valor,
  set,
  tipo = "text",
}: {
  id: string;
  etiqueta: string;
  valor: string | null;
  set: (v: string) => void;
  tipo?: string;
}) {
  return (
    <div>
      <Rotulo htmlFor={id}>{etiqueta}</Rotulo>
      <input id={id} type={tipo} value={valor ?? ""} onChange={(e) => set(e.target.value)} className="input" />
    </div>
  );
}

// ── Agregar un contacto ─────────────────────────────────────

function NuevoContacto({
  clienteId,
  onCreado,
  onError,
}: {
  clienteId: string;
  onCreado: () => void;
  onError: (e: string | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [cargo, setCargo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [principal, setPrincipal] = useState(false);
  const [guardando, setGuardando] = useState(false);

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="btn-ghost text-sm">
        + Agregar contacto
      </button>
    );
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setGuardando(true);
    try {
      const r = await fetch("/api/ventas/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          nombre,
          cargo,
          telefono,
          email,
          es_principal: principal,
        }),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(cuerpo.error ?? `El servidor contestó ${r.status}`);
      setNombre("");
      setCargo("");
      setTelefono("");
      setEmail("");
      setPrincipal(false);
      setAbierto(false);
      onCreado();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre *" required className="input" />
        <input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Cargo" className="input" />
        <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Teléfono" className="input" />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" className="input" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={principal} onChange={(e) => setPrincipal(e.target.checked)} className="h-4 w-4" />
          Es el contacto principal
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setAbierto(false)} className="btn-secondary text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className="btn-primary text-sm">
            {guardando ? "Guardando…" : "Agregar"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ── Abrir una oportunidad ───────────────────────────────────

function NuevaOportunidad({
  clienteId,
  productos,
  onCreada,
  onError,
}: {
  clienteId: string;
  productos: { id: string; nombre: string }[];
  onCreada: () => void;
  onError: (e: string | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [productoId, setProductoId] = useState("");
  const [toneladas, setToneladas] = useState("");
  const [monto, setMonto] = useState("");
  const [moneda, setMoneda] = useState("ARS");
  const [etapa, setEtapa] = useState("contacto_inicial");
  const [cierre, setCierre] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="btn-ghost text-sm">
        + Abrir oportunidad
      </button>
    );
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setGuardando(true);
    try {
      const r = await fetch("/api/ventas/oportunidades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          titulo,
          producto_id: productoId || null,
          // Vacío es null y no cero: «no se sabe cuántas toneladas» y «son cero
          // toneladas» son cosas distintas, y el embudo las cuenta distinto.
          toneladas_estimadas: toneladas === "" ? null : Number(toneladas),
          monto_estimado: monto === "" ? null : Number(monto),
          moneda,
          etapa,
          fecha_estimada_cierre: cierre || null,
        }),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(cuerpo.error ?? `El servidor contestó ${r.status}`);
      setTitulo("");
      setProductoId("");
      setToneladas("");
      setMonto("");
      setCierre("");
      setAbierto(false);
      onCreada();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-2 rounded-lg bg-slate-50 p-3">
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="Qué se le quiere vender *"
        required
        className="input"
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select value={productoId} onChange={(e) => setProductoId(e.target.value)} className="input" aria-label="Producto">
          <option value="">Sin producto definido</option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </Select>
        <Select value={etapa} onChange={(e) => setEtapa(e.target.value)} className="input" aria-label="Etapa">
          {ETAPAS_ABIERTAS.map((e) => (
            <option key={e.clave} value={e.clave}>
              {e.nombre}
            </option>
          ))}
        </Select>
        <input
          type="number"
          min="0"
          step="0.1"
          value={toneladas}
          onChange={(e) => setToneladas(e.target.value)}
          placeholder="Toneladas"
          className="input"
        />
        {/* El ancho va en el div que envuelve, no en el input: `.input`
            declara `width: 100%` fuera de toda capa y le gana a cualquier
            `w-*` que se le ponga al lado. Ver CLAUDE.md. */}
        <div className="flex gap-2">
          <input
            type="number"
            min="0"
            step="0.01"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="Monto estimado"
            className="input"
          />
          <div className="w-24 shrink-0">
            <Select value={moneda} onChange={(e) => setMoneda(e.target.value)} className="input" aria-label="Moneda">
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </Select>
          </div>
        </div>
        <div className="sm:col-span-2">
          <Rotulo htmlFor="o-cierre">Cierre estimado</Rotulo>
          <input id="o-cierre" type="date" value={cierre} onChange={(e) => setCierre(e.target.value)} className="input" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setAbierto(false)} className="btn-secondary text-sm">
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className="btn-primary text-sm">
          {guardando ? "Guardando…" : "Abrir"}
        </button>
      </div>
    </form>
  );
}

// ── Registrar una conversación ──────────────────────────────

function NuevaActividad({
  clienteId,
  contactos,
  oportunidades,
  hoy,
  onCreada,
  onError,
}: {
  clienteId: string;
  contactos: Contacto[];
  oportunidades: Oportunidad[];
  hoy: string;
  onCreada: () => void;
  onError: (e: string | null) => void;
}) {
  const [tipo, setTipo] = useState("llamado");
  const [fecha, setFecha] = useState(hoy);
  const [resumen, setResumen] = useState("");
  const [contactoId, setContactoId] = useState("");
  const [oportunidadId, setOportunidadId] = useState("");
  const [proximoPaso, setProximoPaso] = useState("");
  const [proximoPasoEl, setProximoPasoEl] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setGuardando(true);
    try {
      const r = await fetch("/api/ventas/actividades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          contacto_id: contactoId || null,
          oportunidad_id: oportunidadId || null,
          tipo,
          fecha,
          resumen,
          proximo_paso: proximoPaso,
          proximo_paso_el: proximoPasoEl || null,
        }),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(cuerpo.error ?? `El servidor contestó ${r.status}`);
      setResumen("");
      setProximoPaso("");
      setProximoPasoEl("");
      onCreada();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select value={tipo} onChange={(e) => setTipo(e.target.value)} className="input" aria-label="Tipo">
          {TIPOS_DE_ACTIVIDAD.map((t) => (
            <option key={t.clave} value={t.clave}>
              {t.nombre}
            </option>
          ))}
        </Select>
        {/* La fecha se tipea y no la pone el servidor: la visita se registra a
            la mañana siguiente. Ver la migración. */}
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="input" aria-label="Fecha" />
        {contactos.length > 0 && (
          <Select value={contactoId} onChange={(e) => setContactoId(e.target.value)} className="input" aria-label="Con quién">
            <option value="">Con quién (opcional)</option>
            {contactos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        )}
        {oportunidades.length > 0 && (
          <Select
            value={oportunidadId}
            onChange={(e) => setOportunidadId(e.target.value)}
            className="input"
            aria-label="Oportunidad"
          >
            <option value="">Sobre qué oportunidad (opcional)</option>
            {oportunidades.map((o) => (
              <option key={o.id} value={o.id}>
                N° {o.numero} · {o.titulo}
              </option>
            ))}
          </Select>
        )}
      </div>

      <textarea
        value={resumen}
        onChange={(e) => setResumen(e.target.value)}
        placeholder="Qué se habló *"
        required
        rows={2}
        className="input"
      />

      {/* Los dos juntos o ninguno: la ruta y la tabla lo exigen, y es lo único
          de este formulario que genera trabajo para alguien. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <input
          value={proximoPaso}
          onChange={(e) => setProximoPaso(e.target.value)}
          placeholder="Próximo paso (opcional)"
          className="input"
        />
        <input
          type="date"
          value={proximoPasoEl}
          onChange={(e) => setProximoPasoEl(e.target.value)}
          className="input"
          aria-label="Para cuándo"
        />
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={guardando} className="btn-primary text-sm">
          {guardando ? "Guardando…" : "Registrar"}
        </button>
      </div>
    </form>
  );
}
