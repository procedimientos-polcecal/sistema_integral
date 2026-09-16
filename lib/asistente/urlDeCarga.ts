/**
 * La URL que abre un formulario del sistema con los campos ya puestos.
 *
 * **Es la única forma en que el asistente participa de una carga.** No escribe
 * en la base: arma la intención, y la pantalla de siempre hace lo de siempre —
 * con su validación, su exportación a planilla y su manejo de
 * `sheets_pendiente`. Un segundo camino de escritura es un camino que se puede
 * olvidar de exportar, y eso es una divergencia que no avisa.
 *
 * Todos los tipos son **altas en estado pendiente**. Ninguno cambia el estado
 * de algo que ya existe: un estado dispara la planilla y, en Facturación, un
 * asiento en Odoo que no se deshace.
 *
 * Se apoya en una convención que el repo ya tiene —la URL es el estado de la
 * pantalla, `lib/core/usarLaUrl.ts`— y en que tres de los cuatro formularios ya
 * saben abrirse con datos puestos.
 */

import { URGENCIAS } from "@/lib/mantenimiento/avisos";

export type TipoDeCarga = "requerimiento" | "movimiento" | "aviso" | "parte";

export type Armada =
  | { ok: true; url: string }
  | { ok: false; motivo: string };

/**
 * Qué campos acepta cada alta.
 *
 * La lista es cerrada de los dos lados: un campo que no está se rechaza, y no
 * se ignora en silencio. Si el modelo cree que mandó el área y la función la
 * descartó sin decir nada, va a contestar que el RI queda armado con el área
 * puesta, y no.
 */
const CAMPOS: Record<TipoDeCarga, readonly string[]> = {
  requerimiento: ["descripcion", "codigo", "cantidad", "detalle"],
  movimiento: ["articulo", "cantidad"],
  aviso: ["equipo", "descripcion", "urgencia"],
  parte: ["fecha", "turno"],
};

/**
 * Campos que existen en el formulario y que el asistente **no** puede tocar,
 * con el motivo. Se distinguen de los desconocidos porque el mensaje tiene que
 * ser distinto: uno es un error del modelo, el otro es una regla del sistema.
 */
const PROHIBIDOS: Partial<Record<TipoDeCarga, Record<string, string>>> = {
  requerimiento: {
    area:
      "El área del requerimiento la elige quien pide: precargarla es cómo un pedido " +
      "de Mantenimiento entra como si fuera de Producción.",
    paga: "Quién paga lo decide quien pide, igual que el área.",
  },
};

const TURNOS = ["4_12", "12_20"] as const;

/**
 * Una fecha en AAAA-MM-DD que además existe en el calendario.
 *
 * El regex solo no alcanza: `2026-13-45` tiene la forma correcta y no es una
 * fecha. La pantalla del parte valida con el mismo regex, así que un valor así
 * llega hasta un `.eq("fecha", …)` contra una columna `date` y revienta en
 * Postgres — un error de base por algo que se podía rechazar acá con un mensaje
 * que el modelo entiende.
 *
 * Se compara contra lo que `Date` reconstruye porque el constructor normaliza
 * en silencio: el 31 de febrero se vuelve 2 o 3 de marzo, y sin esta vuelta
 * pasaría como buena.
 */
function esFechaDeCalendario(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

export function urlDeCarga(tipo: TipoDeCarga, campos: Record<string, string>): Armada {
  const permitidos = CAMPOS[tipo];
  if (!permitidos) {
    return { ok: false, motivo: `No sé armar una carga de tipo "${tipo}".` };
  }

  const prohibidos = PROHIBIDOS[tipo] ?? {};
  for (const clave of Object.keys(campos)) {
    if (prohibidos[clave]) return { ok: false, motivo: prohibidos[clave] };
    if (!permitidos.includes(clave)) {
      return {
        ok: false,
        motivo: `El formulario de ${tipo} no tiene un campo "${clave}". Los que tiene: ${permitidos.join(", ")}.`,
      };
    }
  }

  if (tipo === "parte") {
    const { fecha, turno } = campos;
    if (!esFechaDeCalendario(fecha ?? "")) {
      return { ok: false, motivo: "La fecha del parte va en AAAA-MM-DD y tiene que existir." };
    }
    if (!TURNOS.includes(turno as (typeof TURNOS)[number])) {
      return { ok: false, motivo: `El turno es ${TURNOS.join(" o ")}.` };
    }
    return { ok: true, url: `/produccion/parte/${fecha}/${turno}` };
  }

  /**
   * La urgencia tiene que ser una de las tres exactas, emoji incluido.
   *
   * No es una manía: el modal la usa como `value` de un `<select>`, así que una
   * urgencia inventada no da error — deja el desplegable en un valor que no
   * existe, y quien carga el aviso no se entera. Y como no es un enum de la
   * base, el catálogo no se la muestra al modelo: sin este chequeo escribiría
   * "Alta" pelado y nadie lo notaría hasta ver un aviso sin urgencia.
   *
   * El mensaje lista los valores exactos a propósito: es lo que el modelo usa
   * para corregir en el intento siguiente.
   */
  if (tipo === "aviso" && campos.urgencia !== undefined && campos.urgencia !== "") {
    if (!URGENCIAS.includes(campos.urgencia as never)) {
      return {
        ok: false,
        motivo: `La urgencia tiene que ser exactamente una de: ${URGENCIAS.join(", ")}.`,
      };
    }
  }

  const query = new URLSearchParams();
  if (tipo === "requerimiento" || tipo === "aviso") query.set("nuevo", "1");
  // El orden de `permitidos` y no el de `campos`: así la URL es estable y los
  // tests no dependen de en qué orden el modelo armó el objeto.
  for (const clave of permitidos) {
    const valor = campos[clave];
    if (valor !== undefined && valor !== "") query.set(clave, valor);
  }

  const base =
    tipo === "requerimiento"
      ? "/compras/requerimientos"
      : tipo === "aviso"
      ? "/mantenimiento/avisos"
      : "/inventario/movimientos/nuevo";

  const cola = query.toString();
  return { ok: true, url: cola ? `${base}?${cola}` : base };
}
