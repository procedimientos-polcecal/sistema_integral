"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Select from "@/components/Select";
import InfoTip from "@/components/InfoTip";
import {
  MINIMO_OBSERVADO,
  PLAZOS,
  VENTANA_DIAS,
  type FilaMtbf,
  type Mtbf,
} from "@/lib/mantenimiento/mtbf";
import {
  DIAS_DE_CALENDARIO,
  diasCorridos,
  equiposSinFallas,
  fechaCorta,
  filasVisibles,
  porcentajeDeConfiabilidad,
  type EquipoDeLaVista,
  type FilaDeVista,
} from "@/lib/mantenimiento/mtbfVista";

/**
 * El listado de MTBF. No hace cuentas: la cuenta viene hecha del servidor y acá
 * sólo se filtra y se ordena.
 *
 * Los textos de advertencia no son decoración. Sin horas de marcha cargadas el
 * número cuenta días de calendario, y quien lo lea como una medida de
 * confiabilidad de ingeniería compara una máquina de un turno con una de tres
 * como si fueran iguales. Por eso van visibles en el encabezado y no en un
 * tooltip que nadie abre.
 */

type Columna = "equipo" | "sector" | "mtbf" | "fallas" | "ultima" | `r${number}`;
interface Orden { columna: Columna; ascendente: boolean }

interface Props {
  mtbf: Mtbf;
  equipos: EquipoDeLaVista[];
  sectores: { id: string; nombre: string }[];
}

/** Lo que se ordena en cada columna. null va siempre al final, sea cual sea el sentido. */
function valorDe(f: FilaDeVista, columna: Columna): string | number | null {
  switch (columna) {
    case "equipo": return f.equipo.name;
    case "sector": return f.equipo.sectorNombre;
    case "mtbf": return f.mtbf;
    case "fallas": return f.fallas;
    case "ultima": return f.ultima;
    default: return f.confiabilidades[Number(columna.slice(1))] ?? null;
  }
}

function ordenar(filas: FilaDeVista[], { columna, ascendente }: Orden): FilaDeVista[] {
  return [...filas].sort((a, b) => {
    const x = valorDe(a, columna);
    const y = valorDe(b, columna);
    if (x === null && y === null) return b.fallas - a.fallas;
    if (x === null) return 1;
    if (y === null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es");
    if (c !== 0) return ascendente ? c : -c;
    return b.fallas - a.fallas;
  });
}

/**
 * Las fallas de los últimos 12 meses como una línea. Escrita a mano y no con
 * `recharts`: son 166 filas y un gráfico por fila pesa de más.
 *
 * La escala es la de cada equipo (de 0 a su mes pico), así que sirve para ver
 * la forma —si el ritmo bajó o subió— y no para comparar una fila con otra: eso
 * lo dice el MTBF. El último punto es el mes en curso, que va a medias: el
 * tramo que llega hasta él es punteado y el punto, hueco.
 */
function Tendencia({ porMes, mesEnCurso }: { porMes: FilaMtbf["porMes"]; mesEnCurso: string }) {
  const ancho = 84;
  const alto = 24;
  const margen = 3;
  const pico = Math.max(1, ...porMes.map((m) => m.cantidad));
  const paso = (ancho - 2 * margen) / Math.max(1, porMes.length - 1);
  const puntos = porMes.map((m, i) => ({
    x: margen + i * paso,
    y: alto - margen - (m.cantidad / pico) * (alto - 2 * margen),
    incompleto: m.etiqueta === mesEnCurso,
  }));

  const completos = puntos.filter((p) => !p.incompleto);
  const ultimo = puntos.find((p) => p.incompleto);
  const previo = completos[completos.length - 1];
  const texto = porMes.map((m) => `${m.etiqueta}: ${m.cantidad}`).join(" · ");

  return (
    <svg
      width={ancho}
      height={alto}
      viewBox={`0 0 ${ancho} ${alto}`}
      role="img"
      aria-label={`Fallas por mes. ${texto}. El último mes está incompleto.`}
      className="text-slate-500"
    >
      <title>{`${texto} (el último mes está incompleto)`}</title>
      <polyline
        points={completos.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {ultimo && previo && (
        <>
          <line
            x1={previo.x} y1={previo.y} x2={ultimo.x} y2={ultimo.y}
            stroke="currentColor" strokeWidth={1.5} strokeDasharray="2 2"
          />
          <circle cx={ultimo.x} cy={ultimo.y} r={2.5} fill="white" stroke="currentColor" strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}

/**
 * Qué analiza cada columna.
 *
 * Van acá y no sueltos en el JSX porque dos de estos textos son la diferencia
 * entre leer bien el tablero y leerlo mal: que cada orden correctiva cuenta una
 * aunque dos caigan el mismo día, y que la fecha es la de **ejecución** y no la
 * de carga de la orden en la planilla.
 */
const QUE_ANALIZA = {
  equipo: "El nombre y el código de la máquina. Lleva a su ficha, donde está el detalle mes a mes.",
  sector: "Dónde está la máquina. Sólo sectores de planta: los organizativos no tienen equipos.",
  mtbf: "Tiempo medio entre fallas: los días observados de la ventana divididos por las correctivas de esa máquina. Menos días es peor.",
  fallas: "Cuántas órdenes correctivas se ejecutaron sobre la máquina en la ventana. Cada orden cuenta una, también cuando dos caen el mismo día.",
  tendencia: "Las fallas mes a mes, los últimos doce. Dice si el ritmo viene bajando o subiendo; el mes en curso va punteado porque está incompleto.",
  ultima: "Cuándo se ejecutó la última correctiva. Es la fecha en que se hizo el trabajo, no la fecha en que se cargó la orden en la planilla.",
} as const;

const llegaA = (dias: number) =>
  `Probabilidad de que la máquina aguante ${dias} días sin una correctiva, calculada sobre su MTBF. Supone que la tasa de falla es constante, y en varias máquinas no lo es.`;

function Encabezado({
  columna, orden, onOrdenar, alinear = "left", info, children,
}: {
  columna: Columna;
  orden: Orden;
  onOrdenar: (c: Columna) => void;
  alinear?: "left" | "right";
  info: string;
  children: React.ReactNode;
}) {
  const activa = orden.columna === columna;
  return (
    <th
      aria-sort={activa ? (orden.ascendente ? "ascending" : "descending") : "none"}
      className={`px-3 py-3 font-medium text-slate-600 whitespace-nowrap ${alinear === "right" ? "text-right" : "text-left"}`}
    >
      <button type="button" onClick={() => onOrdenar(columna)} className="hover:text-slate-900">
        {children}
        <span className="ml-1 text-xs text-slate-400">{activa ? (orden.ascendente ? "▲" : "▼") : ""}</span>
      </button>
      <InfoTip text={info} className="ml-1" />
    </th>
  );
}

export default function MtbfClient({ mtbf, equipos, sectores }: Props) {
  const [sectorId, setSectorId] = useState("");
  const [especialidad, setEspecialidad] = useState("");
  const [orden, setOrden] = useState<Orden>({ columna: "mtbf", ascendente: true });

  const filtros = useMemo(
    () => ({ sectorId: sectorId || null, especialidad: especialidad || null }),
    [sectorId, especialidad]
  );

  const filas = useMemo(
    () => ordenar(filasVisibles(mtbf.filas, equipos, filtros), orden),
    [mtbf.filas, equipos, filtros, orden]
  );
  const sinFallas = useMemo(
    () => equiposSinFallas(mtbf.filas, equipos, filtros),
    [mtbf.filas, equipos, filtros]
  );

  const especialidades = useMemo(
    () => [...new Set(mtbf.filas.flatMap((f) => f.porEspecialidad.map((e) => e.especialidad)))].sort(),
    [mtbf.filas]
  );

  function cambiarOrden(columna: Columna) {
    setOrden((o) =>
      o.columna === columna
        ? { columna, ascendente: !o.ascendente }
        // Lo primero que se quiere ver de una columna numérica es el peor valor:
        // el MTBF y las confiabilidades más bajas, las fallas y la fecha más altas.
        : { columna, ascendente: columna === "equipo" || columna === "sector" || columna === "mtbf" || columna.startsWith("r") }
    );
  }

  const hayFilas = mtbf.filas.length > 0;
  const poco = hayFilas && mtbf.diasObservados < MINIMO_OBSERVADO;

  return (
    <div className="md:p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          MTBF por equipo
          <InfoTip text="Tiempo medio entre fallas: los días observados divididos por la cantidad de fallas correctivas del equipo. 'Llega a N d' es la probabilidad de aguantar N días sin una correctiva, suponiendo que la tasa de falla es constante." />
        </h1>
        <p className="text-sm text-slate-500">
          Correctivas de los últimos {VENTANA_DIAS} días
          {hayFilas && ` · ${mtbf.diasObservados} días observados`}. La ventana es fija: los filtros no la cambian.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-1">
        <p>
          <strong>{DIAS_DE_CALENDARIO.titulo}</strong> {DIAS_DE_CALENDARIO.detalle}
        </p>
        <p>
          Las probabilidades suponen una tasa de falla constante. Si el equipo cambió de ritmo, la
          tendencia lo muestra: el último punto es el mes en curso y está incompleto.
        </p>
        <p>
          <strong>Ordena por frecuencia de falla, no por criticidad.</strong> Nadie cargó la
          criticidad de los equipos —casi todos figuran con el valor por defecto—, así que la lista
          no dice qué conviene atender primero: una máquina que falla cada 4 días y no para la planta
          sale arriba de una que falla cada 20 y sí la para.
        </p>
      </div>

      {!hayFilas ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          {mtbf.sinAtribuir.length > 0
            ? `Ninguna correctiva de los últimos ${VENTANA_DIAS} días tiene un equipo enlazado, así que no hay MTBF por máquina que calcular. Las que hay se listan abajo.`
            : `No hay correctivas con fecha en los últimos ${VENTANA_DIAS} días, así que no hay nada que medir.`}
        </div>
      ) : (
        <>
          {poco && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Se observaron apenas {mtbf.diasObservados} días: con menos de {MINIMO_OBSERVADO} el MTBF
              todavía no se publica, sólo la cantidad de fallas.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none"
            >
              <option value="">Todos los sectores</option>
              {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </Select>
            <Select
              value={especialidad}
              onChange={(e) => setEspecialidad(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none"
            >
              <option value="">Todas las especialidades</option>
              {especialidades.map((e) => <option key={e} value={e}>{e}</option>)}
            </Select>
          </div>

          {especialidad && (
            <p className="text-xs text-slate-500">
              Equipos con al menos una falla {especialidad.toLowerCase()}. El MTBF y las fallas que se
              leen son las de todas las causas.
            </p>
          )}

          <p className="text-sm text-slate-500">{filas.length} equipos con fallas</p>

          <div className="overflow-x-auto card">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Encabezado columna="equipo" orden={orden} onOrdenar={cambiarOrden} info={QUE_ANALIZA.equipo}>Equipo</Encabezado>
                  <Encabezado columna="sector" orden={orden} onOrdenar={cambiarOrden} info={QUE_ANALIZA.sector}>Sector</Encabezado>
                  <Encabezado columna="mtbf" orden={orden} onOrdenar={cambiarOrden} alinear="right" info={QUE_ANALIZA.mtbf}>MTBF</Encabezado>
                  <Encabezado columna="fallas" orden={orden} onOrdenar={cambiarOrden} alinear="right" info={QUE_ANALIZA.fallas}>Fallas</Encabezado>
                  {PLAZOS.map((dias, i) => (
                    <Encabezado key={dias} columna={`r${i}`} orden={orden} onOrdenar={cambiarOrden} alinear="right" info={llegaA(dias)}>
                      Llega a {dias} d
                    </Encabezado>
                  ))}
                  <th className="px-3 py-3 text-left font-medium text-slate-600 whitespace-nowrap">
                    Tendencia
                    <InfoTip text={QUE_ANALIZA.tendencia} className="ml-1" />
                  </th>
                  <Encabezado columna="ultima" orden={orden} onOrdenar={cambiarOrden} info={QUE_ANALIZA.ultima}>Última</Encabezado>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.map((f) => (
                  <tr key={f.equipmentId} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link
                        href={`/mantenimiento/equipos/${f.equipmentId}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {f.equipo.name}
                      </Link>
                      <span className="ml-1 text-slate-500 whitespace-nowrap">{f.equipo.code}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{f.equipo.sectorNombre}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900 whitespace-nowrap">
                      {diasCorridos(f.mtbf)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">{f.fallas}</td>
                    {f.confiabilidades.map((c, i) => (
                      <td key={PLAZOS[i]} className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">
                        {porcentajeDeConfiabilidad(c)}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <Tendencia porMes={f.porMes} mesEnCurso={mtbf.mesEnCurso} />
                    </td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fechaCorta(f.ultima)}</td>
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={6 + PLAZOS.length} className="px-3 py-6 text-center text-slate-500">
                      Ningún equipo con esos filtros tuvo fallas en la ventana.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {sinFallas.length > 0 && (
            <details className="card">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">
                {sinFallas.length} equipos sin fallas · MTBF &gt; {mtbf.diasObservados} d
              </summary>
              <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
                {sinFallas.map((e) => (
                  <li key={e.id} className="px-4 py-2 flex flex-wrap gap-x-2">
                    <Link href={`/mantenimiento/equipos/${e.id}`} className="font-medium text-slate-900 hover:underline">
                      {e.name}
                    </Link>
                    <span className="text-slate-500">{e.code}</span>
                    <span className="text-slate-400">· {e.sectorNombre}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

        </>
      )}

      {mtbf.sinAtribuir.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">
            {mtbf.sinAtribuir.length} correctivas sin equipo enlazado
          </h2>
          <p className="text-xs text-slate-500">
            Son fallas que ocurrieron pero no se pueden atribuir a una máquina del sistema, así que
            no entran en ningún MTBF. Se muestran como vienen cargadas, sin adivinar de qué equipo
            son.
          </p>
          <div className="overflow-x-auto card">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">OT</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Equipo (texto libre)</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mtbf.sinAtribuir.map((s) => (
                  <tr key={s.otNumber}>
                    <td className="px-3 py-2 text-slate-700 whitespace-nowrap">#{s.otNumber}</td>
                    <td className="px-3 py-2 text-slate-500">{s.equipoRaw?.trim() || "—"}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fechaCorta(s.fecha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
