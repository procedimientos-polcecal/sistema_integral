"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { borradorDesdeElCuerpo } from "@/lib/mantenimiento/borradorDeCarga";
import { problemaDeLaFoto } from "@/lib/seguridadHigiene/fotoDeCondicion";
import type { Catalogos } from "./catalogos";
import { CartelDelResultado, loQueDijo, type Resultado } from "./envio";

/**
 * Cargar una condición insegura desde la pantalla que anda sin señal.
 *
 * Es el tercer formulario de `/cargar` y tiene **el mismo contrato** que
 * `FormularioAvisoOffline`: props `catalogos`, `deshabilitado`, `borrador` y
 * `onMandar`. Los desplegables salen de lo que quedó guardado en el teléfono, y
 * si la carga va a la ruta o a la cola lo decide `CargarClient`, que es el único
 * que sabe si hay señal.
 *
 * **QUÉ ES OBLIGATORIO, Y TIENE QUE DECIR LO MISMO QUE LA RUTA.** La ruta de alta
 * (`esquemaDeCondicion`) exige el lugar, qué se vio, la acción propuesta y la
 * prioridad; el peligro es opcional. Este formulario los pide por las mismas
 * razones: una condición que sale de la cola con un campo menos rebota con un 400
 * días después, cuando ya no se puede completar —y para la cola un 400 es
 * definitivo—. Se avisa acá, con la persona delante.
 *
 * **EL LUGAR ES UNO SOLO: UN SECTOR O UN EQUIPO.** La ruta rechaza los dos
 * juntos con un 400, así que elegir uno borra el otro. A diferencia del aviso, un
 * equipo **no** completa su sector: la condición se carga en lo que se eligió y
 * nada más, y la gestión ya sabe a qué sector pertenece un equipo.
 *
 * **LA FOTO VIAJA ADENTRO DEL CUERPO, COMO UN `Blob`.** No se sube aparte: va
 * en el campo `foto` del objeto que se le pasa a `onMandar`, y de ahí sigue
 * entera por los dos caminos —derecho a la ruta con señal, o a IndexedDB si no
 * hay, que guarda un `Blob` por clonado estructurado—. Quién la saca del cuerpo
 * y la mete en el `FormData` es `cuerpoComoFormData`, en
 * `public/cola/colaOffline.js`, que es el único lugar donde eso está escrito.
 *
 * **Y SE COMPRUEBA ACÁ, CON LA PERSONA DELANTE.** `problemaDeLaFoto` es la
 * misma función que corre la ruta, así que lo que ella rechazaría se rechaza
 * ahora: para la cola sin señal un 400 es definitivo, y una foto de 14 MB que
 * rebota tres días después es una carga parada por algo que se arreglaba
 * sacándola de nuevo ahí mismo.
 *
 * **Al corregir una carga parada, la foto que traía se conserva.** Es el único
 * campo que no se puede volver a conseguir —se saca parado frente al problema—,
 * así que no puede perderse por arreglar una coma en la descripción.
 */

/** Con qué arranca el formulario, y a qué vuelve después de cargar. */
const VACIO = {
  sector_id: "",
  equipo_id: "",
  descripcion: "",
  peligro_id: "",
  accion_propuesta: "",
  prioridad: "",
};

/** Las tres prioridades que acepta la ruta. */
const PRIORIDADES = ["1", "2", "3"] as const;

const CLASE_DEL_CAMPO = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export default function FormularioCondicionOffline({
  catalogos,
  deshabilitado,
  borrador,
  onMandar,
}: {
  catalogos: Pick<Catalogos, "equipos" | "sectores" | "peligros">;
  /** Sin dónde guardar o sin saber de quién sería la carga, no se acepta nada. */
  deshabilitado: boolean;
  /**
   * El cuerpo de una carga parada que se está editando. `CargarClient` remonta
   * este componente con `key` cuando cambia, así que esto se lee una sola vez.
   */
  borrador?: Record<string, unknown> | null;
  onMandar: (cuerpo: Record<string, unknown>) => Promise<Resultado>;
}) {
  const { equipos, sectores, peligros } = catalogos;

  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [campos, setCampos] = useState(() => borradorDesdeElCuerpo(VACIO, borrador));
  // La foto va aparte de `campos` porque no es texto: `borradorDesdeElCuerpo`
  // descarta a propósito todo lo que sea un objeto —un `String(blob)` adentro
  // de un campo sería «[object Blob]»—, así que la de una carga parada se lee
  // de acá. El `input type="file"` se queda vacío al remontar y eso está bien:
  // lo que se ve abajo es cuál es la foto que va a viajar.
  const [foto, setFoto] = useState<Blob | null>(() =>
    borrador?.foto instanceof Blob ? borrador.foto : null,
  );
  // Si es la que venía con la carga parada y no una recién elegida: cambia lo
  // que dice el cartel, y eso es lo único que distingue «traje una foto» de
  // «sigue estando la que sacaste el viernes».
  const [esHeredada, setEsHeredada] = useState(() => borrador?.foto instanceof Blob);
  // Sube cada vez que la foto se suelta, y es la `key` del campo de archivo: un
  // `<input type="file">` no se vacía desde el valor, así que la única forma de
  // que deje de mostrar el nombre de la que ya no va es volver a montarlo.
  const [generacionDeLaFoto, setGeneracionDeLaFoto] = useState(0);

  const set = (clave: keyof typeof VACIO, valor: string) =>
    setCampos((c) => ({ ...c, [clave]: valor }));

  /**
   * La foto elegida, comprobada acá mismo. Un archivo que la ruta rechazaría
   * no entra a la cola: ahí el rechazo llega días después y es definitivo.
   */
  function elegirFoto(archivo: File | null) {
    setEsHeredada(false);
    if (!archivo) {
      setFoto(null);
      setGeneracionDeLaFoto((n) => n + 1);
      return;
    }
    const problema = problemaDeLaFoto(archivo);
    if (problema) {
      setError(problema);
      setFoto(null);
      setGeneracionDeLaFoto((n) => n + 1);
      return;
    }
    setError("");
    setFoto(archivo);
  }

  /** Elegir uno de los dos lugares borra el otro: la ruta sólo acepta uno. */
  const elegirSector = (id: string) => setCampos((c) => ({ ...c, sector_id: id, equipo_id: "" }));
  const elegirEquipo = (id: string) => setCampos((c) => ({ ...c, equipo_id: id, sector_id: "" }));

  /** Lo que falta, con las palabras de la ruta, o null si está completo. */
  function loQueFalta(): string | null {
    if (!campos.sector_id && !campos.equipo_id) return "Falta decir en qué sector o equipo es.";
    if (!campos.descripcion.trim()) return "Contá qué viste.";
    if (!campos.accion_propuesta.trim()) return "Falta la acción propuesta.";
    if (!campos.prioridad) return "Falta elegir la prioridad.";
    return null;
  }

  async function cargar() {
    const falta = loQueFalta();
    if (falta) {
      setError(falta);
      return;
    }
    setMandando(true);
    setError("");
    setResultado(null);

    try {
      const salida = await onMandar({
        // Uno solo de los dos: mandar los dos es un 400.
        ...(campos.equipo_id ? { equipo_id: campos.equipo_id } : { sector_id: campos.sector_id }),
        descripcion: campos.descripcion.trim(),
        peligro_id: campos.peligro_id || null,
        accion_propuesta: campos.accion_propuesta.trim(),
        prioridad: Number(campos.prioridad),
        // El día en que se vio, no el día en que entra: sin esto, una condición
        // cargada el viernes sin señal diría lunes. Al corregir una parada se
        // conserva la fecha con que se la cargó.
        detectada_el:
          typeof borrador?.detectada_el === "string" ? borrador.detectada_el : hoyEnArgentina(),
        // Va como `Blob` y no como nada parecido a texto: adentro de un JSON se
        // serializaría como `{}`, sin error y sin aviso. La saca del cuerpo
        // `cuerpoComoFormData`, que es el único lugar donde eso está escrito.
        foto,
      });
      setResultado(salida);
      // El formulario se vacía salvo cuando la carga se rechazó: ahí lo escrito
      // es lo único que hay, y borrarlo obligaría a tipear todo de nuevo. La
      // foto se va con lo demás: dejarla puesta la mandaría pegada a la
      // condición siguiente, que es de otra cosa.
      if (salida.estado !== "rechazada") {
        setCampos(VACIO);
        setFoto(null);
        setEsHeredada(false);
        setGeneracionDeLaFoto((n) => n + 1);
      }
    } catch (e) {
      // Nada de acá debería tirar, pero si tira —`crypto.randomUUID` en un
      // contexto inseguro, por ejemplo— la carga no puede quedarse en la
      // consola: la persona tiene que saber que no se cargó.
      setError(`No se pudo cargar la condición: ${loQueDijo(e)}`);
    } finally {
      setMandando(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">
        El número se lo pone el sistema. Seguridad e Higiene evalúa el riesgo después.
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <CartelDelResultado tipo="condicion" resultado={resultado} />

      {/* La foto va primera porque así se trabaja: lo primero que se hace
          parado frente al problema es sacarla. Es opcional —una condición sin
          foto entra igual— pero es el único campo que después no se recupera:
          cuando el cardán se protege, ya no hay nada que fotografiar. */}
      <div className="space-y-1">
        <span className="block text-xs font-medium text-slate-600">Foto</span>
        <input
          // La `key` es lo que vacía el nombre que muestra el navegador cuando
          // la foto se suelta —al cargar, o porque el archivo no servía—. Un
          // `<input type="file">` no se puede vaciar desde el valor.
          key={generacionDeLaFoto}
          type="file"
          accept="image/*"
          disabled={deshabilitado}
          onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)}
          className={CLASE_DEL_CAMPO}
        />
        {foto ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span>
              {esHeredada
                ? "Va la foto que ya traía esta carga."
                : `Va la foto elegida (${Math.max(1, Math.round(foto.size / 1024))} KB).`}
            </span>
            <button
              type="button"
              onClick={() => elegirFoto(null)}
              className="rounded-lg border border-slate-300 px-2 py-1 font-medium text-slate-700"
            >
              Sacarla
            </button>
          </div>
        ) : (
          <span className="block text-xs text-slate-500">
            Es opcional, pero es lo único que después no se puede volver a sacar.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Sector</span>
          <Select
            value={campos.sector_id}
            onChange={(e) => elegirSector(e.target.value)}
            disabled={deshabilitado}
            className={CLASE_DEL_CAMPO}
          >
            <option value="">Sin sector</option>
            {sectores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo ? `${s.codigo} — ` : ""}
                {s.nombre}
              </option>
            ))}
          </Select>
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Equipo</span>
          <Select
            value={campos.equipo_id}
            onChange={(e) => elegirEquipo(e.target.value)}
            disabled={deshabilitado}
            className={CLASE_DEL_CAMPO}
          >
            <option value="">Sin equipo</option>
            {equipos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code ? `${e.code} — ` : ""}
                {e.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <p className="-mt-1 text-xs text-slate-500">
        Elegí uno de los dos: si es en una máquina, el equipo; si no, el sector.
      </p>

      <label className="block space-y-1">
        <span className="block text-xs font-medium text-slate-600">Qué viste</span>
        <textarea
          value={campos.descripcion}
          onChange={(e) => set("descripcion", e.target.value)}
          rows={3}
          disabled={deshabilitado}
          placeholder="Falta la protección de la correa del molino"
          className={CLASE_DEL_CAMPO}
        />
      </label>

      <label className="block space-y-1">
        <span className="block text-xs font-medium text-slate-600">Peligro</span>
        <Select
          value={campos.peligro_id}
          onChange={(e) => set("peligro_id", e.target.value)}
          disabled={deshabilitado}
          className={CLASE_DEL_CAMPO}
        >
          <option value="">No sé / sin elegir</option>
          {peligros.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </Select>
        <span className="block text-xs text-slate-500">
          Es opcional: si dudás, lo completa Seguridad e Higiene.
        </span>
      </label>

      <label className="block space-y-1">
        <span className="block text-xs font-medium text-slate-600">Acción propuesta</span>
        <textarea
          value={campos.accion_propuesta}
          onChange={(e) => set("accion_propuesta", e.target.value)}
          rows={2}
          disabled={deshabilitado}
          placeholder="Colocar la protección y señalizar"
          className={CLASE_DEL_CAMPO}
        />
      </label>

      <label className="block space-y-1">
        <span className="block text-xs font-medium text-slate-600">Prioridad</span>
        <Select
          value={campos.prioridad}
          onChange={(e) => set("prioridad", e.target.value)}
          disabled={deshabilitado}
          className={CLASE_DEL_CAMPO}
        >
          <option value="">Elegir</option>
          {PRIORIDADES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      </label>

      <button
        onClick={cargar}
        disabled={deshabilitado || mandando}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {mandando ? "Cargando…" : "Cargar la condición"}
      </button>
    </div>
  );
}
