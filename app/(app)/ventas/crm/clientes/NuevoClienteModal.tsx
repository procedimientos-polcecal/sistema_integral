"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { ESTADOS_DE_CLIENTE } from "@/lib/ventas/crm/formato";
import type { Cliente } from "./FichaDeCliente";

/**
 * Dar de alta un cliente o un prospecto.
 *
 * ── LO ÚNICO OBLIGATORIO ES LA RAZÓN SOCIAL ─────────────────
 *
 * A propósito, y es la decisión que hace que este formulario se use: un
 * prospecto nace de un llamado en el que lo único que quedó claro es el nombre
 * de la empresa. Pedirle CUIT y localidad a quien está anotando eso termina en
 * que no lo anota en ningún lado, que es el estado actual.
 *
 * ── EL AVISO DEL CUIT SE MUESTRA Y NO FRENA ─────────────────
 *
 * La ruta nunca rechaza un CUIT: lo que no cierra se guarda como vino y vuelve
 * con un aviso. Acá ese aviso se muestra **después** de haber guardado, porque
 * el cliente ya está creado y lo que queda es ir a corregirlo. Tratarlo como
 * error borraría la carga por un dígito.
 */

interface Props {
  usuarios: { id: string; nombre: string; activo: boolean }[];
  esAdmin: boolean;
  onCerrar: () => void;
  onCreado: (cliente: Cliente) => void;
}

export default function NuevoClienteModal({ usuarios, esAdmin, onCerrar, onCreado }: Props) {
  const [razonSocial, setRazonSocial] = useState("");
  const [nombreFantasia, setNombreFantasia] = useState("");
  const [cuit, setCuit] = useState("");
  const [estado, setEstado] = useState("prospecto");
  const [vendedorId, setVendedorId] = useState("");
  const [localidad, setLocalidad] = useState("");
  const [provincia, setProvincia] = useState("");
  const [rubro, setRubro] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [origen, setOrigen] = useState("");
  const [notas, setNotas] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);

    try {
      const r = await fetch("/api/ventas/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          razon_social: razonSocial,
          nombre_fantasia: nombreFantasia,
          cuit,
          estado,
          // Sólo si es admin: la ruta contesta 403 si un `edicion` manda el
          // campo, aunque venga vacío. Mandarlo siempre haría que el alta
          // falle para quien justamente tiene que poder cargar clientes.
          ...(esAdmin && vendedorId ? { vendedor_id: vendedorId } : {}),
          localidad,
          provincia,
          rubro,
          telefono,
          email,
          origen,
          notas,
        }),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(cuerpo.error ?? `El servidor contestó ${r.status}`);

      // El alta devuelve lo mínimo; el resto ya lo tenemos tipeado acá, así que
      // la fila entra completa en la lista sin pedir la ficha de nuevo.
      onCreado({
        id: cuerpo.cliente.id,
        numero: cuerpo.cliente.numero,
        razon_social: cuerpo.cliente.razon_social,
        nombre_fantasia: nombreFantasia || null,
        cuit: cuit || null,
        estado,
        vendedor_id: esAdmin && vendedorId ? vendedorId : null,
        localidad: localidad || null,
        provincia: provincia || null,
        rubro: rubro || null,
        telefono: telefono || null,
        email: email || null,
        sitio_web: null,
        origen: origen || null,
        notas: notas || null,
      });

      if (cuerpo.aviso) window.alert(cuerpo.aviso);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <form
        onSubmit={guardar}
        className="card my-8 w-full max-w-2xl space-y-4 p-5"
        style={{ background: "var(--surface, #fff)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Nuevo cliente</h2>
            <p className="text-sm text-slate-500">
              Alcanza con la razón social. Lo demás se completa cuando se sepa.
            </p>
          </div>
          <button type="button" onClick={onCerrar} className="btn-ghost text-sm">
            Cerrar
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="razon" className="mb-1 block text-xs font-medium text-slate-600">
              Razón social *
            </label>
            <input
              id="razon"
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              required
              className="input"
            />
          </div>

          <Campo id="fantasia" etiqueta="Nombre de fantasía" valor={nombreFantasia} set={setNombreFantasia} />
          <Campo id="cuit" etiqueta="CUIT" valor={cuit} set={setCuit} placeholder="30-71044963-1" />

          <div>
            <label htmlFor="estado-nuevo" className="mb-1 block text-xs font-medium text-slate-600">
              Estado
            </label>
            <Select
              id="estado-nuevo"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              className="input"
            >
              {ESTADOS_DE_CLIENTE.map((e) => (
                <option key={e.clave} value={e.clave}>
                  {e.nombre}
                </option>
              ))}
            </Select>
          </div>

          {esAdmin && (
            <div>
              <label htmlFor="vendedor" className="mb-1 block text-xs font-medium text-slate-600">
                Quién lo atiende
              </label>
              <Select
                id="vendedor"
                value={vendedorId}
                onChange={(e) => setVendedorId(e.target.value)}
                className="input"
              >
                <option value="">Sin asignar</option>
                {usuarios
                  .filter((u) => u.activo)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                    </option>
                  ))}
              </Select>
            </div>
          )}

          <Campo id="localidad" etiqueta="Localidad" valor={localidad} set={setLocalidad} />
          <Campo id="provincia" etiqueta="Provincia" valor={provincia} set={setProvincia} />
          <Campo id="rubro" etiqueta="Rubro" valor={rubro} set={setRubro} />
          <Campo id="telefono" etiqueta="Teléfono" valor={telefono} set={setTelefono} />
          <Campo id="email" etiqueta="Correo" valor={email} set={setEmail} tipo="email" />
          <Campo
            id="origen"
            etiqueta="De dónde salió"
            valor={origen}
            set={setOrigen}
            placeholder="Referido, feria, llamó…"
          />

          <div className="sm:col-span-2">
            <label htmlFor="notas" className="mb-1 block text-xs font-medium text-slate-600">
              Notas
            </label>
            <textarea
              id="notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              className="input"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="btn-secondary text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className="btn-primary text-sm">
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Un campo de texto con su rótulo. Diez copias de esto eran nueve de más. */
function Campo({
  id,
  etiqueta,
  valor,
  set,
  tipo = "text",
  placeholder,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  set: (v: string) => void;
  tipo?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {etiqueta}
      </label>
      <input
        id={id}
        type={tipo}
        value={valor}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className="input"
      />
    </div>
  );
}
