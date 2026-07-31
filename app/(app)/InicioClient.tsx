"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Resumen {
  rrhh: { empleadosActivos: number; presentesHoy: number; ausentesHoy: number } | null;
  remises: { vehiculosActivos: number; empleadosConTurnoHoy: number } | null;
  mantenimiento: { equiposTotal: number; equiposOperativos: number; vencidos: number; otPendientes: number } | null;
}

export default function InicioClient({ nombreUsuario }: { nombreUsuario: string }) {
  const [resumen, setResumen] = useState<Resumen | null>(null);

  useEffect(() => {
    fetch("/api/home/resumen")
      .then((r) => r.json())
      .then(setResumen)
      .catch(() => setResumen({ rrhh: null, remises: null, mantenimiento: null }));
  }, []);

  const sinModulos = resumen && !resumen.rrhh && !resumen.remises && !resumen.mantenimiento;

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
            filas={
              resumen?.rrhh
                ? [
                    { label: "Empleados activos", valor: resumen.rrhh.empleadosActivos },
                    { label: "Presentes hoy", valor: resumen.rrhh.presentesHoy },
                    { label: "Ausentes hoy", valor: resumen.rrhh.ausentesHoy },
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
            filas={
              resumen?.remises
                ? [
                    { label: "Vehículos activos", valor: resumen.remises.vehiculosActivos },
                    { label: "Empleados con turno hoy", valor: resumen.remises.empleadosConTurnoHoy },
                  ]
                : null
            }
          />
        )}

        {(!resumen || resumen.mantenimiento) && (
          <ModuloCard
            titulo="Mantenimiento"
            href="/mantenimiento"
            color="#D97706"
            icon={<IconWrench />}
            filas={
              resumen?.mantenimiento
                ? [
                    { label: "Equipos operativos", valor: `${resumen.mantenimiento.equiposOperativos} / ${resumen.mantenimiento.equiposTotal}` },
                    { label: "Mantenimientos vencidos", valor: resumen.mantenimiento.vencidos },
                    { label: "Órdenes pendientes", valor: resumen.mantenimiento.otPendientes },
                  ]
                : null
            }
          />
        )}
      </div>
    </div>
  );
}

function ModuloCard({
  titulo,
  href,
  color,
  icon,
  filas,
}: {
  titulo: string;
  href: string;
  color: string;
  icon: React.ReactNode;
  filas: { label: string; valor: string | number }[] | null;
}) {
  return (
    <div className="card flex flex-col p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: color }}>
          {icon}
        </span>
        <h2 className="font-semibold text-gray-900">{titulo}</h2>
      </div>

      <div className="flex-1 space-y-2.5">
        {filas === null
          ? [0, 1, 2].map((i) => <div key={i} className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />)
          : filas.map((f) => (
              <div key={f.label} className="flex items-baseline justify-between text-sm">
                <span className="text-gray-500">{f.label}</span>
                <span className="font-semibold text-gray-900">{f.valor}</span>
              </div>
            ))}
      </div>

      <Link href={href} className="btn-ghost mt-4 self-start">
        Ver más →
      </Link>
    </div>
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
