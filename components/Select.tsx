"use client";

import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode, type SelectHTMLAttributes,
} from "react";
import {
  CON_BUSCADOR_DESDE,
  coincide,
  opcionesDeLosHijos,
  teclaQueAbre,
  type Opcion,
} from "./desplegables";

/**
 * Lo que recibe el `onChange`.
 *
 * Es la forma del evento nativo recortada a lo único que usan las pantallas:
 * se midió, y 165 de los 170 handlers del repo escriben `e.target.value`. Al
 * tipar la prop así, el evento de verdad del `<select>` la satisface tal cual
 * —`target` es el elemento, que tiene `value`— y la migración de las 75
 * pantallas no tuvo que tocar un solo handler.
 */
export type CambioDeSelect = { target: { value: string } };

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "multiple"> & {
  /**
   * Opcional y de los dos tipos, igual que en el nativo. Las dos cosas
   * aparecieron al migrar y conviene que las aguante el componente y no las
   * pantallas: el alta de un aviso de Mantenimiento no lleva `value` —se maneja
   * solo y arranca en la primera opción— y el turno de un operario y el tramo
   * de un service guardan un número. Adentro se compara como texto, que es lo
   * que hace el navegador.
   */
  value?: string | number;
  onChange: (e: CambioDeSelect) => void;
  children: ReactNode;
};

/** Lo que mide el panel cuando el disparador es angosto: 16rem. */
const ANCHO_MINIMO = 256;

/**
 * Un desplegable de un valor que se puede filtrar escribiendo.
 *
 * Se usa igual que el `<select>` nativo —mismas props, los `<option>` adentro—,
 * así que migrar una pantalla es cambiarle una letra a la etiqueta. Por dentro
 * hay dos:
 *
 * - **Menos de diez opciones: un `<select>` nativo de verdad.** En el teléfono
 *   abre la rueda del sistema operativo, que es mejor que cualquier panel
 *   propio, y el teclado y el `aria` vienen puestos. Una caja de búsqueda para
 *   elegir entre tres turnos sólo estorba.
 * - **Diez o más: el panel propio, con buscador.** Los 273 proveedores no se
 *   recorren con la rueda del mouse.
 *
 * Son dos componentes y no dos `return` del mismo, porque el corte se da vuelta
 * en vivo: las listas largas arrancan vacías y se llenan cuando vuelve el
 * fetch, así que un solo componente cambiaría de cantidad de hooks entre dos
 * renders.
 */
export default function Select({ children, ...props }: Props) {
  const opciones = useMemo(() => opcionesDeLosHijos(children), [children]);

  if (opciones.length < CON_BUSCADOR_DESDE) {
    return <SelectNativo {...props}>{children}</SelectNativo>;
  }
  return <SelectBuscable {...props} opciones={opciones}>{children}</SelectBuscable>;
}

function SelectNativo({ value, onChange, children, ...resto }: Props) {
  return (
    <select value={value} onChange={onChange} {...resto}>
      {children}
    </select>
  );
}

// Del resto de las props se toman sólo las que tienen sentido sobre el
// disparador. Las propias de un `<select>` no se reenvían: acá el control es un
// <button>, y pasarle las de otro elemento es un error de tipos, no un detalle.
function SelectBuscable({
  value, onChange, children, opciones, className, disabled, required,
  id, title, "aria-label": etiquetaAria,
}: Props & { opciones: Opcion[] }) {
  // Sin `value`, el desplegable se maneja solo. `null` es "todavía no se tocó",
  // que no es lo mismo que el vacío: antes de que lo toquen, un `<select>` sin
  // valor muestra su primera opción, y acá hay que hacer lo mismo a mano.
  const [propio, setPropio] = useState<string | null>(null);
  const controlado = value !== undefined;
  const valorActual = controlado ? String(value) : propio ?? opciones[0]?.valor ?? "";

  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [resaltado, setResaltado] = useState(0);
  const [haciaLaIzquierda, setHaciaLaIzquierda] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  const coincidencias = useMemo(
    () => opciones.filter((o) => coincide(o.etiqueta, texto)),
    [opciones, texto],
  );

  const elegida = opciones.find((o) => o.valor === valorActual);

  // Tocar fuera cierra sin elegir, igual que el nativo.
  useEffect(() => {
    if (!abierto) return;
    const alTocar = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) cerrar();
    };
    document.addEventListener("mousedown", alTocar);
    return () => document.removeEventListener("mousedown", alTocar);
  }, [abierto]);

  // El resaltado tiene que seguir viéndose mientras se baja con las flechas:
  // si se va abajo del borde, navegar a ciegas es peor que no navegar.
  useLayoutEffect(() => {
    if (!abierto) return;
    lista.current
      ?.querySelector(`[data-indice="${resaltado}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [abierto, resaltado]);

  function cerrar() {
    setAbierto(false);
    setTexto("");
  }

  /**
   * En un teléfono la fila de filtros tiene dos columnas, y el panel de los de
   * la derecha se salía de la pantalla: quedaba la mitad de cada nombre y no
   * había forma de traerlo. Se mide al abrir y se ancla del otro lado.
   */
  /**
   * `desde` es lo que ya se escribió: la letra con la que alguien empezó a
   * buscar sin haber abierto el panel. Esa letra no se pierde — abrir vacío y
   * pedirle que la repita es exactamente lo que hacía lento al desplegable.
   */
  function abrir(desde = "") {
    if (disabled) return;
    const r = caja.current?.getBoundingClientRect();
    if (r) {
      setHaciaLaIzquierda(r.left + Math.max(ANCHO_MINIMO, r.width) > window.innerWidth - 8);
    }
    setTexto(desde);

    // Se abre parado en lo que ya estaba elegido, no en el principio: si no,
    // bajar una posición desde el valor actual exige volver a buscarlo. Pero si
    // ya se escribió algo, el valor actual probablemente no esté entre lo
    // filtrado, así que ahí manda la primera coincidencia.
    const filtradas = desde ? opciones.filter((o) => coincide(o.etiqueta, desde)) : coincidencias;
    const actual = desde ? -1 : filtradas.findIndex((o) => o.valor === valorActual);
    setResaltado(actual >= 0 ? actual : primeroElegible(filtradas));
    setAbierto(true);
  }

  function elegir(opcion: Opcion) {
    if (opcion.deshabilitada) return;
    if (!controlado) setPropio(opcion.valor);
    onChange({ target: { value: opcion.valor } });
    cerrar();
  }

  /** Mueve el resaltado salteando las deshabilitadas, que no se pueden elegir. */
  function mover(paso: 1 | -1) {
    if (coincidencias.length === 0) return;
    let i = resaltado;
    for (let intentos = 0; intentos < coincidencias.length; intentos++) {
      i = (i + paso + coincidencias.length) % coincidencias.length;
      if (!coincidencias[i].deshabilitada) {
        setResaltado(i);
        return;
      }
    }
  }

  function alTeclear(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); cerrar(); return; }
    if (e.key === "Tab") { cerrar(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); mover(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); mover(-1); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const opcion = coincidencias[resaltado];
      if (opcion) elegir(opcion);
    }
  }

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        id={id}
        title={title}
        aria-label={etiquetaAria}
        onClick={() => (abierto ? cerrar() : abrir())}
        onKeyDown={(e) => {
          if (abierto) return;
          // Escribir sobre el desplegable cerrado abre el panel y arranca la
          // búsqueda con esa letra, como salta un `<select>` nativo. El
          // `preventDefault` es para que la barra no scrollee la página.
          const desde = teclaQueAbre(e);
          if (desde === null) return;
          e.preventDefault();
          abrir(desde);
        }}
        // `inline-flex` y no `flex`: un `<select>` se dimensiona al contenido, y
        // varias pantallas lo tienen adentro de un div sin ancho —los filtros
        // del tablero de RRHH, sin ir más lejos—. Con un flex de bloque esos se
        // estiraban a todo lo ancho de la fila. Donde la clase trae `width`
        // —`.input`, que son 42 de los casos— manda esa y no cambia nada.
        className={`inline-flex max-w-full items-center gap-2 text-left ${className ?? ""} ${
          disabled ? "cursor-not-allowed opacity-60" : ""
        }`}
      >
        <span className={`min-w-0 flex-1 truncate ${elegida ? "" : "text-[var(--text-muted)]"}`}>
          {elegida?.etiqueta || "Seleccionar…"}
        </span>
        <svg
          aria-hidden
          width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          className="shrink-0 text-slate-400"
          style={{ transform: abierto ? "rotate(180deg)" : "none" }}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/*
        El `required` del formulario tiene que seguir frenando el submit vacío.
        Un panel propio no participa de la validación del navegador, así que sin
        esto los formularios con desplegable obligatorio pasarían a aceptar el
        vacío y nada avisaría. Es el único motivo por el que este elemento
        existe: lleva el mismo valor y las mismas opciones, y nunca se ve.

        No puede ir con `display:none` ni `visibility:hidden` —el navegador
        excluye de la validación los campos ocultos así—, de ahí el pixel
        transparente. Va al pie del disparador para que el globito salga pegado
        al control y no en una esquina de la pantalla.
      */}
      {required && (
        <select
          required
          tabIndex={-1}
          aria-hidden
          value={valorActual}
          onChange={() => {}}
          className="pointer-events-none absolute bottom-0 left-3 h-px w-px opacity-0"
        >
          {children}
        </select>
      )}

      {abierto && (
        <div
          onKeyDown={alTeclear}
          className={`absolute z-30 mt-1 w-full min-w-[16rem] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-lg ${
            haciaLaIzquierda ? "right-0" : "left-0"
          }`}
        >
          <div className="border-b border-slate-100 p-2">
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="Buscar…"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                // Al cambiar lo escrito, el resaltado vuelve arriba: dejarlo
                // donde estaba lo pone sobre una opción que ya no es la misma.
                setResaltado(0);
              }}
            />
          </div>

          <div ref={lista} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {coincidencias.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">Nada con ese nombre.</p>
            ) : (
              coincidencias.map((opcion, i) => (
                <button
                  key={opcion.valor}
                  type="button"
                  role="option"
                  data-indice={i}
                  aria-selected={opcion.valor === valorActual}
                  disabled={opcion.deshabilitada}
                  // Con el mouse, el resaltado sigue al puntero: si no, la
                  // flecha y el mouse discuten sobre cuál está apuntada.
                  onMouseEnter={() => !opcion.deshabilitada && setResaltado(i)}
                  onClick={() => elegir(opcion)}
                  // El resaltado va con el verde claro del sistema y no con un
                  // gris: es lo que dice qué elige Enter mientras se baja con
                  // las flechas, y un `slate-100` sobre blanco casi no se ve.
                  className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
                    opcion.deshabilitada
                      ? "cursor-not-allowed text-slate-300"
                      : i === resaltado
                        ? "bg-[var(--primary-light)] text-slate-900"
                        : "text-slate-700"
                  } ${opcion.valor === valorActual ? "font-medium" : ""}`}
                >
                  {opcion.etiqueta}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** La primera que se puede elegir. Si están todas deshabilitadas, la primera. */
function primeroElegible(opciones: Opcion[]): number {
  const i = opciones.findIndex((o) => !o.deshabilitada);
  return i >= 0 ? i : 0;
}
