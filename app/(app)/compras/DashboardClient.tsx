"use client";

import { useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import Indicador from "@/components/Indicador";
import {
  APROBACION_LABELS, COMPRA_LABELS, PRIORIDAD_LABELS, moneda, fecha, etiquetaEmpresa,
} from "@/lib/compras/constants";
import type { EstadoAprobacion, EstadoCompra, Prioridad } from "@/lib/compras/types";

interface Contadores {
  total: number;
  pendientes: number;
  paraComprar: number;
  enComparativa: number;
  pedidos: number;
  urgentes: number;
}

interface ConCosto {
  fecha: string;
  costo_iva: number | null;
  costo_envio: number | null;
  empresas: { nombre: string } | null;
  compras_areas: { nombre: string } | null;
  proveedores: { nombre: string } | null;
}

interface Reciente {
  id: string;
  nro_ri: number;
  descripcion: string;
  fecha: string;
  prioridad: Prioridad;
  estado_aprobacion: EstadoAprobacion;
  estado_compra: EstadoCompra;
  compras_areas: { nombre: string } | null;
}

/**
 * Los gráficos se cargan aparte: `recharts` son ~350 KB y su JS bloqueaba el
 * primer pintado de todo el tablero, indicadores y tablas incluidos.
 * `ssr: false` porque miden el contenedor para dibujarse.
 */
const esqueleto = () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />;
const GastoPorMes = dynamic(() => import("./GraficosCompras").then((m) => m.GastoPorMes), { ssr: false, loading: esqueleto });
const GastoPorEmpresa = dynamic(() => import("./GraficosCompras").then((m) => m.GastoPorEmpresa), { ssr: false, loading: esqueleto });
const GastoPorArea = dynamic(() => import("./GraficosCompras").then((m) => m.GastoPorArea), { ssr: false, loading: esqueleto });

export default function DashboardClient({
  contadores, conCosto, recientes,
}: {
  contadores: Contadores;
  conCosto: ConCosto[];
  recientes: Reciente[];
}) {
  const costo = (g: ConCosto) => (g.costo_iva ?? 0) + (g.costo_envio ?? 0);

  const porMes = useMemo(() => {
    const mapa = new Map<string, number>();
    const hoy = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      mapa.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, 0);
    }
    for (const g of conCosto) {
      const d = new Date(g.fecha);
      if (isNaN(d.getTime())) continue;
      const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (mapa.has(clave)) mapa.set(clave, mapa.get(clave)! + costo(g));
    }
    return [...mapa.entries()].map(([clave, valor]) => {
      const [anio, mes] = clave.split("-");
      return { mes: `${mes}/${anio.slice(2)}`, total: Math.round(valor) };
    });
  }, [conCosto]);

  const porArea = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const g of conCosto) {
      const nombre = g.compras_areas?.nombre ?? "Sin área";
      mapa.set(nombre, (mapa.get(nombre) ?? 0) + costo(g));
    }
    return [...mapa.entries()]
      .map(([nombre, valor]) => ({ nombre, valor: Math.round(valor) }))
      .sort((a, b) => b.valor - a.valor);
  }, [conCosto]);

  const porEmpresa = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const g of conCosto) {
      const nombre = etiquetaEmpresa(g.empresas?.nombre);
      mapa.set(nombre, (mapa.get(nombre) ?? 0) + costo(g));
    }
    return [...mapa.entries()].map(([nombre, valor]) => ({ nombre, valor: Math.round(valor) }));
  }, [conCosto]);

  const topProveedores = useMemo(() => {
    const mapa = new Map<string, { monto: number; pedidos: number }>();
    for (const g of conCosto) {
      const nombre = g.proveedores?.nombre;
      if (!nombre) continue;
      const previo = mapa.get(nombre) ?? { monto: 0, pedidos: 0 };
      mapa.set(nombre, { monto: previo.monto + costo(g), pedidos: previo.pedidos + 1 });
    }
    return [...mapa.entries()]
      .map(([nombre, v]) => ({ nombre, ...v }))
      .sort((a, b) => b.monto - a.monto)
      .slice(0, 10);
  }, [conCosto]);

  const gastoTotal = useMemo(() => conCosto.reduce((acc, g) => acc + costo(g), 0), [conCosto]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Compras</h1>
        <p className="text-sm text-slate-500">Estado del circuito de compras de POLCECAL y POLYSAN</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Indicador titulo="Requerimientos" valor={contadores.total} href="/compras/requerimientos" />
        <Indicador titulo="Esperando aprobación" valor={contadores.pendientes} href="/compras/aprobaciones" acento="text-amber-600" />
        <Indicador titulo="Para comprar" valor={contadores.paraComprar} href="/compras/tablero" acento="text-amber-600" />
        <Indicador titulo="En comparativa" valor={contadores.enComparativa} href="/compras/tablero" acento="text-blue-600" />
        <Indicador titulo="Pedidos en curso" valor={contadores.pedidos} href="/compras/tablero" acento="text-indigo-600" />
        <Indicador titulo="Urgentes sin cerrar" valor={contadores.urgentes} href="/compras/tablero" acento="text-red-600" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gasto por mes</h2>
          <p className="mb-3 text-xs text-slate-400">
            Costo + IVA y envío de los requerimientos con costo cargado, últimos 12 meses.
          </p>
          <div className="h-64">
            <GastoPorMes datos={porMes} />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gasto por empresa</h2>
          <p className="mb-3 text-xs text-slate-400">
            Total acumulado: <strong className="font-mono">{moneda(gastoTotal)}</strong>
          </p>
          <div className="h-64">
            <GastoPorEmpresa datos={porEmpresa} />
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Gasto por área</h2>
          <div className="h-72">
            <GastoPorArea datos={porArea} />
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h2 className="px-5 pt-5 pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Principales proveedores por monto
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Proveedor</th>
                  <th className="px-3 py-2 text-right">Pedidos</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topProveedores.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-400">Sin datos de costo todavía.</td></tr>
                ) : (
                  topProveedores.map((p) => (
                    <tr key={p.nombre}>
                      <td className="px-3 py-2 text-slate-800">{p.nombre}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{p.pedidos}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">{moneda(p.monto)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Últimos requerimientos</h2>
          <Link href="/compras/requerimientos" className="text-xs text-slate-500 hover:text-slate-900">Ver todos →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">N° RI</th>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Descripción</th>
                <th className="px-3 py-2 text-left">Área</th>
                <th className="px-3 py-2 text-left">Prioridad</th>
                <th className="px-3 py-2 text-left">Aprobación</th>
                <th className="px-3 py-2 text-left">Compra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recientes.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono">
                    <Link href={`/compras/requerimientos/${r.id}`} className="font-semibold text-[var(--primary)] hover:underline">
                      {r.nro_ri}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fecha(r.fecha)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/compras/requerimientos/${r.id}`} className="text-slate-900 hover:underline">
                      {r.descripcion}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.compras_areas?.nombre ?? "—"}</td>
                  <td className="px-3 py-2"><Chip {...PRIORIDAD_LABELS[r.prioridad]} /></td>
                  <td className="px-3 py-2"><Chip {...APROBACION_LABELS[r.estado_aprobacion]} /></td>
                  <td className="px-3 py-2"><Chip {...COMPRA_LABELS[r.estado_compra]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}
