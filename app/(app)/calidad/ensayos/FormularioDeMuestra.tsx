"use client";

import { useMemo, useState } from "react";
import Select from "@/components/Select";
import { calUtilVial, humedad, pesoVolumetrico } from "@/lib/calidad/ensayos/determinaciones";
import { granulometria } from "@/lib/calidad/ensayos/granulometria";
import { fueraDeLimite, limiteDe } from "@/lib/calidad/ensayos/limites";
import type {
  Determinacion,
  Limite,
  ProductoDeEnsayo,
  ValorEvaluado,
} from "@/lib/calidad/ensayos/types";

/**
 * El formulario de una muestra, compartido por la carga y la corrección.
 *
 * **El resultado se calcula mientras se tipea**, con las mismas funciones puras
 * que usa el servidor: son puras, así que corren igual de los dos lados. Quien
 * carga ve el 0,91% al terminar de poner el tercer peso y se da cuenta en el
 * momento si se equivocó de columna — que es la mitad de lo que el Excel no
 * podía hacer, porque el número aparecía recién al salir de la celda y nadie lo
 * miraba.
 *
 * Los cuatro bloques son opcionales: en el archivo hay muestras que son sólo
 * humedad y otras sólo granulometría.
 */

export interface ValoresDeLaMuestra {
  fecha: string;
  producto_id: string;
  observaciones: string;
  humedad_p_recipiente: string;
  humedad_p_inicial: string;
  humedad_p_final: string;
  peso_vol_gramos: string;
  peso_vol_volumen_cc: string;
  cal_util_ml_acido: string;
  cal_util_peso_muestra_g: string;
  granulometria_peso_muestra_g: string;
  retenidos: { malla: string; retenido_g: string }[];
}

/** El recipiente que usa el laboratorio. Se precarga, pero va guardado. */
const VOLUMEN_HABITUAL = "330";
/** El peso sobre el que se titula hoy. Mismo criterio. */
const PESO_TITULADO_HABITUAL = "3";

export function valoresVacios(hoy: string): ValoresDeLaMuestra {
  return {
    fecha: hoy,
    producto_id: "",
    observaciones: "",
    humedad_p_recipiente: "",
    humedad_p_inicial: "",
    humedad_p_final: "",
    peso_vol_gramos: "",
    peso_vol_volumen_cc: VOLUMEN_HABITUAL,
    cal_util_ml_acido: "",
    cal_util_peso_muestra_g: PESO_TITULADO_HABITUAL,
    granulometria_peso_muestra_g: "",
    retenidos: [],
  };
}

function aNumero(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function Resultado({ valor, unidad }: { valor: ValorEvaluado; unidad: string }) {
  if (valor.valor === null && !valor.problema) return null;
  return (
    <p className="text-sm">
      {valor.valor !== null && (
        <span className={valor.fuera ? "font-semibold text-red-700" : "font-semibold text-slate-900"}>
          {valor.valor.toLocaleString("es-AR")} {unidad}
          {valor.fuera === "alto" && " · por encima del límite"}
          {valor.fuera === "bajo" && " · por debajo del límite"}
        </span>
      )}
      {valor.problema && <span className="ml-2 text-amber-700">{valor.problema}</span>}
    </p>
  );
}

function Campo({
  etiqueta,
  valor,
  onChange,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{etiqueta}</span>
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
      />
    </label>
  );
}

export default function FormularioDeMuestra({
  productos,
  limites,
  inicial,
  textoDelBoton,
  onGuardar,
  onBorrar,
}: {
  productos: ProductoDeEnsayo[];
  limites: Limite[];
  inicial: ValoresDeLaMuestra;
  textoDelBoton: string;
  onGuardar: (v: ValoresDeLaMuestra) => Promise<string | null>;
  onBorrar?: () => Promise<void>;
}) {
  const [v, setV] = useState<ValoresDeLaMuestra>(inicial);
  const [nuevaMalla, setNuevaMalla] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function set<K extends keyof ValoresDeLaMuestra>(campo: K, valor: ValoresDeLaMuestra[K]) {
    setV((previo) => ({ ...previo, [campo]: valor }));
  }

  /** Al elegir el producto, la granulometría arranca con sus mallas habituales. */
  function elegirProducto(id: string) {
    const producto = productos.find((p) => p.id === id);
    setV((previo) => ({
      ...previo,
      producto_id: id,
      retenidos:
        previo.retenidos.length > 0
          ? previo.retenidos
          : (producto?.mallas ?? []).map((m) => ({ malla: String(m), retenido_g: "" })),
    }));
  }

  const delProducto = useMemo(
    () => limites.filter((l) => l.producto_id === v.producto_id),
    [limites, v.producto_id]
  );

  function conLimite(evaluado: ValorEvaluado, d: Determinacion, malla: number | null): ValorEvaluado {
    const fuera = fueraDeLimite(evaluado.valor, limiteDe(delProducto, d, malla));
    return fuera ? { ...evaluado, fuera } : evaluado;
  }

  const hum = conLimite(
    humedad({
      recipiente: aNumero(v.humedad_p_recipiente),
      inicial: aNumero(v.humedad_p_inicial),
      final: aNumero(v.humedad_p_final),
    }),
    "humedad",
    null
  );

  const pv = conLimite(
    pesoVolumetrico({
      gramos: aNumero(v.peso_vol_gramos),
      volumenCc: aNumero(v.peso_vol_volumen_cc),
    }),
    "peso_volumetrico",
    null
  );

  const cuv = conLimite(
    calUtilVial({
      mlAcido: aNumero(v.cal_util_ml_acido),
      pesoMuestraG: aNumero(v.cal_util_peso_muestra_g),
    }),
    "cal_util_vial",
    null
  );

  const granulo = granulometria({
    pesoMuestraG: aNumero(v.granulometria_peso_muestra_g),
    retenidos: v.retenidos
      .map((r) => ({ malla: aNumero(r.malla), retenido_g: aNumero(r.retenido_g) }))
      .filter((r): r is { malla: number; retenido_g: number } =>
        r.malla !== null && r.retenido_g !== null
      ),
  });

  function agregarMalla() {
    const n = aNumero(nuevaMalla);
    if (n === null || !Number.isInteger(n) || n <= 0) return;
    if (v.retenidos.some((r) => aNumero(r.malla) === n)) return;
    set("retenidos", [...v.retenidos, { malla: String(n), retenido_g: "" }]);
    setNuevaMalla("");
  }

  async function guardar() {
    setError(null);
    setGuardando(true);
    const problema = await onGuardar(v);
    setGuardando(false);
    if (problema) setError(problema);
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-slate-600">Fecha</span>
          <input
            type="date"
            value={v.fecha}
            onChange={(e) => set("fecha", e.target.value)}
            className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-600">Producto</span>
          <Select
            value={v.producto_id}
            onChange={(e) => elegirProducto(e.target.value)}
            className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Elegir…</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>
        </label>

        <label className="block text-sm">
          <span className="text-slate-600">Observaciones</span>
          <input
            value={v.observaciones}
            onChange={(e) => set("observaciones", e.target.value)}
            placeholder="retorno, producción, silo 3, 600 Hz…"
            className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
      </section>

      <section className="space-y-2 rounded border border-slate-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-slate-700">Humedad</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Campo
            etiqueta="P recipiente (g)"
            valor={v.humedad_p_recipiente}
            onChange={(x) => set("humedad_p_recipiente", x)}
          />
          <Campo
            etiqueta="P inicial (g)"
            valor={v.humedad_p_inicial}
            onChange={(x) => set("humedad_p_inicial", x)}
          />
          <Campo
            etiqueta="P final (g)"
            valor={v.humedad_p_final}
            onChange={(x) => set("humedad_p_final", x)}
          />
        </div>
        <Resultado valor={hum} unidad="%" />
      </section>

      <section className="space-y-2 rounded border border-slate-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-slate-700">Peso volumétrico</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Campo
            etiqueta="Gramos pesados"
            valor={v.peso_vol_gramos}
            onChange={(x) => set("peso_vol_gramos", x)}
          />
          <Campo
            etiqueta="Recipiente (cc)"
            valor={v.peso_vol_volumen_cc}
            onChange={(x) => set("peso_vol_volumen_cc", x)}
          />
        </div>
        <Resultado valor={pv} unidad="g/l" />
      </section>

      <section className="space-y-2 rounded border border-slate-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-slate-700">Cal útil vial</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Campo
            etiqueta="ml de ácido"
            valor={v.cal_util_ml_acido}
            onChange={(x) => set("cal_util_ml_acido", x)}
          />
          <Campo
            etiqueta="Peso de muestra (g)"
            valor={v.cal_util_peso_muestra_g}
            onChange={(x) => set("cal_util_peso_muestra_g", x)}
          />
        </div>
        <Resultado valor={cuv} unidad="%" />
      </section>

      <section className="space-y-2 rounded border border-slate-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-slate-700">Granulometría</h2>
        <div className="sm:w-1/3">
          <Campo
            etiqueta="Peso de muestra (g)"
            valor={v.granulometria_peso_muestra_g}
            onChange={(x) => set("granulometria_peso_muestra_g", x)}
          />
        </div>

        {v.retenidos.length === 0 ? (
          <p className="text-sm italic text-slate-400">
            Este producto no tiene juego habitual de tamices. Agregá las mallas que se tamizaron.
          </p>
        ) : (
          <ul className="space-y-1">
            {v.retenidos.map((r, i) => {
              const calculada = granulo.filas.find((f) => f.malla === aNumero(r.malla));
              return (
                <li key={`${r.malla}-${i}`} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-sm text-slate-600">#{r.malla}</span>
                  <input
                    value={r.retenido_g}
                    onChange={(e) => {
                      const copia = [...v.retenidos];
                      copia[i] = { ...copia[i], retenido_g: e.target.value };
                      set("retenidos", copia);
                    }}
                    placeholder="gramos"
                    inputMode="decimal"
                    className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <span className="flex-1 text-xs text-slate-500">
                    {calculada && (
                      <>
                        <span className={calculada.retenido.fuera ? "font-semibold text-red-700" : ""}>
                          {calculada.retenido.valor?.toLocaleString("es-AR")}%
                        </span>
                        {" · ac. "}
                        <span className={calculada.acumulado.fuera ? "font-semibold text-red-700" : ""}>
                          {calculada.acumulado.valor?.toLocaleString("es-AR")}%
                        </span>
                      </>
                    )}
                  </span>
                  <button
                    onClick={() => set("retenidos", v.retenidos.filter((_, j) => j !== i))}
                    className="text-xs text-slate-400 underline"
                  >
                    Sacar
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {granulo.problema && <p className="text-sm text-amber-700">{granulo.problema}</p>}

        <div className="flex items-center gap-2">
          <input
            value={nuevaMalla}
            onChange={(e) => setNuevaMalla(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && agregarMalla()}
            placeholder="Agregar malla"
            inputMode="numeric"
            className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button onClick={agregarMalla} className="text-sm text-slate-600 underline">
            Agregar
          </button>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={guardar}
          disabled={guardando}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {guardando ? "Guardando…" : textoDelBoton}
        </button>

        {onBorrar && (
          <button
            onClick={() => {
              if (confirm("¿Borrar esta muestra? No se puede deshacer.")) onBorrar();
            }}
            className="text-sm text-red-700 underline"
          >
            Borrar
          </button>
        )}
      </div>
    </div>
  );
}
