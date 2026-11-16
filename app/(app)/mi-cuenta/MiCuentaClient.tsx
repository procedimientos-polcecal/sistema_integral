"use client";

import { useState } from "react";
import { BotonNotificaciones } from "@/components/BotonNotificaciones";
import InfoTip from "@/components/InfoTip";

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
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-bold text-slate-900">Mi cuenta</h1>
        <InfoTip text="Tus datos y lo que podés cambiar vos: la contraseña y las notificaciones de este aparato. El nombre, el email y el rol se muestran pero no se editan desde acá." />
      </div>

      <div className="card p-5 space-y-2 text-sm">
        <div>
          <span className="text-slate-500">Nombre: </span>
          <span className="text-slate-900">{nombre} {apellido}</span>
        </div>
        <div>
          <span className="text-slate-500">Email: </span>
          <span className="text-slate-900">{email}</span>
        </div>
        <div>
          <span className="text-slate-500">Rol: </span>
          <span className="text-slate-900">{rolLabel}</span>{" "}
          <InfoTip text="El rol no decide por sí solo qué módulos ves: «Admin sistema» ve todos y entra a Administración; con «Encargado» u «Operario» ves los módulos que te hayan concedido. En algunos lugares puntuales el rol además cuenta: por ejemplo, un encargado ve en Disponibilidad el detalle por motivo y el anual aunque no tenga RRHH." />
        </div>
      </div>

      {/* Las notificaciones viven acá y no en el menú de un módulo porque son
          de todo el sistema: el resumen diario trae lo de todos los módulos a
          los que cada uno tiene acceso. Hasta el 18/10/2026 el único botón para
          prenderlas estaba escondido adentro de `/mi-remis`, que lo ve un
          puñado de gente — por eso en dos años no las activó nadie. */}
      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-medium text-slate-700">Notificaciones</h2>
          <InfoTip text="Llegan de cuatro maneras. Un resumen diario a las 8:30 (hora de Argentina) con lo que tenés para mirar según tus módulos: los lunes trae los totales y los demás días sólo lo que subió desde el resumen anterior; si no hay nada, no manda nada. En el momento: un requerimiento de compra o una orden de servicio esperando tu aprobación, si sos de quienes aprueban, y un evento de tu Agenda que alguien movió o borró en Google. Y a las 19:00, el remis que tengas asignado para mañana. Las menciones de la mensajería llegan por correo, no por acá. Se prenden por aparato." />
        </div>
        <BotonNotificaciones />
      </div>

      <div className="card p-5">
        <h2 className="font-medium text-slate-700 mb-3">Cambiar contraseña</h2>
        <form onSubmit={cambiarPassword} className="space-y-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Contraseña actual</label>
            <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Contraseña nueva</label>
            <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Confirmar contraseña nueva</label>
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
