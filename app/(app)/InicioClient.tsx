"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Resumen {
  rrhh: { empleadosActivos: number; presentesHoy: number; ausentesHoy: number } | null;
  remises: { vehiculosActivos: number; empleadosConTurnoHoy: number } | null;
  mantenimiento: { atrasadas: number; otPendientes: number; avisosSinOrden: number } | null;
  compras: { enCurso: number; esperandoAprobacion: number; paraComprar: number } | null;
}

export default function InicioClient({ nombreUsuario }: { nombreUsuario: string }) {
  const [resumen, setResumen] = useState<Resumen | null>(null);

  useEffect(() => {
    fetch("/api/home/resumen")
      .then((r) => r.json())
      .then(setResumen)
      .catch(() => setResumen({ rrhh: null, remises: null, mantenimiento: null, compras: null }));
  }, []);

  const sinModulos =
    resumen && !resumen.rrhh && !resumen.remises && !resumen.mantenimiento && !resumen.compras;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Hola, {nombreUsuario || "de nuevo"}</h1>
        <p className="text-gray-600">Esto es lo que está pasando hoy en cada módulo.</p>
      </div>

      {sinModulos && (
        <div className="empty-state">Todavía no tenés acceso a ningún módulo. Pedile a un administrador que te lo habilite.</div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {(!resumen || resumen.rrhh) && (
          <ModuloCard
            titulo="RRHH"
            href="/rrhh"
            color="#1E7D34"
            icon={<IconUsers />}
            hero={resumen?.rrhh ? { label: "Ausentes hoy", valor: resumen.rrhh.ausentesHoy } : null}
            secundarias={
              resumen?.rrhh
                ? [
                    { label: "Empleados activos", valor: resumen.rrhh.empleadosActivos },
                    { label: "Presentes hoy", valor: resumen.rrhh.presentesHoy },
                  ]
                : null
            }
          />
        )}

        {(!resumen || resumen.remises) && (
          <ModuloCard
            titulo="Remises"
            href="/remises"
            color="#2563EB"
            icon={<IconCar />}
            hero={resumen?.remises ? { label: "Empleados con turno hoy", valor: resumen.remises.empleadosConTurnoHoy } : null}
            secundarias={resumen?.remises ? [{ label: "Vehículos activos", valor: resumen.remises.vehiculosActivos }] : null}
          />
        )}

        {(!resumen || resumen.mantenimiento) && (
          <ModuloCard
            titulo="Mantenimiento"
            href="/mantenimiento"
            color="#D97706"
            icon={<IconWrench />}
            // Lo que falta hacer, no lo que está bien. "Equipos operativos"
            // decía 237/239 y se movía una vez por mes; el titular anterior
            // salía de una tabla con una sola fila cargada.
            hero={resumen?.mantenimiento ? { label: "Órdenes atrasadas", valor: resumen.mantenimiento.atrasadas } : null}
            secundarias={
              resumen?.mantenimiento
                ? [
                    { label: "Órdenes pendientes", valor: resumen.mantenimiento.otPendientes },
                    { label: "Avisos sin orden", valor: resumen.mantenimiento.avisosSinOrden },
                  ]
                : null
            }
          />
        )}

        {(!resumen || resumen.compras) && (
          <ModuloCard
            titulo="Compras"
            href="/compras"
            color="#1E7D34"
            icon={<IconCarrito />}
            // Lo que hay que hacer, no lo que ya se hizo: el histórico de
            // pedidos cerrados es enorme y no dice nada acá.
            hero={
              resumen?.compras
                ? { label: "Requerimientos en curso", valor: resumen.compras.enCurso }
                : null
            }
            secundarias={
              resumen?.compras
                ? [
                    { label: "Esperando aprobación", valor: resumen.compras.esperandoAprobacion },
                    { label: "Para comprar", valor: resumen.compras.paraComprar },
                  ]
                : null
            }
          />
        )}
      </div>
    </div>
  );
}

function IconCarrito() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M3 3h2l2.4 11.4a1 1 0 0 0 1 .8h8.2a1 1 0 0 0 1-.8L20 7H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="19" r="1.3" />
      <circle cx="17" cy="19" r="1.3" />
    </svg>
  );
}

function ModuloCard({
  titulo,
  href,
  color,
  icon,
  hero,
  secundarias,
}: {
  titulo: string;
  href: string;
  color: string;
  icon: React.ReactNode;
  hero: { label: string; valor: string | number } | null;
  secundarias: { label: string; valor: string | number }[] | null;
}) {
  return (
    <Link
      href={href}
      className="card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-3 p-5 pb-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: color }}>
          {icon}
        </span>
        <h2 className="flex-1 font-semibold text-gray-900">{titulo}</h2>
        <span className="text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-400">→</span>
      </div>

      <div className="px-5 pb-3">
        {hero === null ? (
          <div className="h-10 w-24 animate-pulse rounded bg-gray-100" />
        ) : (
          <>
            <div className="text-4xl font-bold tabular-nums" style={{ color }}>
              {hero.valor}
            </div>
            <div className="mt-0.5 text-sm text-gray-500">{hero.label}</div>
          </>
        )}
      </div>

      <div className="mt-auto flex divide-x border-t" style={{ borderColor: "var(--border)" }}>
        {secundarias === null
          ? [0, 1].map((i) => (
              <div key={i} className="flex-1 px-5 py-3">
                <div className="h-3 w-16 animate-pulse rounded bg-gray-100" />
              </div>
            ))
          : secundarias.map((s) => (
              <div key={s.label} className="flex-1 px-5 py-3">
                <div className="text-base font-semibold text-gray-900 tabular-nums">{s.valor}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
              </div>
            ))}
      </div>
    </Link>
  );
}

function IconUsers() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCar() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M5 17h14M5 17a2 2 0 01-2-2v-2l2-5a2 2 0 012-2h6a2 2 0 012 2l2 5v2a2 2 0 01-2 2M5 17a2 2 0 002 2h0a2 2 0 002-2m8 0a2 2 0 002 2h0a2 2 0 002-2M7 13h10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconWrench() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M14.7 6.3a4 4 0 10-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 005.4-5.4l-2.83 2.83a2 2 0 01-2.83-2.83L14.7 6.3z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
