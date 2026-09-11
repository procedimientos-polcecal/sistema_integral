"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ContratistasDeCantera } from "@/lib/cantera/contratistas";
import type { PersonaDeFinanzas } from "@/lib/cantera/auth";

interface Usuario { id: string; nombre: string; apellido: string; email: string }
interface Proveedor { id: string; nombre: string; cuit: string | null }

export default function ConfiguracionClient({
  finanzas,
  contratistas,
  usuarios,
  proveedores,
  hayOdoo,
}: {
  finanzas: PersonaDeFinanzas[];
  contratistas: ContratistasDeCantera;
  usuarios: Usuario[];
  proveedores: Proveedor[];
  hayOdoo: boolean;
}) {
  const idsEnLista = new Set([
    ...contratistas.resueltos.map((c) => c.proveedorId),
    ...contratistas.sinEnlace.map((c) => c.proveedorId),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
      <h1 className="mt-1 text-xl font-semibold">Configuración de Cantera</h1>

      {!hayOdoo && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Faltan las variables de entorno de Odoo (ODOO_URL/DB/USER/API_KEY). Sin eso, finanzas no puede
          buscar facturas para conciliar aunque esté en la lista de abajo.
        </p>
      )}

      {/* ── Finanzas ── */}
      <section className="mt-5 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-semibold">Finanzas</h2>
        <p className="text-xs text-slate-500">
          Quiénes pueden vincular una factura de Odoo a una etapa o a un bochón y marcarla conforme.
          Estar en esta lista ES el permiso — no depende del nivel que tengan en el módulo.
        </p>
        {finanzas.length === 0 && (
          <p className="mt-2 text-xs text-amber-700">
            Vacía: todavía nadie puede conciliar facturas. Sumá a alguien abajo.
          </p>
        )}
        <ul className="mt-3 space-y-2">
          {finanzas.map((f) => (
            <FilaFinanzas key={f.id} persona={f} />
          ))}
        </ul>
        <SumarFinanzas usuarios={usuarios.filter((u) => !finanzas.some((f) => f.id === u.id))} />
      </section>

      {/* ── Contratistas ── */}
      <section className="mt-4 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-semibold">Contratistas</h2>
        <p className="text-xs text-slate-500">
          Quiénes facturan perforación, voladura o bochones — cualquiera de ellos, cualquier etapa, a
          cualquiera de las dos empresas. El cruce con Odoo va por CUIT (tabla{" "}
          <code className="rounded bg-slate-100 px-1">proveedores_odoo</code>), no por nombre.
        </p>
        <ul className="mt-3 space-y-2">
          {contratistas.resueltos.map((c) => (
            <FilaContratista key={c.proveedorId} proveedorId={c.proveedorId} nombre={c.nombre}
              detalle={`${c.partnerIds.length} partner${c.partnerIds.length === 1 ? "" : "s"} de Odoo`} />
          ))}
          {contratistas.sinEnlace.map((c) => (
            <FilaContratista key={c.proveedorId} proveedorId={c.proveedorId} nombre={c.nombre}
              detalle="sin enlace a Odoo — no aparece en el picker de facturas" alerta />
          ))}
        </ul>
        {contratistas.resueltos.length === 0 && contratistas.sinEnlace.length === 0 && (
          <p className="mt-2 text-xs text-slate-500">Sin contratistas cargados.</p>
        )}
        <SumarContratista proveedores={proveedores.filter((p) => !idsEnLista.has(p.id))} />
        <p className="mt-3 text-xs text-slate-400">
          Un proveedor "sin enlace" se soluciona en{" "}
          <Link href="/compras/proveedores" className="underline">Compras → Proveedores</Link>, vinculándolo
          a su partner de Odoo por CUIT — eso vive en `proveedores_odoo`, compartido con Facturación.
        </p>
      </section>
    </div>
  );
}

function FilaFinanzas({ persona }: { persona: PersonaDeFinanzas }) {
  const router = useRouter();
  const [quitando, setQuitando] = useState(false);
  const [error, setError] = useState("");

  async function quitar() {
    if (!confirm(`¿Sacar a ${persona.nombre} de finanzas? Deja de poder conciliar facturas de cantera.`)) return;
    setQuitando(true);
    setError("");
    const res = await fetch(`/api/cantera/finanzas?usuario_id=${persona.id}`, { method: "DELETE" });
    setQuitando(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo quitar.");
      return;
    }
    router.refresh();
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-3 py-2 text-sm">
      <span className="text-slate-900">{persona.nombre} {persona.apellido}</span>
      <span className="font-mono text-xs text-slate-500">{persona.email}</span>
      <button onClick={quitar} disabled={quitando}
        className="ml-auto text-xs text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300">
        {quitando ? "Quitando…" : "Quitar"}
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </li>
  );
}

function SumarFinanzas({ usuarios }: { usuarios: Usuario[] }) {
  const router = useRouter();
  const [elegido, setElegido] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function sumar() {
    setGuardando(true);
    setError("");
    const res = await fetch("/api/cantera/finanzas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_id: elegido }),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo sumar.");
      return;
    }
    setElegido("");
    router.refresh();
  }

  if (usuarios.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={elegido} onChange={(e) => setElegido(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Sumar a alguien…</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>{u.nombre} {u.apellido}</option>
          ))}
        </select>
        <button onClick={sumar} disabled={!elegido || guardando}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {guardando ? "Sumando…" : "Sumar a finanzas"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function FilaContratista({
  proveedorId, nombre, detalle, alerta,
}: { proveedorId: string; nombre: string; detalle: string; alerta?: boolean }) {
  const router = useRouter();
  const [quitando, setQuitando] = useState(false);
  const [error, setError] = useState("");

  async function quitar() {
    if (!confirm(`¿Sacar a ${nombre} de la lista de contratistas de cantera?`)) return;
    setQuitando(true);
    setError("");
    const res = await fetch(`/api/cantera/contratistas?proveedor_id=${proveedorId}`, { method: "DELETE" });
    setQuitando(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo quitar.");
      return;
    }
    router.refresh();
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-3 py-2 text-sm">
      <span className="text-slate-900">{nombre}</span>
      <span className={`text-xs ${alerta ? "text-amber-700" : "text-slate-500"}`}>{detalle}</span>
      <button onClick={quitar} disabled={quitando}
        className="ml-auto text-xs text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300">
        {quitando ? "Quitando…" : "Quitar"}
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </li>
  );
}

function SumarContratista({ proveedores }: { proveedores: Proveedor[] }) {
  const router = useRouter();
  const [elegido, setElegido] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function sumar() {
    setGuardando(true);
    setError("");
    const res = await fetch("/api/cantera/contratistas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proveedor_id: elegido }),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo sumar.");
      return;
    }
    setElegido("");
    router.refresh();
  }

  if (proveedores.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={elegido} onChange={(e) => setElegido(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Sumar un proveedor…</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}{p.cuit ? ` (${p.cuit})` : ""}</option>
          ))}
        </select>
        <button onClick={sumar} disabled={!elegido || guardando}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {guardando ? "Sumando…" : "Sumar a contratistas"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
