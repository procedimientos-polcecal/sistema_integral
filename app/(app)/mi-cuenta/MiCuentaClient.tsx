"use client";

import { useState } from "react";

export default function MiCuentaClient({
  email,
  nombre,
  apellido,
  rolLabel,
}: {
  email: string;
  nombre: string;
  apellido: string;
  rolLabel: string;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function cambiarPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);

    if (newPassword.length < 6) {
      setError("La contraseña nueva debe tener al menos 6 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }

    setGuardando(true);
    const res = await fetch("/api/mi-cuenta/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setGuardando(false);
    if (res.ok) {
      setOk(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "No se pudo cambiar la contraseña");
    }
  }

  return (
    <div className="space-y-6 max-w-md">
      <h1 className="text-xl font-bold text-gray-900">Mi cuenta</h1>

      <div className="card p-5 space-y-2 text-sm">
        <div>
          <span className="text-gray-500">Nombre: </span>
          <span className="text-gray-900">{nombre} {apellido}</span>
        </div>
        <div>
          <span className="text-gray-500">Email: </span>
          <span className="text-gray-900">{email}</span>
        </div>
        <div>
          <span className="text-gray-500">Rol: </span>
          <span className="text-gray-900">{rolLabel}</span>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-medium text-gray-700 mb-3">Cambiar contraseña</h2>
        <form onSubmit={cambiarPassword} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Contraseña actual</label>
            <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Contraseña nueva</label>
            <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Confirmar contraseña nueva</label>
            <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="input" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {ok && <p className="text-sm text-emerald-600">Contraseña actualizada.</p>}
          <button type="submit" disabled={guardando} className="btn-primary disabled:opacity-50">
            {guardando ? "Guardando..." : "Cambiar contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}
