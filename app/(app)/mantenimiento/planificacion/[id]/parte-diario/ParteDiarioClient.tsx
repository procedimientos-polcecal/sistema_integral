"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { TURNOS, comoSeLeeElTurno } from "@/lib/produccion/turnos";
import {
  diaMesAnio, filasDelParte, paginasDelParte, pieDeHoja,
  type ItemDelPlan,
} from "@/lib/mantenimiento/parteDiario";

/**
 * El parte diario de mantenimiento, para imprimir.
 *
 * Es el segundo impreso de la planificación y convive con el otro: aquél saca
 * **una OT por página**, para llevar al lado de la máquina; éste saca el turno
 * entero como una tabla, que es el papel que se archiva.
 *
 * LA HOJA ES EL PAPEL, NO UNA PANTALLA IMPRESA
 *
 * El formulario existe en papel desde antes que el sistema y las hojas se
 * apilan en una carpeta, así que ésta tiene que poder apilarse con ésas: mismo
 * título, mismos casilleros de DÍA/MES/AÑO arriba a la derecha, las mismas
 * cinco columnas en el mismo orden y el recuadro de observaciones abajo. Lo
 * que se ve en pantalla es la hoja, no un listado que después se imprime.
 *
 * **No se imprime sola.** El otro impreso llama a `window.print()` a los 600 ms
 * porque ahí no hay nada que elegir. Acá sí —el turno y qué OT entran—, y una
 * hoja que se manda a la impresora antes de que uno elija es papel tirado.
 *
 * EL SECTOR NO ESTÁ EN EL ENCABEZADO, Y EL PAPEL SÍ LO TIENE
 *
 * Se sacó a pedido el 20/10/2026: cada OT trae el suyo en la columna SECTOR, y
 * un plan del turno cruza varios —el parte del 19/10 tenía Hidratación y
 * Molienda cal en la misma hoja—. Un sector escrito arriba o queda vacío o
 * contradice a la mitad de los renglones, que es peor que no estar.
 *
 * El papel lo tiene porque se llenaba de a un sector por hoja. Si alguna vez
 * se vuelve a necesitar, va como filtro de qué OT entran y no como un texto
 * suelto en el encabezado.
 *
 * EL TURNO SE ELIGE Y NO SE GUARDA
 *
 * El papel lo trae preimpreso ("Turno 12 a 20"). Acá se elige al imprimir, con
 * **el vocabulario de Producción** —`comoSeLeeElTurno` da "4 a 12" y "12 a 20",
 * que es textual lo que dice el papel— y no con una lista nueva: dos
 * vocabularios para lo mismo es cómo una OT creada desde la app dejó de
 * aparecer al filtrar por «Media».
 */
export default function ParteDiarioClient({
  plan,
  items,
}: {
  plan: { id: string; fecha: string; titulo: string | null };
  items: ItemDelPlan[];
}) {
  /*
   * Arrancan todas tildadas: quien entra viene de un plan que ya armó, así que
   * el caso normal es imprimirlo entero y lo que se hace es sacar alguna. Al
   * revés obligaría a tildar treinta casillas para el caso de siempre.
   */
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  const [turno, setTurno] = useState<string>("12_20");
  const [operario, setOperario] = useState("");

  const { dia, mes, anio } = diaMesAnio(plan.fecha);
  const hojas = paginasDelParte(filasDelParte(items, elegidos));

  const alternar = (id: string) =>
    setElegidos((previos) => {
      const siguiente = new Set(previos);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 10mm 12mm; }
        /* Lo que esconde el armazón —el header, el aside y las dos barras—
           vive en app/globals.css, no acá. */
        @media print {
          .no-print { display: none !important; }
          .pd-hoja { width: 100%; margin: 0; border: none; page-break-after: always; }
          .pd-hoja:last-child { page-break-after: avoid; }
        }
        body { background: #f1f5f9; font-family: Arial, Helvetica, sans-serif; }

        /* A4 = 210×297mm; con 10mm/12mm de margen el área útil es 186×277mm.
           La hoja toma ese alto y la tabla crece hasta llenarlo: es el mismo
           recurso que el impreso de una OT por página. Sin esto, un parte de
           tres órdenes deja media carilla en blanco y no se parece al papel,
           que tiene la grilla hasta abajo. */
        .pd-hoja {
          width: 186mm;
          height: 265mm;
          margin: 0 auto 12mm;
          padding: 6mm;
          background: white;
          border: 1px solid #ccc;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        @media print {
          .pd-hoja { height: 271mm; }
        }
        .pd-tabla { width: 100%; border-collapse: collapse; flex: 1; }
        .pd-tabla th, .pd-tabla td {
          border: 1px solid #000;
          padding: 3px 5px;
          font-size: 11px;
          vertical-align: top;
          /* Un renglón no se parte entre dos hojas: cortado a la mitad deja de
             poder leerse de un vistazo, que es para lo que existe la tabla. */
          page-break-inside: avoid;
        }
        .pd-tabla th {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: .3px;
          text-align: center;
          vertical-align: middle;
          background: #fff;
        }
        /* Un mínimo, no un alto fijo: la tabla reparte entre los renglones lo
           que sobra de la hoja, así que los ocho quedan iguales llenos o
           vacíos —que es lo que hace que la grilla sirva para escribir a
           mano— y además llegan hasta abajo. */
        .pd-tabla td { height: 56px; }
        .pd-casillero { border: 1px solid #000; width: 34px; height: 30px; text-align: center; font-size: 12px; }
        .pd-casillero-rotulo { font-size: 7px; font-weight: 700; letter-spacing: .5px; }
        .pd-renglon { border-bottom: 1px solid #000; height: 18px; }
      `}</style>

      {/* ── Lo que se elige, que no se imprime ───────────────────────── */}
      <div className="no-print mx-auto mb-6 max-w-3xl rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-900">Parte diario de mantenimiento</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {elegidos.size} de {items.length} órdenes · {hojas.length} hoja{hojas.length > 1 ? "s" : ""}
            </p>
          </div>
          <button onClick={() => window.print()} className="btn-primary">
            Imprimir
          </button>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600">Turno</label>
            <Select value={turno} onChange={(e) => setTurno(e.target.value)} className="input">
              {TURNOS.map((t) => (
                <option key={t} value={t}>{comoSeLeeElTurno(t)}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600">Op.</label>
            <input value={operario} onChange={(e) => setOperario(e.target.value)}
              className="input" placeholder="Se puede dejar en blanco" />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-600">Qué órdenes entran</p>
          <div className="flex gap-3 text-xs font-medium">
            <button onClick={() => setElegidos(new Set(items.map((i) => i.id)))}
              className="text-blue-600 hover:text-blue-700">Todas</button>
            <button onClick={() => setElegidos(new Set())}
              className="text-slate-500 hover:text-slate-700">Ninguna</button>
          </div>
        </div>
        <ul className="mt-2 divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.id}>
              <label className="flex cursor-pointer items-start gap-2 py-1.5">
                <input type="checkbox" className="mt-1 shrink-0"
                  checked={elegidos.has(i.id)} onChange={() => alternar(i.id)} />
                <span className="min-w-0 text-sm text-slate-700">
                  <span className="font-mono text-xs text-slate-400">
                    #{i.ot_number ?? "—"}
                  </span>{" "}
                  {i.equipo_raw || "(sin equipo)"}
                  {i.descripcion && <span className="text-slate-400"> · {i.descripcion}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {items.length === 0 && (
          <p className="py-3 text-center text-sm text-slate-400">
            Este plan todavía no tiene órdenes.
          </p>
        )}
      </div>

      {/* ── Las hojas ───────────────────────────────────────────────── */}
      {hojas.map((hoja, h) => (
        <div key={h} className="pd-hoja">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 15, fontWeight: 700, letterSpacing: ".5px" }}>
                POLCECAL SA – POLYSAN SA
              </p>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px" }}>
                PARTE DIARIO DE MANTENIMIENTO
              </p>
            </div>
            <table style={{ borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  {(["DIA", "MES", "AÑO"] as const).map((r) => (
                    <td key={r} className="pd-casillero pd-casillero-rotulo" style={{ height: 14 }}>{r}</td>
                  ))}
                </tr>
                <tr>
                  {[dia, mes, anio].map((v, n) => (
                    <td key={n} className="pd-casillero">{v}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 24, margin: "8px 0 6px", fontSize: 11 }}>
            <span><strong>Turno</strong> {comoSeLeeElTurno(turno as (typeof TURNOS)[number])}</span>
            <span style={{ flex: 1 }}><strong>Op.:</strong> {operario}</span>
          </div>

          <table className="pd-tabla">
            <thead>
              <tr>
                <th style={{ width: "11%" }}>Nro OT</th>
                <th style={{ width: "15%" }}>SECTOR</th>
                <th style={{ width: "19%" }}>EQUIPO</th>
                <th style={{ width: "32%" }}>TRABAJO REALIZADO</th>
                <th style={{ width: "23%" }}>REPUESTOS UTILIZADOS</th>
              </tr>
            </thead>
            <tbody>
              {hoja.map((f, n) => (
                <tr key={f.id || `vacia-${n}`}>
                  <td style={{ textAlign: "center" }}>{f.nroOt}</td>
                  <td>{f.sector}</td>
                  <td>{f.equipo}</td>
                  <td>{f.trabajo}</td>
                  <td>{f.repuestos}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".3px" }}>OBSERVACIONES:</p>
            {[0, 1, 2, 3].map((n) => (
              <div key={n} className="pd-renglon" />
            ))}
          </div>

          {pieDeHoja(h + 1, hojas.length) && (
            <p style={{ marginTop: 6, textAlign: "right", fontSize: 9, color: "#555" }}>
              {pieDeHoja(h + 1, hojas.length)}
            </p>
          )}
        </div>
      ))}
    </>
  );
}
