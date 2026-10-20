"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/Select";
import type { SectorDePlanta } from "@/lib/mantenimiento/sectores";
import {
  repartirHoras, normalizarLugar, lunesDeLaSemana,
} from "@/lib/mantenimiento/partesDeContratista";

/**
 * Cargar los partes diarios del contratista y generar las OT.
 *
 * **El total se ve mientras se carga, no al guardar.** Quien tiene la hoja
 * delante tiene que poder ver que da 18 antes de pasar a la siguiente; una
 * comprobación que llega recién al guardar obliga a volver a leer el papel.
 *
 * El reparto que muestra la pantalla es **el mismo código** que corre en la
 * ruta —`repartirHoras`, que es puro y por eso se puede importar de los dos
 * lados—. Si fueran dos cálculos parecidos, el día que se separen la pantalla
 * mostraría un número y la base guardaría otro.
 */

export interface Contratista { id: string; nombre: string }
export interface EquipoBasico {
  id: string; name: string; code: string | null; sector_id: string | null;
}
export interface LugarConocido {
  proveedor_id: string; texto: string; texto_original: string;
  sector_id: string; equipo_id: string | null;
}
export interface RenglonCargado {
  id: string; orden: number; actividad: string; lugar_raw: string;
  sector_id: string | null; equipo_id: string | null; horas: number;
  orden_trabajo_id: string | null;
}
export interface ParteCargado {
  id: string; proveedor_id: string; numero: number; fecha: string;
  dirigido_a: string | null; hora_entrada: string | null; hora_salida: string | null;
  horas_expresion: string; horas_declaradas: number; materiales: string | null;
  mant_partes_contratista_renglones: RenglonCargado[] | null;
}

/** Un renglón mientras se lo está escribiendo. */
interface RenglonEnEdicion {
  actividad: string;
  lugar_raw: string;
  sector_id: string;
  equipo_id: string;
}

const RENGLON_VACIO: RenglonEnEdicion = {
  actividad: "Limpieza", lugar_raw: "", sector_id: "", equipo_id: "",
};

export default function PartesContratistaClient({
  puedeEditar, sectores, equipos, contratistas, lugares, partes, faltaLaMigracion,
}: {
  puedeEditar: boolean;
  sectores: SectorDePlanta[];
  equipos: EquipoBasico[];
  contratistas: Contratista[];
  lugares: LugarConocido[];
  partes: ParteCargado[];
  faltaLaMigracion: boolean;
}) {
  const router = useRouter();

  const [contratista, setContratista] = useState(contratistas[0]?.id ?? "");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);

  // ── El parte que se está cargando ───────────────────────────
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState("");
  const [dirigidoA, setDirigidoA] = useState("");
  const [horaEntrada, setHoraEntrada] = useState("");
  const [horaSalida, setHoraSalida] = useState("");
  const [expresion, setExpresion] = useState("");
  const [declaradas, setDeclaradas] = useState("");
  const [horas50, setHoras50] = useState("");
  const [horas100, setHoras100] = useState("");
  const [materiales, setMateriales] = useState("");
  const [renglones, setRenglones] = useState<RenglonEnEdicion[]>([{ ...RENGLON_VACIO }]);

  // ── La generación ───────────────────────────────────────────
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [previo, setPrevio] = useState<Simulacion | null>(null);

  const porSector = useMemo(() => {
    const m = new Map<string, EquipoBasico[]>();
    for (const e of equipos) {
      if (!e.sector_id) continue;
      const lista = m.get(e.sector_id) ?? [];
      lista.push(e);
      m.set(e.sector_id, lista);
    }
    return m;
  }, [equipos]);

  /** El catálogo del contratista elegido, por texto normalizado. */
  const catalogo = useMemo(() => {
    const m = new Map<string, LugarConocido>();
    for (const l of lugares) {
      if (l.proveedor_id === contratista) m.set(l.texto, l);
    }
    return m;
  }, [lugares, contratista]);

  /**
   * El reparto, en vivo.
   *
   * Es el mismo que va a correr la ruta. Mientras no cierre, muestra qué le
   * falta en vez de un número — que es el control de la factura asomando en la
   * pantalla.
   */
  const reparto = useMemo(
    () => repartirHoras(
      expresion,
      renglones.map((r) => ({ actividad: r.actividad, lugar_raw: r.lugar_raw })),
      Number(declaradas)
    ),
    [expresion, renglones, declaradas]
  );

  const partesDelContratista = useMemo(
    () => partes.filter((p) => p.proveedor_id === contratista),
    [partes, contratista]
  );

  function cambiarRenglon(i: number, cambio: Partial<RenglonEnEdicion>) {
    setRenglones((previos) => previos.map((r, j) => (j === i ? { ...r, ...cambio } : r)));
  }

  /**
   * Lo que el catálogo ya sabe de ese lugar.
   *
   * Se dispara al salir del campo y **sólo completa lo que está vacío**: pisar
   * un sector que alguien acaba de elegir a mano sería desdecirlo. Y si no lo
   * conoce, no propone nada: enlazar al que se le parece pondría las horas en
   * el centro de costo equivocado y eso no se nota nunca.
   */
  function engancharDelCatalogo(i: number) {
    const r = renglones[i];
    if (!r.lugar_raw.trim() || r.sector_id) return;
    const conocido = catalogo.get(normalizarLugar(r.lugar_raw));
    if (!conocido) return;
    cambiarRenglon(i, {
      sector_id: conocido.sector_id,
      equipo_id: r.equipo_id || conocido.equipo_id || "",
    });
  }

  function limpiar() {
    setNumero(""); setFecha(""); setDirigidoA("");
    setHoraEntrada(""); setHoraSalida("");
    setExpresion(""); setDeclaradas("");
    setHoras50(""); setHoras100(""); setMateriales("");
    setRenglones([{ ...RENGLON_VACIO }]);
  }

  async function guardar() {
    setError(""); setAviso(""); setCargando(true);
    const res = await fetch("/api/mantenimiento/partes-contratista", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proveedor_id: contratista,
        numero, fecha,
        dirigido_a: dirigidoA,
        hora_entrada: horaEntrada, hora_salida: horaSalida,
        horas_expresion: expresion,
        horas_declaradas: declaradas,
        horas_50: horas50, horas_100: horas100,
        materiales,
        renglones: renglones.map((r) => ({
          actividad: r.actividad,
          lugar_raw: r.lugar_raw,
          sector_id: r.sector_id || null,
          equipo_id: r.equipo_id || null,
        })),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setCargando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo guardar el parte"); return; }

    // El número que sigue, ya puesto: son correlativos y se cargan quince de
    // una. La fecha también avanza un día, que es lo que pasa quince veces.
    const siguiente = String(Number(numero) + 1);
    const otroDia = sumarUnDia(fecha);
    limpiar();
    setNumero(siguiente);
    setFecha(otroDia);
    setAviso(
      `Parte guardado, ${body.horas} h repartidas.` +
      (body.catalogo_error ? ` ${body.catalogo_error}` : "")
    );
    router.refresh();
  }

  async function generar(simular: boolean) {
    setError(""); setAviso(""); setCargando(true);
    const res = await fetch("/api/mantenimiento/partes-contratista/generar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proveedor_id: contratista, desde, hasta, simular }),
    });
    const body = await res.json().catch(() => ({}));
    setCargando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo generar"); return; }

    if (simular) { setPrevio(body); return; }

    setPrevio(null);
    const hechas = (body.creadas ?? []) as { ot_number: number }[];
    const sumadas = (body.actualizadas ?? []) as { ot_number: number; horas: number }[];
    setAviso(
      [
        hechas.length
          ? `Se crearon ${hechas.length}: OT ${hechas.map((c) => c.ot_number).join(", ")}.`
          : "No se creó ninguna orden nueva.",
        sumadas.length
          ? `Se le sumaron horas a ${sumadas.length} que ya existían: ` +
            `${sumadas.map((c) => `OT ${c.ot_number} (${c.horas} h)`).join(", ")}.`
          : "",
        body.quedaron ? `Quedaron ${body.quedaron} para la próxima corrida.` : "",
      ].filter(Boolean).join(" ")
    );
    if (body.problemas?.length) setError(body.problemas.join(" · "));
    router.refresh();
  }

  if (faltaLaMigracion) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-amber-300 bg-amber-50 p-6">
        <h1 className="mb-2 text-lg font-semibold text-amber-900">
          Falta correr la migración
        </h1>
        <p className="text-sm text-amber-800">
          Esta pantalla necesita las tablas <code>mant_partes_contratista</code>,{" "}
          <code>mant_partes_contratista_renglones</code> y{" "}
          <code>mant_contratista_lugares</code>, que todavía no existen. Están en{" "}
          <code>supabase/migrations/20261020125508_mantenimiento_partes_de_contratista.sql</code>{" "}
          y las corre una persona en el editor SQL de Supabase.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Partes diarios del contratista</h1>
          <p className="mt-1 text-sm text-slate-500">
            Se carga el papel tal como está escrito. Las órdenes de trabajo las genera el
            sistema después, una por semana, actividad y sector.
          </p>
        </div>
        <label className="block w-full sm:w-64">
          <span className="mb-1 block text-xs font-medium text-slate-500">Contratista</span>
          <Select
            value={contratista}
            onChange={(e) => setContratista(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {contratistas.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </Select>
        </label>
      </header>

      {error && (
        <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}
      {aviso && (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {aviso}
        </p>
      )}

      {puedeEditar && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Cargar un parte
          </h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo etiqueta="N° de parte">
              <input
                type="number" inputMode="numeric" value={numero}
                onChange={(e) => setNumero(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </Campo>
            <Campo etiqueta="Fecha">
              <input
                type="date" value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </Campo>
            <Campo etiqueta="A los Sres.">
              <input
                value={dirigidoA} onChange={(e) => setDirigidoA(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </Campo>
            <Campo etiqueta="Hora de entrada">
              <input
                value={horaEntrada} onChange={(e) => setHoraEntrada(e.target.value)}
                placeholder="08H"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </Campo>
            <Campo etiqueta="Hora de salida">
              <input
                value={horaSalida} onChange={(e) => setHoraSalida(e.target.value)}
                placeholder="16H"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </Campo>
            <Campo etiqueta="Materiales">
              <input
                value={materiales} onChange={(e) => setMateriales(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </Campo>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Campo etiqueta="Horas normales, como están escritas">
                <input
                  value={expresion} onChange={(e) => setExpresion(e.target.value)}
                  placeholder="2 P. x 8H + 1 P. x 2H"
                  className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              </Campo>
            </div>
            <Campo etiqueta="Total que dice el papel">
              <input
                type="number" step="0.01" value={declaradas}
                onChange={(e) => setDeclaradas(e.target.value)}
                placeholder="18"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </Campo>
            <div className="grid grid-cols-2 gap-2">
              <Campo etiqueta="Al 50 %">
                <input
                  type="number" step="0.01" value={horas50}
                  onChange={(e) => setHoras50(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </Campo>
              <Campo etiqueta="Al 100 %">
                <input
                  type="number" step="0.01" value={horas100}
                  onChange={(e) => setHoras100(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </Campo>
            </div>
          </div>

          {/* El control de la factura, a la vista mientras se carga. */}
          <div className="mt-3">
            {reparto.ok ? (
              <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Cierra: {reparto.total} h repartidas entre {renglones.length}{" "}
                {renglones.length === 1 ? "renglón" : "renglones"}.
              </p>
            ) : (
              <ul className="space-y-1 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {reparto.problemas.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </div>

          <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Detalle del trabajo
          </h3>

          <div className="space-y-3">
            {renglones.map((r, i) => {
              const horas = reparto.ok ? reparto.renglones[i]?.horas : null;
              const delSector = r.sector_id ? porSector.get(r.sector_id) ?? [] : [];
              const conocido = catalogo.has(normalizarLugar(r.lugar_raw));
              return (
                <div
                  key={i}
                  className="rounded border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <Campo etiqueta="Actividad">
                      <input
                        value={r.actividad}
                        onChange={(e) => cambiarRenglon(i, { actividad: e.target.value })}
                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                      />
                    </Campo>
                    <Campo etiqueta="Lugar, como lo escribió">
                      <input
                        value={r.lugar_raw}
                        onChange={(e) => cambiarRenglon(i, { lugar_raw: e.target.value })}
                        onBlur={() => engancharDelCatalogo(i)}
                        placeholder="Molino horizontal"
                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                      />
                    </Campo>
                    <Campo etiqueta="Sector">
                      <Select
                        value={r.sector_id}
                        onChange={(e) => cambiarRenglon(i, { sector_id: e.target.value, equipo_id: "" })}
                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="">— sin enganchar —</option>
                        {sectores.map((s) => (
                          <option key={s.id} value={s.id}>{s.nombre}</option>
                        ))}
                      </Select>
                    </Campo>
                    <Campo etiqueta="Equipo (si es uno)">
                      <Select
                        value={r.equipo_id}
                        onChange={(e) => cambiarRenglon(i, { equipo_id: e.target.value })}
                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="">— todo el sector —</option>
                        {delSector.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.code ? `${e.code} - ${e.name}` : e.name}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <span className="font-medium text-slate-600">
                      {horas === null ? "— h" : `${horas} h`}
                    </span>
                    {conocido && (
                      <span className="text-slate-400">ya estaba en el catálogo</span>
                    )}
                    {!r.sector_id && r.lugar_raw.trim() && (
                      <span className="text-amber-700">
                        sin sector no se va a convertir en OT
                      </span>
                    )}
                    {renglones.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRenglones((p) => p.filter((_, j) => j !== i))}
                        className="ml-auto text-rose-600 hover:underline"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRenglones((p) => [...p, { ...RENGLON_VACIO }])}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Agregar renglón
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={cargando || !reparto.ok}
              className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {cargando ? "Guardando…" : "Guardar parte"}
            </button>
            <button
              type="button"
              onClick={limpiar}
              className="rounded px-3 py-2 text-sm text-slate-500 hover:underline"
            >
              Limpiar
            </button>
          </div>
        </section>
      )}

      {puedeEditar && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Generar las órdenes de trabajo
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Una OT por semana, actividad y sector, ya realizada y con sus horas. Un renglón
            que ya se convirtió no se vuelve a convertir.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo etiqueta="Desde">
              <input
                type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </Campo>
            <Campo etiqueta="Hasta">
              <input
                type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </Campo>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => generar(true)}
                disabled={cargando || !desde || !hasta}
                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-40"
              >
                Ver qué se crea
              </button>
              <button
                type="button"
                onClick={() => generar(false)}
                disabled={cargando || !previo || !previo.grupos.length}
                className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {cargando ? "Generando…" : "Generar"}
              </button>
            </div>
          </div>

          {previo && <Previo previo={previo} />}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Partes cargados ({partesDelContratista.length})
        </h2>
        {partesDelContratista.length === 0 ? (
          <p className="rounded border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
            Todavía no hay partes cargados de este contratista.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-2">N°</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Semana</th>
                  <th className="px-3 py-2">Horas</th>
                  <th className="px-3 py-2">Renglones</th>
                  <th className="px-3 py-2">OT</th>
                </tr>
              </thead>
              <tbody>
                {partesDelContratista.map((p) => {
                  const rs = p.mant_partes_contratista_renglones ?? [];
                  const generados = rs.filter((r) => r.orden_trabajo_id).length;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setAbierto(abierto === p.id ? null : p.id)}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-3 py-2 font-medium">{p.numero}</td>
                      <td className="px-3 py-2">{enDiaMes(p.fecha)}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {enDiaMes(lunesDeLaSemana(p.fecha))}
                      </td>
                      <td className="px-3 py-2">{p.horas_declaradas} h</td>
                      <td className="px-3 py-2 text-slate-500">
                        {abierto === p.id
                          ? rs.map((r) => `${r.lugar_raw} (${r.horas} h)`).join(" · ")
                          : `${rs.length}`}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {generados === 0
                          ? "—"
                          : generados === rs.length ? "todas" : `${generados}/${rs.length}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Lo que se va a crear ────────────────────────────────────

interface Simulacion {
  grupos: {
    clave: string; semana: string; actividad: string; sector: string;
    equipo: string; tiene_equipo: boolean; horas: number;
    fecha_cierre: string; partes: number[]; descripcion: string;
    ya_existe: boolean; conflicto: boolean;
  }[];
  sinSector: { lugar_raw: string; parte_numero: number; horas: number }[];
  tope: number;
}

/**
 * La vista previa.
 *
 * Existe porque generar veinte OT no se deshace: una orden posteada en la
 * planilla se borra a mano, fila por fila. Ver qué sale antes es más barato
 * que arreglarlo después.
 */
function Previo({ previo }: { previo: Simulacion }) {
  return (
    <div className="mt-4 space-y-3">
      {previo.sinSector.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">
            {previo.sinSector.length} renglones no tienen sector, así que no se convierten:
          </p>
          <p className="mt-1">
            {previo.sinSector
              .map((r) => `«${r.lugar_raw}» (parte ${r.parte_numero}, ${r.horas} h)`)
              .join(" · ")}
          </p>
          <p className="mt-1 text-xs">
            Engancharlos pide corregir el parte. No se los manda a un sector parecido:
            las horas quedarían contra un centro de costo que nadie eligió.
          </p>
        </div>
      )}

      {previo.grupos.length === 0 ? (
        <p className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-500">
          No hay nada para convertir en ese rango.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2">Qué pasa</th>
                <th className="px-3 py-2">Semana</th>
                <th className="px-3 py-2">Actividad</th>
                <th className="px-3 py-2">Sector</th>
                <th className="px-3 py-2">Equipo</th>
                <th className="px-3 py-2">Horas</th>
                <th className="px-3 py-2">Partes</th>
              </tr>
            </thead>
            <tbody>
              {previo.grupos.map((g) => (
                <tr key={g.clave} className="border-t border-slate-100">
                  {/* Crear y sumar no son lo mismo y la diferencia importa:
                      «suma» quiere decir que esa semana ya tenía su orden y
                      queda con el total de las dos tandas, no con dos órdenes. */}
                  <td className="px-3 py-2">
                    {g.conflicto ? (
                      <span className="text-rose-700">revisar a mano</span>
                    ) : g.ya_existe ? (
                      <span className="text-amber-700">suma horas</span>
                    ) : (
                      <span className="text-emerald-700">OT nueva</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{enDiaMes(g.semana)}</td>
                  <td className="px-3 py-2">{g.actividad}</td>
                  <td className="px-3 py-2">{g.sector}</td>
                  <td className={`px-3 py-2 ${g.tiene_equipo ? "" : "text-slate-400"}`}>
                    {g.equipo}
                  </td>
                  <td className="px-3 py-2 font-medium">{g.horas} h</td>
                  <td className="px-3 py-2 text-slate-500">{g.partes.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previo.grupos.length > previo.tope && (
        <p className="text-xs text-amber-700">
          Se crean {previo.tope} por corrida; las {previo.grupos.length - previo.tope}{" "}
          restantes quedan para apretar de nuevo.
        </p>
      )}
    </div>
  );
}

// ── Piezas chicas ───────────────────────────────────────────

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{etiqueta}</span>
      {children}
    </label>
  );
}

/** "2026-10-01" → "1/10". */
function enDiaMes(fecha: string): string {
  const [, mes, dia] = String(fecha ?? "").split("-");
  return mes && dia ? `${Number(dia)}/${Number(mes)}` : fecha;
}

/**
 * El día siguiente, para encadenar las quince hojas de una quincena.
 *
 * En UTC: una fecha sin hora construida como local se corre un día en
 * Argentina, y acá eso mandaría el parte a la semana de al lado.
 */
function sumarUnDia(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
