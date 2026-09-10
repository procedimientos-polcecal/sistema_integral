"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClaveDeParte } from "@/lib/produccion/turnos";
import { comoSeLeeElTurno } from "@/lib/produccion/turnos";
import type { Turno, RenglonDePapel, Familia, Parte, Despacho } from "@/lib/produccion/types";
import { produccionDelTurno } from "@/lib/produccion/produccion";
import { totalesDeDespacho, roturaTotal, desajustesDeKilos } from "@/lib/produccion/despachos";
import {
  interpretarCantidadDeDeposito,
  interpretarCantidadOpcional,
  interpretarRotura,
  type ResultadoCantidad,
} from "@/lib/produccion/cantidades";

interface Empleado {
  id: string;
  nombre: string;
  apellido: string | null;
}

interface Props {
  fecha: string;
  turno: Turno;
  turnoLegible: string;
  puedeEditar: boolean;
  /** Los renglones del papel, completos (activos e inactivos): cargar y conservar no son lo mismo, ver más abajo. */
  renglonesDePapel: RenglonDePapel[];
  /** Kilos por unidad de cada renglón, despejados de los productos que tiene enlazados. */
  kgPorRenglon: Record<string, number | null>;
  parte: Parte | null;
  deposito: Record<string, number>;
  despachos: Despacho[];
  /** `null` = ese parte no existe: es lo que hace que la producción se muestre como no calculable. */
  depositoAnterior: Record<string, number> | null;
  parteAnterior: ClaveDeParte;
  empleados: Empleado[];
}

interface RenglonForm {
  /** Sólo para React y para cruzar con `desajustesDeKilos` en el cliente. No viaja al servidor. */
  key: string;
  equipo_raw: string;
  cliente_raw: string;
  renglon_papel_id: string;
  producto_raw: string;
  kilos: string;
  bultos: string;
  envase_raw: string;
  pallets_cantidad: string;
  pallets_tipo: string;
  rotura_bolsa: string;
  rotura_bolson: string;
}

const FAMILIAS: { clave: Familia; etiqueta: string }[] = [
  { clave: "filler", etiqueta: "Filler" },
  { clave: "0_2", etiqueta: "0-2" },
  { clave: "cal", etiqueta: "Cal" },
  { clave: "otros", etiqueta: "Otros" },
];

function nuevoRenglon(): RenglonForm {
  return {
    key: crypto.randomUUID(),
    equipo_raw: "", cliente_raw: "", renglon_papel_id: "", producto_raw: "",
    kilos: "", bultos: "", envase_raw: "", pallets_cantidad: "", pallets_tipo: "",
    rotura_bolsa: "", rotura_bolson: "",
  };
}

function renglonDesdeDespacho(d: Despacho): RenglonForm {
  return {
    key: d.id,
    equipo_raw: d.equipo_raw ?? "",
    cliente_raw: d.cliente_raw ?? "",
    renglon_papel_id: d.renglon_papel_id ?? "",
    producto_raw: d.producto_raw ?? "",
    kilos: d.kilos !== null ? String(d.kilos) : "",
    bultos: d.bultos !== null ? String(d.bultos) : "",
    envase_raw: d.envase_raw ?? "",
    pallets_cantidad: d.pallets_cantidad !== null ? String(d.pallets_cantidad) : "",
    pallets_tipo: d.pallets_tipo ?? "",
    rotura_bolsa: d.rotura_bolsa ? String(d.rotura_bolsa) : "",
    rotura_bolson: d.rotura_bolson ? String(d.rotura_bolson) : "",
  };
}

function fechaCorta(fecha: string): string {
  return new Date(`${fecha}T00:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

/** Un número para la vista previa: nunca tira, un texto inválido queda afuera de la cuenta en vez de romperla. */
function numeroOpcionalDePreview(texto: string): number | null {
  if (texto.trim() === "") return null;
  const r = interpretarCantidadOpcional(texto);
  return r.ok ? r.valor : null;
}

function numeroDeRoturaPreview(texto: string): number {
  const r = interpretarRotura(texto);
  return r.ok ? r.valor : 0;
}

/**
 * La carga de un parte, en el orden del papel: cabecera y capataz, depósito
 * por familia, despachos y los tres textos.
 *
 * La producción se muestra en vivo, calculada con `produccionDelTurno()` sobre
 * lo que hay tipeado en este momento: hoy ese número aparece recién al día
 * siguiente, cuando alguien aprieta el botón del Excel. Verlo mientras se
 * transcribe es lo que hace que un error de tipeo se note en el momento y no
 * un día después.
 */
export default function ParteClient({
  fecha, turno, turnoLegible, puedeEditar, renglonesDePapel, kgPorRenglon, parte, deposito,
  despachos, depositoAnterior, parteAnterior, empleados,
}: Props) {
  const router = useRouter();

  // Los activos son las filas editables de siempre — incluida la lista que
  // ofrece el desplegable "Reconocido como" de cada despacho: nadie tiene que
  // poder cargar un producto discontinuado (mismo criterio que el comentario
  // de `armarElDia` en lib/produccion/consultas.ts).
  const productosActivos = useMemo(() => renglonesDePapel.filter((p) => p.activo), [renglonesDePapel]);

  // Un producto inactivo que ya tiene un valor en este parte no puede
  // desaparecer del depósito: si el catálogo sólo trajera los activos, el
  // renglón de este producto nunca se muestra ni se reenvía, y el POST borra
  // esa fila del depósito al reemplazarlo entero — la próxima corrección de
  // este mismo parte perdería ese valor, y el turno siguiente calcularía la
  // producción contra un depósito que le falta un producto (se lee como cero).
  // Uno inactivo *sin* valor acá no tiene nada que perder, y no se muestra.
  const productosEnUso = useMemo(
    () => renglonesDePapel.filter((p) => p.activo || deposito[p.id] !== undefined),
    [renglonesDePapel, deposito]
  );

  const [capatazRaw, setCapatazRaw] = useState(parte?.capataz_raw ?? "");
  const [capatazId, setCapatazId] = useState(parte?.capataz_id ?? "");
  const [observaciones, setObservaciones] = useState(parte?.observaciones ?? "");
  const [limpieza, setLimpieza] = useState(parte?.tareas_limpieza ?? "");
  const [recuento, setRecuento] = useState(parte?.recuento_bolsones ?? "");

  // Una entrada por cada producto en uso (activo, o inactivo con valor),
  // aunque el usuario nunca la haya tocado: el input queda en blanco y en
  // blanco vale cero, no "no sé".
  const [depositoTexto, setDepositoTexto] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const p of productosEnUso) {
      inicial[p.id] = deposito[p.id] !== undefined ? String(deposito[p.id]) : "";
    }
    return inicial;
  });

  const [renglones, setRenglones] = useState<RenglonForm[]>(() =>
    [...despachos].sort((a, b) => a.orden - b.orden).map(renglonDesdeDespacho)
  );

  const [guardando, setGuardando] = useState(false);
  const [reintentando, setReintentando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<{ planilla: string; error_planilla: string | null } | null>(null);
  const [pendienteAlCargar, setPendienteAlCargar] = useState(parte?.sheets_pendiente ?? null);

  function actualizarRenglon(key: string, cambios: Partial<RenglonForm>) {
    setRenglones((rs) => rs.map((r) => (r.key === key ? { ...r, ...cambios } : r)));
  }
  function agregarRenglon() {
    setRenglones((rs) => [...rs, nuevoRenglon()]);
  }
  function quitarRenglon(key: string) {
    setRenglones((rs) => rs.filter((r) => r.key !== key));
  }

  // ── La producción en vivo ──────────────────────────────────
  // Un valor que no se puede leer queda afuera de la cuenta (como si no
  // estuviera escrito) en vez de romper la vista previa entera: el error real
  // se junta más abajo, en `erroresDeValidacion`, y frena el guardado.
  const depositoNumerico = useMemo(() => {
    const salida: Record<string, number> = {};
    for (const p of productosEnUso) {
      const texto = (depositoTexto[p.id] ?? "").trim();
      if (texto === "") { salida[p.id] = 0; continue; }
      const r = interpretarCantidadDeDeposito(texto);
      salida[p.id] = r.ok ? r.valor : 0;
    }
    return salida;
  }, [productosEnUso, depositoTexto]);

  const despachosDePreview: Despacho[] = useMemo(
    () =>
      renglones.map((r, i) => ({
        id: r.key,
        parte_id: parte?.id ?? "",
        orden: i + 1,
        equipo_raw: r.equipo_raw || null,
        cliente_raw: r.cliente_raw || null,
        renglon_papel_id: r.renglon_papel_id || null,
        producto_raw: r.producto_raw || null,
        kilos: numeroOpcionalDePreview(r.kilos),
        bultos: numeroOpcionalDePreview(r.bultos),
        envase_raw: r.envase_raw || null,
        pallets_cantidad: numeroOpcionalDePreview(r.pallets_cantidad),
        pallets_tipo: r.pallets_tipo || null,
        rotura_bolsa: numeroDeRoturaPreview(r.rotura_bolsa),
        rotura_bolson: numeroDeRoturaPreview(r.rotura_bolson),
      })),
    [renglones, parte]
  );

  const totales = useMemo(() => totalesDeDespacho(despachosDePreview), [despachosDePreview]);
  const rotura = useMemo(() => roturaTotal(totales), [totales]);
  const produccion = useMemo(
    () =>
      produccionDelTurno({
        deposito: depositoNumerico,
        depositoAnterior,
        despachado: totales.despachado,
        rotura,
      }),
    [depositoNumerico, depositoAnterior, totales, rotura]
  );

  // ── Lo que la vista previa no puede mostrar como un número ──
  // `depositoNumerico`, y las dos funciones de preview de arriba, convierten
  // un texto que no se pudo leer en 0 (o en null) para no romper la cuenta en
  // vivo — pero ese 0 no es un dato, es "no se sabe", y mostrarlo como una
  // producción calculada es exactamente el error que este módulo vino a
  // corregir: una fila con un tipeo se vería igual que una fila con un
  // problema real de stock. Acá se guarda, aparte, qué renglonesDePapel tienen algo
  // sin poder leerse (depósito, o la rotura/los bultos de algún despacho que
  // los referencia), para que esa fila diga "no calculable" en vez de un
  // número inventado. El guardado ya está frenado por `erroresDeValidacion`
  // más abajo; esto es sólo la vista previa.
  const productosNoCalculables = useMemo(() => {
    const no = new Set<string>();

    for (const p of productosEnUso) {
      const texto = (depositoTexto[p.id] ?? "").trim();
      if (texto !== "" && !interpretarCantidadDeDeposito(texto).ok) no.add(p.id);
    }

    for (const r of renglones) {
      if (!r.renglon_papel_id) continue;
      const invalido =
        !interpretarCantidadOpcional(r.bultos).ok ||
        !interpretarRotura(r.rotura_bolsa).ok ||
        !interpretarRotura(r.rotura_bolson).ok;
      if (invalido) no.add(r.renglon_papel_id);
    }

    return no;
  }, [productosEnUso, depositoTexto, renglones]);

  /**
   * El kg por unidad ya no es del renglón del papel sino del producto, y un
   * renglón puede agrupar varios: lo despeja `kgPorRenglonDePapel` en el
   * servidor, que deja en null el renglón cuyos productos no coinciden. Acá
   * sólo se indexa.
   */
  const kgPorUnidad = useMemo(() => new Map(Object.entries(kgPorRenglon)), [kgPorRenglon]);
  // Avisa, no bloquea: el papel es el papel. Se muestra debajo de la tabla y
  // el guardado sigue andando igual.
  const desajustes = useMemo(
    () => desajustesDeKilos(despachosDePreview, kgPorUnidad),
    [despachosDePreview, kgPorUnidad]
  );

  // ── Lo que sí frena el guardado ────────────────────────────
  // Mismas funciones que usa la ruta (`lib/produccion/cantidades.ts`), para no
  // duplicar qué es un error y qué es un vacío legítimo. Frenar acá evita un
  // viaje al servidor sólo para enterarse de un tipeo.
  const erroresDeValidacion = useMemo(() => {
    const errores: string[] = [];

    for (const p of productosEnUso) {
      const texto = (depositoTexto[p.id] ?? "").trim();
      if (texto === "") continue;
      const r = interpretarCantidadDeDeposito(texto);
      if (!r.ok) errores.push(`Depósito, ${p.nombre}: ${r.error}`);
    }

    renglones.forEach((r, i) => {
      const revisar = (etiqueta: string, valor: string, fn: (v: unknown) => ResultadoCantidad<unknown>) => {
        if (valor.trim() === "") return;
        const res = fn(valor);
        if (!res.ok) errores.push(`Despacho, renglón ${i + 1}, ${etiqueta}: ${res.error}`);
      };
      revisar("kilos", r.kilos, interpretarCantidadOpcional);
      revisar("bultos", r.bultos, interpretarCantidadOpcional);
      revisar("cantidad de pallets", r.pallets_cantidad, interpretarCantidadOpcional);
      revisar("rotura de bolsa", r.rotura_bolsa, interpretarRotura);
      revisar("rotura de bolsón", r.rotura_bolson, interpretarRotura);
    });

    return errores;
  }, [productosEnUso, depositoTexto, renglones]);

  async function guardar() {
    if (!puedeEditar || guardando || erroresDeValidacion.length > 0) return;
    setGuardando(true);
    setError("");
    setResultado(null);

    const res = await fetch("/api/produccion/partes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha, turno,
        capataz_raw: capatazRaw, capataz_id: capatazId || null,
        observaciones, tareas_limpieza: limpieza, recuento_bolsones: recuento,
        // Una entrada por **cada producto en uso** (activo, o inactivo con un
        // valor en este parte), aunque el input haya quedado en blanco — no
        // sólo los que se tocaron. Un producto ausente se lee como cero al
        // despejar, y eso vale para el turno siguiente también: si falta acá,
        // ese turno sale con una producción negativa sin motivo aparente. Un
        // inactivo con valor se reenvía igual, sin editar (el input queda
        // deshabilitado): por eso desaparecía del depósito al corregir un
        // parte después de desactivar el producto.
        deposito: productosEnUso.map((p) => {
          const texto = (depositoTexto[p.id] ?? "").trim();
          return { renglon_papel_id: p.id, cantidad: texto === "" ? "0" : texto };
        }),
        despachos: renglones.map((r) => ({
          equipo_raw: r.equipo_raw,
          cliente_raw: r.cliente_raw,
          renglon_papel_id: r.renglon_papel_id || null,
          producto_raw: r.producto_raw,
          kilos: r.kilos,
          bultos: r.bultos,
          envase_raw: r.envase_raw,
          pallets_cantidad: r.pallets_cantidad,
          pallets_tipo: r.pallets_tipo,
          rotura_bolsa: r.rotura_bolsa,
          rotura_bolson: r.rotura_bolson,
        })),
      }),
    });
    const json = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(json.error ?? "No se pudo guardar."); return; }

    setPendienteAlCargar(null);
    // El fallo de planilla se muestra con lo que dijo Google, sin traducir: es
    // lo único que permite distinguir "falta la fila del 31" de "falta el
    // permiso".
    setResultado({ planilla: json.planilla, error_planilla: json.error_planilla ?? null });
    // La fuente de verdad es el servidor: refresca `parte`, `depositoAnterior`
    // y `deposito` para que un "no calculable" que ya se puede calcular (por
    // ejemplo, porque mientras tanto se cargó el parte anterior) deje de
    // mostrarse. `DiaClient` y `ProductosClient` ya hacen lo mismo después de
    // guardar.
    router.refresh();
  }

  async function reintentarPlanilla() {
    setReintentando(true);
    const res = await fetch("/api/produccion/planilla/reintentar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha }),
    });
    const json = await res.json().catch(() => ({}));
    setReintentando(false);
    if (!res.ok) { setError(json.error ?? "No se pudo reintentar."); return; }
    setPendienteAlCargar(null);
    setResultado({ planilla: json.planilla, error_planilla: json.error_planilla ?? null });
    router.refresh();
  }

  const productosPorFamilia = (familia: Familia) => productosEnUso.filter((p) => p.familia === familia);

  return (
    <div className="mx-auto max-w-4xl space-y-6 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Parte del {fechaCorta(fecha)} · turno {turnoLegible}
        </h1>
        <p className="text-sm text-slate-500">
          {parte ? "Corrigiendo un parte ya cargado." : "Cargando un parte nuevo."} Formulario 040/2,
          informe de fábrica.
        </p>
      </div>

      {/* El dato que hace que la producción se muestre como no calculable en
          vez de salir de restar contra un depósito anterior inventado. */}
      {depositoAnterior === null && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No está cargado el parte del {fechaCorta(parteAnterior.fecha)} turno{" "}
          {comoSeLeeElTurno(parteAnterior.turno)}, así que la producción de este turno no se puede
          calcular.{" "}
          <Link
            href={`/produccion/parte/${parteAnterior.fecha}/${parteAnterior.turno}`}
            className="font-semibold underline hover:text-amber-900"
          >
            Cargarlo
          </Link>
        </div>
      )}

      {pendienteAlCargar && !resultado && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Este parte no llegó a la planilla: <strong>{pendienteAlCargar}</strong>.{" "}
          <button
            type="button"
            onClick={reintentarPlanilla}
            disabled={reintentando}
            className="font-semibold underline hover:text-amber-900 disabled:opacity-50"
          >
            {reintentando ? "Reintentando…" : "Reintentar"}
          </button>
        </div>
      )}

      {/* ── 1. Cabecera y capataz ────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Capataz de turno</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Como firmó el papel</span>
            <input
              value={capatazRaw}
              onChange={(e) => setCapatazRaw(e.target.value)}
              disabled={!puedeEditar}
              placeholder="Nombre tal como está escrito"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Reconocido como</span>
            <select
              value={capatazId}
              onChange={(e) => setCapatazId(e.target.value)}
              disabled={!puedeEditar}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            >
              <option value="">— sin reconocer —</option>
              {empleados.map((e) => (
                <option key={e.id} value={e.id}>
                  {[e.apellido, e.nombre].filter(Boolean).join(", ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* ── 2. Depósito, en el orden del papel ───────────────── */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Material en depósito</h2>
          <p className="text-xs text-slate-500">
            Un renglón por producto. En blanco vale cero — no lo dejes así si en
            realidad no se contó.
          </p>
        </div>

        {productosEnUso.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">
            Todavía no hay renglonesDePapel en el catálogo, así que no hay nada que
            cargar acá. El resto del parte —capataz, despachos y los textos— se
            puede guardar igual.
          </p>
        ) : (
          FAMILIAS.map(({ clave, etiqueta }) => {
            const deEstaFamilia = productosPorFamilia(clave);
            if (deEstaFamilia.length === 0) return null;
            return (
              <div key={clave} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {etiqueta}
                </h3>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {deEstaFamilia.map((p) => {
                    const prod = produccion[p.id];
                    const texto = depositoTexto[p.id] ?? "";
                    const noCalculable = productosNoCalculables.has(p.id);
                    return (
                      <div key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
                          {p.nombre}
                          {!p.activo && (
                            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-slate-500">
                              Desactivado
                            </span>
                          )}
                        </span>
                        <input
                          value={texto}
                          onChange={(e) =>
                            setDepositoTexto((d) => ({ ...d, [p.id]: e.target.value }))
                          }
                          // Un producto inactivo se conserva, no se edita: ya
                          // no se puede volver a cargar (mismo criterio que el
                          // resto del sistema), así que el valor que trajo el
                          // parte queda fijo y se reenvía tal cual.
                          disabled={!puedeEditar || !p.activo}
                          inputMode="decimal"
                          placeholder="0"
                          className="w-24 shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm disabled:bg-slate-50"
                        />
                        <span className="w-44 shrink-0 text-right text-xs">
                          {noCalculable ? (
                            // Hay un texto acá (o en algún despacho de este
                            // producto) que no se pudo leer como número: no es
                            // un vacío legítimo, así que no se muestra una
                            // producción calculada sobre un 0 inventado.
                            <span className="text-slate-400">no calculable</span>
                          ) : !prod ? (
                            <span className="text-slate-300">—</span>
                          ) : prod.estado === "calculada" ? (
                            <span className={prod.cantidad < 0 ? "font-semibold text-red-600" : "text-slate-500"}>
                              Producción: {prod.cantidad}
                            </span>
                          ) : (
                            // `produccionDelTurno` sólo puede devolver
                            // "sin_parte_anterior" acá (nunca
                            // "dia_incompleto", que es cosa de
                            // `produccionDelDia`), y ya está avisado arriba de
                            // todo — este texto es la marca fila por fila.
                            <span className="text-slate-400">no calculable</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* ── 3. Despachos, una tarjeta por camión ─────────────── */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Material despachado</h2>
            <p className="text-xs text-slate-500">Una tarjeta por camión, en el orden en que salieron.</p>
          </div>
          {puedeEditar && (
            <button
              type="button"
              onClick={agregarRenglon}
              className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              + Agregar renglón
            </button>
          )}
        </div>

        {renglones.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-400">
            Sin camiones despachados en este turno todavía.
          </p>
        ) : (
          <div className="space-y-3">
            {renglones.map((r, i) => (
              <RenglonDespacho
                key={r.key}
                indice={i}
                renglon={r}
                renglonesDePapel={productosActivos}
                puedeEditar={puedeEditar}
                onCambiar={(cambios) => actualizarRenglon(r.key, cambios)}
                onQuitar={() => quitarRenglon(r.key)}
              />
            ))}
          </div>
        )}

        {desajustes.length > 0 && (
          <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-semibold">
              Los kilos no cierran con los bultos en {desajustes.length === 1 ? "este renglón" : "estos renglones"}{" "}
              — se guarda igual, el papel es el papel:
            </p>
            <ul className="list-disc space-y-0.5 pl-4">
              {desajustes.map((d) => {
                const indice = renglones.findIndex((r) => r.key === d.despachoId);
                return (
                  <li key={d.despachoId}>
                    Renglón {indice + 1}: {d.kilos} kg para {d.bultos} bultos (se esperaban ~
                    {Math.round(d.kilosEsperados)} kg)
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* ── 4. Los tres textos ────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Observaciones y cierre de turno</h2>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Observaciones</span>
          <textarea
            rows={3}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            disabled={!puedeEditar}
            placeholder="Paradas de máquina, con horario…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Tareas de limpieza</span>
          <textarea
            rows={2}
            value={limpieza}
            onChange={(e) => setLimpieza(e.target.value)}
            disabled={!puedeEditar}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Recuento de bolsones</span>
          <textarea
            rows={2}
            value={recuento}
            onChange={(e) => setRecuento(e.target.value)}
            disabled={!puedeEditar}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
          />
        </label>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {resultado && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            resultado.planilla === "escrita" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"
          }`}
        >
          {resultado.planilla === "escrita" ? (
            "Guardado y escrito en la planilla."
          ) : (
            <>
              Guardado, pero no llegó a la planilla: <strong>{resultado.error_planilla}</strong>.{" "}
              <button
                type="button"
                onClick={reintentarPlanilla}
                disabled={reintentando}
                className="font-semibold underline hover:text-amber-900 disabled:opacity-50"
              >
                {reintentando ? "Reintentando…" : "Reintentar"}
              </button>
            </>
          )}
        </div>
      )}

      {erroresDeValidacion.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <p className="font-semibold">
            Hay {erroresDeValidacion.length === 1 ? "un dato" : "datos"} que no se{" "}
            {erroresDeValidacion.length === 1 ? "puede" : "pueden"} guardar todavía:
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {erroresDeValidacion.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {puedeEditar ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={guardar}
            disabled={guardando || erroresDeValidacion.length > 0}
            className="flex-1 rounded-xl bg-[var(--primary)] px-4 py-3 text-base font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar parte"}
          </button>
          <Link
            href="/produccion"
            className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Volver
          </Link>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Tu nivel de acceso en Producción es de sólo lectura: podés ver el parte pero no guardarlo.
        </p>
      )}
    </div>
  );
}

/** Una tarjeta por camión: equipo, cliente, producto, kilos y bultos, envase, pallets y rotura. */
function RenglonDespacho({
  indice, renglon, renglonesDePapel, puedeEditar, onCambiar, onQuitar,
}: {
  indice: number;
  renglon: RenglonForm;
  renglonesDePapel: RenglonDePapel[];
  puedeEditar: boolean;
  onCambiar: (cambios: Partial<RenglonForm>) => void;
  onQuitar: () => void;
}) {
  function errorDe(valor: string, fn: (v: unknown) => ResultadoCantidad<unknown>): string | null {
    if (valor.trim() === "") return null;
    const r = fn(valor);
    return r.ok ? null : r.error;
  }

  function campo(
    etiqueta: string,
    valor: string,
    onChange: (v: string) => void,
    opciones?: { numerico?: boolean; error?: string | null; placeholder?: string }
  ) {
    return (
      <label className="block">
        <span className="text-xs font-medium text-slate-600">{etiqueta}</span>
        <input
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          disabled={!puedeEditar}
          inputMode={opciones?.numerico ? "decimal" : undefined}
          placeholder={opciones?.placeholder}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        />
        {opciones?.error && <span className="mt-0.5 block text-xs text-red-600">{opciones.error}</span>}
      </label>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400">Renglón {indice + 1}</span>
        {puedeEditar && (
          <button type="button" onClick={onQuitar} className="text-xs text-red-600 hover:text-red-800">
            Quitar
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {campo("Equipo", renglon.equipo_raw, (v) => onCambiar({ equipo_raw: v }))}
        {campo("Cliente", renglon.cliente_raw, (v) => onCambiar({ cliente_raw: v }))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {campo("Producto (como está escrito)", renglon.producto_raw, (v) => onCambiar({ producto_raw: v }))}
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Reconocido como</span>
          <select
            value={renglon.renglon_papel_id}
            disabled={!puedeEditar}
            onChange={(e) => {
              const id = e.target.value;
              const p = renglonesDePapel.find((x) => x.id === id);
              onCambiar({
                renglon_papel_id: id,
                // Si todavía no se escribió nada, elegir del catálogo lo
                // completa; si ya hay un texto (lo que dice el papel), no se
                // pisa: puede no coincidir letra por letra con el nombre del
                // catálogo y eso está bien, es lo que dice el papel.
                producto_raw: !renglon.producto_raw.trim() && p ? p.nombre : renglon.producto_raw,
              });
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
          >
            <option value="">— sin reconocer —</option>
            {renglonesDePapel.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {campo("Kilos", renglon.kilos, (v) => onCambiar({ kilos: v }), {
          numerico: true,
          error: errorDe(renglon.kilos, interpretarCantidadOpcional),
        })}
        {campo("Bultos", renglon.bultos, (v) => onCambiar({ bultos: v }), {
          numerico: true,
          error: errorDe(renglon.bultos, interpretarCantidadOpcional),
        })}
        {campo("Envase", renglon.envase_raw, (v) => onCambiar({ envase_raw: v }), {
          placeholder: "bolsa / bolsón",
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {campo("Cantidad de pallets", renglon.pallets_cantidad, (v) => onCambiar({ pallets_cantidad: v }), {
          numerico: true,
          error: errorDe(renglon.pallets_cantidad, interpretarCantidadOpcional),
        })}
        {campo("Tipo de pallet", renglon.pallets_tipo, (v) => onCambiar({ pallets_tipo: v }))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {campo("Rotura en bolsa", renglon.rotura_bolsa, (v) => onCambiar({ rotura_bolsa: v }), {
          numerico: true,
          error: errorDe(renglon.rotura_bolsa, interpretarRotura),
        })}
        {campo("Rotura en bolsón", renglon.rotura_bolson, (v) => onCambiar({ rotura_bolson: v }), {
          numerico: true,
          error: errorDe(renglon.rotura_bolson, interpretarRotura),
        })}
      </div>
    </div>
  );
}
