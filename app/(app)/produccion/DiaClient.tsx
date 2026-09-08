"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { comoSeLee, sumarDias, hoyEnArgentina } from "@/lib/core/fechas";
import { comoSeLeeElTurno, parteAnterior } from "@/lib/produccion/turnos";
import { roturaTotal, type TotalesDeDespacho } from "@/lib/produccion/despachos";
import type { ProduccionPorProducto } from "@/lib/produccion/produccion";
import type { Familia, Producto } from "@/lib/produccion/types";
import type { TurnoDelDia } from "./page";

const FAMILIAS: { clave: Familia; etiqueta: string }[] = [
  { clave: "filler", etiqueta: "Filler" },
  { clave: "0_2", etiqueta: "0-2" },
  { clave: "cal", etiqueta: "Cal" },
  { clave: "otros", etiqueta: "Otros" },
];

interface Props {
  fecha: string;
  productos: Producto[];
  turnos: TurnoDelDia[];
  delDia: ProduccionPorProducto;
  puedeEditar: boolean;
}

function fechaLegible(fecha: string): string {
  const dia = new Date(`${fecha}T00:00:00`).toLocaleDateString("es-AR", { weekday: "long" });
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${comoSeLee(fecha)}`;
}

/**
 * La portada del módulo: qué se produjo hoy, y qué falta para saberlo.
 *
 * El punto entero de la pantalla es no confundir las tres formas de que una
 * celda no tenga número — en el Excel las tres se ven como un cero, y un cero
 * no se distingue de un día sin producir:
 *
 *   - turno sin cargar        → la celda de ese turno queda vacía
 *   - sin_parte_anterior      → "—" con el motivo al lado, no oculto
 *   - dia_incompleto          → "—" sólo en la columna del día
 *
 * Despachado y las dos roturas del día son la suma de los dos turnos, y esa
 * suma es real aunque falte uno: el turno ocurrió, sólo falta transcribirlo.
 * Por eso, cuando falta un turno, esas tres columnas se marcan "parcial" en
 * vez de mostrar el total como si fuera el día entero — el mismo motivo por
 * el que "Producción del día" ya usa `dia_incompleto`.
 *
 * Y una producción negativa se muestra en rojo con la cuenta desglosada: es
 * un error de carga y no se recorta a cero, porque recortarlo lo esconde.
 *
 * Toda la aritmética viene ya resuelta del servidor (`produccionDelTurno`,
 * `produccionDelDia`, `totalesDeDespacho`, `roturaTotal`); acá sólo se
 * despliega el desglose de una cuenta que ya está hecha, nunca se recalcula.
 */
export default function DiaClient({ fecha, productos, turnos, delDia, puedeEditar }: Props) {
  const router = useRouter();
  const [reintentando, setReintentando] = useState(false);
  const [errorReintento, setErrorReintento] = useState("");

  const [t1, t2] = turnos;
  const hoy = hoyEnArgentina();

  const faltantes = turnos.filter((t) => !t.cargado);
  // Con algún turno sin cargar, despachado y rotura del día son la suma de lo
  // que ya está, no el día entero: se marcan como parciales en la tabla.
  const diaIncompleto = faltantes.length > 0;
  const sinAnterior = turnos.filter((t) => t.cargado && t.faltaAnterior);
  // Los dos partes de un día se anotan o se limpian juntos (la ruta de
  // reintentar hace un solo `update` con los dos ids), así que alcanza con
  // mostrar el primer texto que aparezca.
  const pendiente = turnos.find((t) => t.parte?.sheets_pendiente)?.parte?.sheets_pendiente ?? null;

  async function reintentar() {
    setReintentando(true);
    setErrorReintento("");
    const res = await fetch("/api/produccion/planilla/reintentar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha }),
    });
    const json = await res.json().catch(() => ({}));
    setReintentando(false);
    if (!res.ok) { setErrorReintento(json.error ?? "No se pudo reintentar."); return; }
    // La fuente de verdad es el servidor: refresca para traer el pendiente (y
    // los números, por si algo cambió) tal como quedaron después de escribir.
    router.refresh();
  }

  const productosPorFamilia = (familia: Familia) => productos.filter((p) => p.familia === familia);

  return (
    <div className="mx-auto max-w-5xl space-y-6 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Producción</h1>
        <p className="text-sm text-slate-500">Qué se produjo, por turno y por día.</p>
      </div>

      {/* ── Selector de fecha ─────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <Link
          href={`/produccion?fecha=${sumarDias(fecha, -1)}`}
          aria-label="Día anterior"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Anterior
        </Link>
        <div className="text-center">
          <div className="text-base font-semibold text-slate-900">{fechaLegible(fecha)}</div>
          {fecha !== hoy && (
            <Link href="/produccion" className="text-xs font-medium text-[var(--primary)] hover:underline">
              Ir a hoy
            </Link>
          )}
        </div>
        <Link
          href={`/produccion?fecha=${sumarDias(fecha, 1)}`}
          aria-label="Día siguiente"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Siguiente →
        </Link>
      </div>

      {/* ── Avisos ────────────────────────────────────────────── */}
      <div className="space-y-2">
        {faltantes.map((t) => (
          <div
            key={`falta-${t.turno}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            <span>
              El turno {comoSeLeeElTurno(t.turno)} no está cargado.
            </span>
            <Link
              href={`/produccion/parte/${fecha}/${t.turno}`}
              className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              {puedeEditar ? "Cargar" : "Ver"}
            </Link>
          </div>
        ))}

        {sinAnterior.map((t) => {
          const anterior = parteAnterior({ fecha, turno: t.turno });
          return (
            <div
              key={`anterior-${t.turno}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              <span>
                La producción del turno {comoSeLeeElTurno(t.turno)} no se puede calcular: falta el
                parte del {comoSeLee(anterior.fecha)} turno {comoSeLeeElTurno(anterior.turno)}.
              </span>
              <Link
                href={`/produccion/parte/${anterior.fecha}/${anterior.turno}`}
                className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                {puedeEditar ? "Cargarlo" : "Verlo"}
              </Link>
            </div>
          );
        })}

        {pendiente && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>
              Este día no llegó a la planilla: <strong>{pendiente}</strong>.
            </span>
            {puedeEditar && (
              <button
                type="button"
                onClick={reintentar}
                disabled={reintentando}
                className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
              >
                {reintentando ? "Reintentando…" : "Reintentar"}
              </button>
            )}
          </div>
        )}
        {errorReintento && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorReintento}
          </div>
        )}
      </div>

      {/* ── La tabla del día ──────────────────────────────────── */}
      {productos.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Todavía no hay productos en el catálogo, así que no hay nada que
          mostrar acá. Eso no impide cargar los partes del día: los avisos de
          arriba siguen valiendo.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Producto</th>
                  <th className="px-3 py-2 text-right">Producción T1</th>
                  <th className="px-3 py-2 text-right">Producción T2</th>
                  <th className="px-3 py-2 text-right">Producción del día</th>
                  <th className="px-3 py-2 text-right">Despachado</th>
                  <th className="px-3 py-2 text-right">Rotura bolsa</th>
                  <th className="px-3 py-2 text-right">Rotura bolsón</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {FAMILIAS.map(({ clave, etiqueta }) => {
                  const deEstaFamilia = productosPorFamilia(clave);
                  if (deEstaFamilia.length === 0) return null;
                  return (
                    <FamilyGroup
                      key={clave}
                      etiqueta={etiqueta}
                      productos={deEstaFamilia}
                      t1={t1}
                      t2={t2}
                      delDia={delDia}
                      diaIncompleto={diaIncompleto}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FamilyGroup({
  etiqueta, productos, t1, t2, delDia, diaIncompleto,
}: {
  etiqueta: string;
  productos: Producto[];
  t1: TurnoDelDia;
  t2: TurnoDelDia;
  delDia: ProduccionPorProducto;
  diaIncompleto: boolean;
}) {
  return (
    <>
      <tr className="bg-slate-50">
        <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          {etiqueta}
        </td>
      </tr>
      {productos.map((p) => (
        <FilaDeProducto key={p.id} producto={p} t1={t1} t2={t2} delDia={delDia} diaIncompleto={diaIncompleto} />
      ))}
    </>
  );
}

function FilaDeProducto({
  producto, t1, t2, delDia, diaIncompleto,
}: {
  producto: Producto;
  t1: TurnoDelDia;
  t2: TurnoDelDia;
  delDia: ProduccionPorProducto;
  diaIncompleto: boolean;
}) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2 text-slate-900">{producto.nombre}</td>
      <td className="px-3 py-2 text-right">
        <CeldaDeTurno turno={t1} productoId={producto.id} />
      </td>
      <td className="px-3 py-2 text-right">
        <CeldaDeTurno turno={t2} productoId={producto.id} />
      </td>
      <td className="px-3 py-2 text-right">
        <CeldaDelDia productoId={producto.id} delDia={delDia} t1={t1} t2={t2} />
      </td>
      <td className="px-3 py-2 text-right">
        <CeldaSumaDelDia
          valor={sumaDelDia(t1, t2, (t) => t.despachado, producto.id)}
          incompleto={diaIncompleto}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <CeldaSumaDelDia
          valor={sumaDelDia(t1, t2, (t) => t.roturaBolsa, producto.id)}
          incompleto={diaIncompleto}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <CeldaSumaDelDia
          valor={sumaDelDia(t1, t2, (t) => t.roturaBolson, producto.id)}
          incompleto={diaIncompleto}
        />
      </td>
    </tr>
  );
}

/**
 * Suma un campo de los totales de despacho de los dos turnos.
 *
 * Un turno sin cargar no aporta a la suma, pero eso no la vuelve el total del
 * día: el turno ocurrió, lo que falta es la transcripción. La cuenta en sí
 * sigue siendo la de lo que ya está cargado — es `CeldaSumaDelDia` la que la
 * marca como parcial cuando corresponde, no esta función.
 */
function sumaDelDia(
  t1: TurnoDelDia,
  t2: TurnoDelDia,
  campo: (t: TotalesDeDespacho) => Record<string, number>,
  productoId: string
): number {
  const de = (t: TurnoDelDia) => (t.totales ? (campo(t.totales)[productoId] ?? 0) : 0);
  return de(t1) + de(t2);
}

/**
 * Despachado o rotura del día. Cuando falta un turno, el número sigue siendo
 * real —es lo que ya se cargó— pero no es el día entero, y se marca "parcial"
 * con el mismo criterio de color que usa "sin producción" en Resúmenes: no
 * hace falta pasar el mouse para notarlo.
 */
function CeldaSumaDelDia({ valor, incompleto }: { valor: number; incompleto: boolean }) {
  if (!incompleto) return <span className="text-slate-600">{valor}</span>;
  return (
    <span
      className="inline-flex flex-col items-end leading-tight"
      title="Falta cargar un turno de este día: esta suma es sólo de los turnos ya cargados"
    >
      <span className="font-medium text-amber-700">{valor}</span>
      <span className="text-[10px] text-amber-600">parcial</span>
    </span>
  );
}

/**
 * Una celda de Producción T1 o T2.
 *
 * Turno sin cargar → nada: es la única de las tres formas que se ve realmente
 * vacía, porque ese parte todavía no se transcribió.
 */
function CeldaDeTurno({ turno, productoId }: { turno: TurnoDelDia; productoId: string }) {
  if (!turno.cargado) return null;

  const p = turno.produccion?.[productoId];
  // El parte está cargado pero este producto no aparece en ningún renglón del
  // turno (ni depósito, ni despacho, ni rotura): no hay nada que mostrar, y
  // no es lo mismo que "sin parte anterior".
  if (!p) return null;

  if (p.estado === "sin_parte_anterior") return <SinParteAnterior />;

  // `produccionDelTurno` nunca devuelve "dia_incompleto": eso lo agrega
  // `produccionDelDia` al juntar los dos turnos. Queda contemplado para que
  // TS no se queje del tipo compartido, no porque pueda pasar acá.
  if (p.estado !== "calculada") return null;

  if (p.cantidad < 0) {
    // Los cuatro números tal como los trajo el servidor — no se reimplementa
    // la resta despejando el depósito a partir de `p.cantidad`. Esa cuenta
    // despejada al revés daba un "depósito" que no es el depósito (es la
    // variación) y que además podía salir negativo, algo que
    // `interpretarCantidadDeDeposito` prohíbe por definición: el tooltip
    // existe para cotejar contra el papel, y un número que no está en el
    // papel lo vuelve inútil.
    const despachado = turno.totales?.despachado[productoId] ?? 0;
    const rotura = turno.totales ? (roturaTotal(turno.totales)[productoId] ?? 0) : 0;
    const deposito = turno.deposito?.[productoId] ?? 0;
    const depositoAnterior = turno.depositoAnterior?.[productoId] ?? 0;
    return (
      <span
        className="font-semibold text-red-600"
        title={`Depósito ${deposito} − anterior ${depositoAnterior} + despachado ${despachado} + rotura ${rotura} = ${p.cantidad}`}
      >
        {p.cantidad}
      </span>
    );
  }

  return <span className="text-slate-700">{p.cantidad}</span>;
}

/** La celda de "Producción del día": acá sí puede aparecer "dia_incompleto". */
function CeldaDelDia({
  productoId, delDia, t1, t2,
}: {
  productoId: string;
  delDia: ProduccionPorProducto;
  t1: TurnoDelDia;
  t2: TurnoDelDia;
}) {
  const p = delDia[productoId];
  if (!p) return null;

  if (p.estado === "dia_incompleto") {
    return (
      <span className="text-slate-300" title="Falta un turno de este día: los que sí están no alcanzan para saber el día completo">
        —
      </span>
    );
  }
  if (p.estado === "sin_parte_anterior") return <SinParteAnterior />;

  if (p.cantidad < 0) {
    const parcial = (t: TurnoDelDia, etiqueta: string) => {
      const v = t.produccion?.[productoId];
      return v?.estado === "calculada" ? `${etiqueta} ${v.cantidad}` : null;
    };
    const desglose = [parcial(t1, "T1"), parcial(t2, "T2")].filter(Boolean).join(" + ");
    return (
      <span
        className="font-semibold text-red-600"
        title={desglose ? `${desglose} = ${p.cantidad}` : undefined}
      >
        {p.cantidad}
      </span>
    );
  }

  return <span className="font-medium text-slate-900">{p.cantidad}</span>;
}

/** "—" con el motivo a la vista, no escondido detrás de un hover. */
function SinParteAnterior() {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="text-slate-300">—</span>
      <span className="text-[10px] text-slate-400">sin parte anterior</span>
    </span>
  );
}
