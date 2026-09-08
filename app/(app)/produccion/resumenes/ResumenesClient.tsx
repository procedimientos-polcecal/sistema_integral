"use client";

import Link from "next/link";
import { hoyEnArgentina, mesRelativo } from "@/lib/core/fechas";
import { porcentajeDeRotura } from "@/lib/produccion/planilla";
import type { DiaDelMes } from "@/lib/produccion/consultas";
import type { ProduccionDelProducto } from "@/lib/produccion/produccion";
import type { Producto } from "@/lib/produccion/types";

interface Props {
  mes: string;
  productos: Producto[];
  dias: DiaDelMes[];
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function mesLegible(mes: string): string {
  const [anio, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${anio}`;
}

/** "01 lun", para una fila corta en una tabla que ya tiene muchas columnas. */
function diaCorto(fecha: string): string {
  const dia = new Date(`${fecha}T00:00:00`).toLocaleDateString("es-AR", { weekday: "short" });
  return `${fecha.slice(8, 10)} ${dia}`;
}

/**
 * El mes por producto: lo que hoy son `Resumen Producción`, `Resumen Despacho`
 * y `Resumen Rotura` en la planilla de Google.
 *
 * Toda la aritmética ya viene resuelta del servidor (`armarElMes`, que a su vez
 * reusa `totalesDeDespacho`, `roturaTotal`, `produccionDelTurno`,
 * `produccionDelDia`): acá sólo se despliega. La única cuenta que se hace en
 * esta pantalla es `porcentajeDeRotura`, y es la misma función que usa
 * `espejarDia` para escribir la planilla — no una copia.
 */
export default function ResumenesClient({ mes, productos, dias }: Props) {
  const mesActual = hoyEnArgentina().slice(0, 7);

  return (
    <div className="mx-auto max-w-7xl space-y-6 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Resúmenes</h1>
        <p className="text-sm text-slate-500">El mes por producto: producción, despacho y rotura.</p>
      </div>

      {/* ── Selector de mes ───────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <Link
          href={`/produccion/resumenes?mes=${mesRelativo(mes, -1)}`}
          aria-label="Mes anterior"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Anterior
        </Link>
        <div className="text-center">
          <div className="text-base font-semibold capitalize text-slate-900">{mesLegible(mes)}</div>
          {mes !== mesActual && (
            <Link
              href="/produccion/resumenes"
              className="text-xs font-medium text-[var(--primary)] hover:underline"
            >
              Ir a este mes
            </Link>
          )}
        </div>
        <Link
          href={`/produccion/resumenes?mes=${mesRelativo(mes, 1)}`}
          aria-label="Mes siguiente"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Siguiente →
        </Link>
      </div>

      {productos.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Todavía no hay productos en el catálogo, así que no hay ninguna
          columna que mostrar. En cuanto calidad defina la lista, este mes va a
          tener sus tablas — no hace falta volver a cargar nada de lo que ya se
          transcribió: los partes están, sólo falta el catálogo para verlos acá.
        </div>
      ) : (
        <>
          <TablaProduccion productos={productos} dias={dias} />
          <TablaDeSumas
            titulo="Despacho"
            leyenda="Bultos despachados por producto, sumados de los renglones del camión."
            productos={productos}
            dias={dias}
            campo={(d) => d.despacho}
          />
          <TablaDeRotura productos={productos} dias={dias} />
        </>
      )}
    </div>
  );
}

/** El nombre de un producto, o el genérico si `nombre_planilla` no lo da. */
function nombreDeColumna(p: Producto): string {
  return p.nombre;
}

function Envoltorio({
  titulo, leyenda, children,
}: {
  titulo: string;
  leyenda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
        {leyenda && <p className="text-xs text-slate-500">{leyenda}</p>}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">{children}</div>
      </div>
    </div>
  );
}

function EncabezadoDeProductos({ productos }: { productos: Producto[] }) {
  return (
    <tr>
      <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left">Día</th>
      {productos.map((p) => (
        <th key={p.id} className="px-3 py-2 text-right whitespace-nowrap">
          {nombreDeColumna(p)}
        </th>
      ))}
    </tr>
  );
}

/** Producción: la única tabla que no es una simple suma, tiene estados. */
function TablaProduccion({ productos, dias }: { productos: Producto[]; dias: DiaDelMes[] }) {
  const totales: Record<string, number> = {};
  for (const d of dias) {
    for (const [id, v] of Object.entries(d.produccionCalculada)) {
      totales[id] = (totales[id] ?? 0) + v;
    }
  }

  return (
    <Envoltorio
      titulo="Producción"
      leyenda="Depósito − depósito anterior + despachado + rotura, por turno. Donde falta el parte anterior o un turno del día, no se inventa un número."
    >
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <EncabezadoDeProductos productos={productos} />
        </thead>
        <tbody className="divide-y divide-slate-100">
          {dias.map((d) => (
            <tr key={d.fecha} className="hover:bg-slate-50">
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-700">
                {diaCorto(d.fecha)}
              </td>
              {productos.map((p) => (
                <td key={p.id} className="px-3 py-2 text-right">
                  <CeldaProduccion estado={d.produccion[p.id]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
          <tr>
            <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Total del mes</td>
            {productos.map((p) => (
              <td key={p.id} className="px-3 py-2 text-right">
                {totales[p.id] ?? 0}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </Envoltorio>
  );
}

function CeldaProduccion({ estado }: { estado: ProduccionDelProducto | undefined }) {
  // Ningún turno del día tocó este producto (ni depósito, ni despacho, ni
  // rotura): no es lo mismo que "no calculable", es que no hay nada que
  // mostrar.
  if (!estado) return <span className="text-slate-300">·</span>;

  if (estado.estado === "sin_parte_anterior") {
    return (
      <span className="text-slate-300" title="No se pudo calcular: falta el parte anterior">
        —
      </span>
    );
  }
  if (estado.estado === "dia_incompleto") {
    return (
      <span className="text-slate-300" title="No se pudo calcular: falta un turno de este día">
        —
      </span>
    );
  }

  if (estado.cantidad < 0) {
    return <span className="font-semibold text-red-600">{estado.cantidad}</span>;
  }
  return <span className="text-slate-700">{estado.cantidad}</span>;
}

/** Despacho: una simple suma por producto, sin estados que desglosar. */
function TablaDeSumas({
  titulo, leyenda, productos, dias, campo,
}: {
  titulo: string;
  leyenda?: string;
  productos: Producto[];
  dias: DiaDelMes[];
  campo: (d: DiaDelMes) => Record<string, number>;
}) {
  const totales: Record<string, number> = {};
  for (const d of dias) {
    for (const [id, v] of Object.entries(campo(d))) {
      totales[id] = (totales[id] ?? 0) + v;
    }
  }

  return (
    <Envoltorio titulo={titulo} leyenda={leyenda}>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <EncabezadoDeProductos productos={productos} />
        </thead>
        <tbody className="divide-y divide-slate-100">
          {dias.map((d) => (
            <tr key={d.fecha} className="hover:bg-slate-50">
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-700">
                {diaCorto(d.fecha)}
              </td>
              {productos.map((p) => (
                <td key={p.id} className="px-3 py-2 text-right text-slate-700">
                  {campo(d)[p.id] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
          <tr>
            <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Total del mes</td>
            {productos.map((p) => (
              <td key={p.id} className="px-3 py-2 text-right">
                {totales[p.id] ?? 0}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </Envoltorio>
  );
}

/**
 * Rotura: dos tablas, como en la planilla. La primera son las unidades
 * rotas; la segunda es el % de rotura, con `porcentajeDeRotura` — la misma
 * función que escribe la planilla, no una copia.
 *
 * Donde `porcentajeDeRotura` devuelve vacío (hubo rotura y la producción dio
 * cero, o no se pudo calcular) se muestran las unidades rotas con la
 * aclaración "sin producción": es la información que hoy se pierde detrás
 * de un 0 % en el Excel.
 */
function TablaDeRotura({ productos, dias }: { productos: Producto[]; dias: DiaDelMes[] }) {
  const totalRotura: Record<string, number> = {};
  const totalProduccion: Record<string, number> = {};
  for (const d of dias) {
    for (const [id, v] of Object.entries(d.rotura)) {
      totalRotura[id] = (totalRotura[id] ?? 0) + v;
    }
    for (const [id, v] of Object.entries(d.produccionCalculada)) {
      totalProduccion[id] = (totalProduccion[id] ?? 0) + v;
    }
  }

  return (
    <div className="space-y-4">
      <TablaDeSumas
        titulo="Rotura"
        leyenda="Unidades rotas, bolsa y bolsón sumados. Separadas en el renglón del despacho."
        productos={productos}
        dias={dias}
        campo={(d) => d.rotura}
      />

      <Envoltorio
        titulo="% de rotura"
        leyenda='Rotura sobre producción del día. Cuando hubo rotura y la producción dio cero (o no se pudo calcular), no se muestra "0%": se muestran las unidades rotas.'
      >
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <EncabezadoDeProductos productos={productos} />
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dias.map((d) => (
              <tr key={d.fecha} className="hover:bg-slate-50">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-700">
                  {diaCorto(d.fecha)}
                </td>
                {productos.map((p) => (
                  <td key={p.id} className="px-3 py-2 text-right">
                    <CeldaDePorcentaje
                      rotura={d.rotura[p.id] ?? 0}
                      produccion={d.produccionCalculada[p.id] ?? 0}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
            <tr>
              <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Total del mes</td>
              {productos.map((p) => (
                <td key={p.id} className="px-3 py-2 text-right">
                  <CeldaDePorcentaje
                    rotura={totalRotura[p.id] ?? 0}
                    produccion={totalProduccion[p.id] ?? 0}
                  />
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </Envoltorio>
    </div>
  );
}

function CeldaDePorcentaje({ rotura, produccion }: { rotura: number; produccion: number }) {
  const pct = porcentajeDeRotura(rotura, produccion);

  if (pct === "") {
    return (
      <span className="whitespace-nowrap text-amber-700" title="Hubo rotura pero la producción del día dio cero, o no se pudo calcular">
        {rotura} <span className="text-[10px] font-normal">sin producción</span>
      </span>
    );
  }

  const numero = Number(pct) * 100;
  return <span className="text-slate-700">{numero.toFixed(2)}%</span>;
}
