"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ConfirmProvider";
import { MODULOS_ORDEN } from "@/lib/core/access";
import type { Modulo } from "@/lib/core/types";

type Rol = "admin_sistema" | "admin" | "encargado" | "operario";
type Nivel = "lectura" | "edicion" | "admin";

interface UsuarioModulo {
  id: string;
  modulo: Modulo;
  nivel: Nivel;
}

interface Usuario {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: Rol;
  activo: boolean;
  usuario_modulos: UsuarioModulo[];
}

const ROL_LABEL: Record<Rol, string> = {
  admin_sistema: "Admin sistema",
  admin: "Admin",
  encargado: "Encargado",
  operario: "Operario",
};

// Sale de MODULOS_ORDEN y no de una lista propia: cuando se sumó Compras, esta
// copia quedó desactualizada y no había forma de asignar el módulo a nadie.
const MODULOS = MODULOS_ORDEN;
const MODULO_LABEL: Record<Modulo, string> = {
  rrhh: "RRHH",
  remises: "Remises",
  mantenimiento: "Mantenimiento",
  compras: "Compras",
};
const NIVEL_LABEL: Record<Nivel, string> = { lectura: "Lectura", edicion: "Edición", admin: "Admin" };

export default function UsuariosClient({ usuariosIniciales }: { usuariosIniciales: Usuario[] }) {
  const confirmar = useConfirm();
  const [usuarios, setUsuarios] = useState<Usuario[]>(usuariosIniciales);
  const [modalNuevo, setModalNuevo] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function recargar() {
    const res = await fetch("/api/administracion/usuarios");
    if (res.ok) setUsuarios(await res.json());
  }

  async function eliminar(u: Usuario) {
    const ok = await confirmar({
      title: "Eliminar usuario",
      message: `¿Eliminar a "${u.nombre} ${u.apellido}" (${u.email})? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/administracion/usuarios/${u.id}`, { method: "DELETE" });
    if (res.ok) {
      setError(null);
      recargar();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "No se pudo eliminar el usuario");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Usuarios</h1>
        <button onClick={() => setModalNuevo(true)} className="btn-primary">
          Nuevo usuario
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Email</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Módulos</th>
              <th>Activo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.nombre} {u.apellido}</td>
                <td>{ROL_LABEL[u.rol]}</td>
                <td>
                  {u.usuario_modulos.length === 0 ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {u.usuario_modulos.map((m) => (
                        <span key={m.id} className="badge badge-mant">
                          {MODULO_LABEL[m.modulo]}: {NIVEL_LABEL[m.nivel]}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td>{u.activo ? "Sí" : "No"}</td>
                <td className="text-right whitespace-nowrap">
                  <button onClick={() => setEditando(u)} className="btn-ghost">Editar</button>
                  <button onClick={() => eliminar(u)} className="btn-ghost text-red-600">Eliminar</button>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-gray-400">Todavía no hay usuarios</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalNuevo && (
        <NuevoUsuarioModal
          onClose={() => setModalNuevo(false)}
          onSaved={() => { setModalNuevo(false); recargar(); }}
        />
      )}

      {editando && (
        <EditarUsuarioModal
          usuario={editando}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); recargar(); }}
        />
      )}
    </div>
  );
}

function NuevoUsuarioModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ email: "", nombre: "", apellido: "", rol: "operario" as Rol });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ link: string; aviso: string | null } | null>(null);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/administracion/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setGuardando(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "No se pudo crear el usuario");
      return;
    }
    // El usuario ya existe. Si el correo no salió, el link es la única forma de
    // que la persona entre, así que se muestra en vez de cerrar el modal.
    if (data.link_acceso) {
      setResultado({ link: data.link_acceso, aviso: data.aviso ?? null });
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-medium text-gray-900 mb-4">Nuevo usuario</h2>

        {resultado ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Usuario creado. Pasale este link para que defina su contraseña:
            </p>
            <textarea
              readOnly
              rows={3}
              value={resultado.link}
              onClick={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
            />
            <p className="text-xs text-amber-700">
              Es de un solo uso y caduca. Tratalo como una contraseña temporal.
            </p>
            {resultado.aviso && <p className="text-xs text-gray-500">{resultado.aviso}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(resultado.link)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                Copiar
              </button>
              <button type="button" onClick={onSaved} className="btn-primary px-4 py-2 text-sm">
                Listo
              </button>
            </div>
          </div>
        ) : (
        <form onSubmit={crear} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nombre</label>
              <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="input" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Apellido</label>
              <input required value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} className="input" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Rol</label>
            <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })} className="input">
              {(Object.keys(ROL_LABEL) as Rol[]).map((r) => (
                <option key={r} value={r}>{ROL_LABEL[r]}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-500">
            Se le va a mandar un email a esa dirección para que defina su propia contraseña.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={guardando} className="btn-primary disabled:opacity-50">
              {guardando ? "Creando..." : "Crear usuario"}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

function EditarUsuarioModal({ usuario, onClose, onSaved }: { usuario: Usuario; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ nombre: usuario.nombre, apellido: usuario.apellido, rol: usuario.rol, activo: usuario.activo });
  const [grants, setGrants] = useState<Record<Modulo, Nivel | "">>(() => {
    const base = Object.fromEntries(MODULOS.map((m) => [m, ""])) as Record<Modulo, Nivel | "">;
    for (const m of usuario.usuario_modulos) base[m.modulo] = m.nivel;
    return base;
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);

    const resUsuario = await fetch(`/api/administracion/usuarios/${usuario.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!resUsuario.ok) {
      setGuardando(false);
      const data = await resUsuario.json().catch(() => ({}));
      setError(data.error ?? "No se pudo actualizar el usuario");
      return;
    }

    const grantsList = MODULOS.filter((m) => grants[m]).map((m) => ({ modulo: m, nivel: grants[m] }));
    const resModulos = await fetch(`/api/administracion/usuarios/${usuario.id}/modulos`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grants: grantsList }),
    });
    setGuardando(false);
    if (resModulos.ok) onSaved();
    else {
      const data = await resModulos.json().catch(() => ({}));
      setError(data.error ?? "No se pudieron actualizar los permisos");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-medium text-gray-900 mb-1">Editar usuario</h2>
        <p className="text-xs text-gray-500 mb-4">{usuario.email}</p>
        <form onSubmit={guardar} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nombre</label>
              <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="input" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Apellido</label>
              <input required value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} className="input" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Rol</label>
            <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })} className="input">
              {(Object.keys(ROL_LABEL) as Rol[]).map((r) => (
                <option key={r} value={r}>{ROL_LABEL[r]}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
            Activo
          </label>

          <div className="pt-2 border-t">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Módulos</h3>
            <div className="space-y-2">
              {MODULOS.map((m) => (
                <div key={m} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-600">{MODULO_LABEL[m]}</span>
                  <select
                    value={grants[m]}
                    onChange={(e) => setGrants({ ...grants, [m]: e.target.value as Nivel | "" })}
                    className="input w-40"
                  >
                    <option value="">Sin acceso</option>
                    {(Object.keys(NIVEL_LABEL) as Nivel[]).map((n) => (
                      <option key={n} value={n}>{NIVEL_LABEL[n]}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={guardando} className="btn-primary disabled:opacity-50">
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
