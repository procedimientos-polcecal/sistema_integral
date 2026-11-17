import { z } from "zod";
import { instanteDe } from "./evento";
import type { EventoParaGoogle } from "@/lib/core/calendar";

/**
 * Lo que entra y sale de las rutas de la Agenda, sin red y sin base: el cuerpo
 * de un pedido, las horas en las dos direcciones y el id que se le da a Google.
 *
 * Vive en `lib/` y no adentro de las rutas porque las rutas no tienen tests en
 * este repo y `lib/` sí, y todo lo de acá es una decisión que se puede
 * equivocar sin que nada avise.
 */

/** Argentina no tiene horario de verano: el desfase es fijo. */
const DESFASE_ARGENTINA_MS = 3 * 60 * 60_000;

/**
 * Una fecha-hora que entró en un pedido, como instante UTC en ISO (lo que
 * Postgres guarda sin ambigüedad), o `null` si no es una fecha-hora válida.
 *
 * **Una cadena sin zona es hora de pared de Argentina**, igual que en
 * `divergencia.ts`: es la forma en que la pantalla y `horarioDeLaOT` la
 * escriben. Dejarla sin tocar le entregaría a Postgres un `2026-11-03T08:00:00`
 * que interpreta en la zona de la sesión —UTC en el servidor—, y el evento
 * quedaría tres horas corrido, sin error y sin aviso.
 */
export function aInstanteISO(texto: string): string | null {
  const i = instanteDe(conSegundos(texto));
  if (!i) return null;
  const utc = i.conZona ? i.ms : i.ms + DESFASE_ARGENTINA_MS;
  return new Date(utc).toISOString();
}

/**
 * Le pone `:00` de segundos a una fecha-hora que no los trae. `instanteDe` los
 * exige y un `<input type="datetime-local">` **no los manda**: `2026-11-03T08:00`
 * saldría rechazado con «no es una fecha y hora válida» en la primera prueba de
 * la pantalla. Lo que no es de esa forma pasa sin tocar, para que
 * `problemasDelEvento` diga qué está mal con el texto que escribió la persona.
 */
export function conSegundos(texto: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})?$/.test(texto)
    ? texto.replace(/^(.{16})/, "$1:00")
    : texto;
}

/**
 * Lo inverso, para mandarle a Google: un instante (lo que devuelve la base,
 * `2026-11-03T11:00:00+00:00`) como hora de pared de Argentina y **sin offset**
 * (`2026-11-03T08:00:00`). El cliente de Calendar agrega la zona aparte, y un
 * `dateTime` con offset más un `timeZone` distinto es justo el lío que evita.
 */
export function aHoraDePared(texto: string): string | null {
  const i = instanteDe(conSegundos(texto));
  if (!i) return null;
  const utc = i.conZona ? i.ms : i.ms + DESFASE_ARGENTINA_MS;
  return new Date(utc - DESFASE_ARGENTINA_MS).toISOString().slice(0, 19);
}

/**
 * El id con que se crea el evento en Google: el de la fila, sin guiones y en
 * minúscula. Google pide base32hex y un uuid sin guiones lo cumple.
 *
 * **Sale de la fila a propósito y no se sortea aparte**: así crear se puede
 * reintentar sin guardar nada antes, y si la escritura a Google funcionó pero
 * la anotación en la fila no, el próximo intento da con el mismo evento en vez
 * de crear otro (y mandar la invitación por segunda vez a cada invitado).
 */
export function idDeGoogleDe(filaId: string): string {
  return filaId.replace(/-/g, "").toLowerCase();
}

/**
 * Lo que se le dice a quien quiere modificar o borrar el evento de una OT.
 * `numero` es el de la orden (`ot_number`); null si no se pudo averiguar —la
 * persona puede no tener acceso a Mantenimiento y no leer la OT—, y entonces el
 * mensaje la nombra sin número en vez de inventarlo.
 */
export function mensajeDeEventoDeOT(accion: "modificar" | "borrar" | "aceptar", numero: number | null): string {
  const cual = numero === null ? "una orden de trabajo" : `la orden de trabajo ${numero}`;
  if (accion === "aceptar") {
    return (
      `No se puede aceptar la hora de Google en este evento: lo maneja ${cual}, y para una orden de ` +
      `trabajo la verdad es la orden. Aceptarla cambiaría la fecha del evento en el SdG y la próxima ` +
      `sincronización la volvería a pisar sin avisar. Para volver a poner el evento donde dice la orden, ` +
      `reescribilo.`
    );
  }
  return (
    `No se puede ${accion} este evento desde la Agenda: lo maneja ${cual}. ` +
    `Su horario sale de la fecha de ejecución de la orden y se vuelve a escribir cuando esa fecha cambia, ` +
    `así que un cambio hecho acá se perdería sin avisar. Se cambia desde la orden.`
  );
}

/** Texto libre del cuerpo: acepta vacío o null para «sin valor». */
const textoOpcional = (max: number) => z.string().max(max).nullish();

/**
 * El alta. `titulo`, `inicio`, `fin` e `invitados` **se completan con vacío si
 * no vinieron**, a propósito: así `problemasDelEvento` los ve y dice «Falta el
 * título del evento» junto con todo lo demás en una sola respuesta, en vez de
 * que zod conteste solo por el primero que falte.
 */
export const esquemaDeAlta = z.object({
  titulo: z.string().max(200).default(""),
  descripcion: textoOpcional(5000),
  lugar: textoOpcional(300),
  inicio: z.string().default("").transform(conSegundos),
  fin: z.string().default("").transform(conSegundos),
  invitados: z.array(z.string()).max(50).default([]),
});

/** El cambio: cada campo es opcional y sólo cuenta si vino. */
export const esquemaDeCambio = z.object({
  titulo: z.string().max(200).optional(),
  descripcion: textoOpcional(5000),
  lugar: textoOpcional(300),
  inicio: z.string().transform(conSegundos).optional(),
  fin: z.string().transform(conSegundos).optional(),
  invitados: z.array(z.string()).max(50).optional(),
});

export const esquemaDeDestrabar = z.object({
  como: z.enum(["reescribir", "aceptar"]),
});

/**
 * Los invitados como se guardan y como se mandan: sin espacios, en minúscula,
 * sin repetidos y **sin el dueño**. El dueño ya está en su calendario como
 * organizador; invitarlo a su propio evento sólo le agregaría una línea de
 * «aceptar» a algo que ya es suyo.
 */
export function invitadosLimpios(lista: string[], casillaDelDueno: string): string[] {
  const dueno = casillaDelDueno.trim().toLowerCase();
  const vistos = new Set<string>();
  for (const crudo of lista) {
    const correo = crudo.trim().toLowerCase();
    if (correo !== dueno) vistos.add(correo);
  }
  return [...vistos];
}

/** Lo que de una fila hace falta para armar el evento de Google. */
export interface FilaDeEvento {
  id: string;
  titulo: string;
  descripcion: string | null;
  lugar: string | null;
  inicio: string;
  fin: string;
}

/**
 * El evento de la fila tal como se le manda a Google, completo.
 *
 * Los campos sin valor van como texto vacío y no se omiten: un `PATCH` que
 * omite `description` deja la vieja, y vaciar la descripción en el SdG tiene
 * que vaciarla también allá. Tira si la fila trae una hora ilegible, porque
 * eso no es un fallo de Google sino un dato que la base no debería haber
 * dejado entrar.
 */
export function eventoParaGoogle(fila: FilaDeEvento, invitados: string[], casilla: string): EventoParaGoogle {
  const inicio = aHoraDePared(fila.inicio);
  const fin = aHoraDePared(fila.fin);
  if (!inicio || !fin) {
    throw new Error(`El evento ${fila.id} tiene una hora que no se puede leer: ${fila.inicio} / ${fila.fin}`);
  }
  return {
    id: idDeGoogleDe(fila.id),
    titulo: fila.titulo,
    descripcion: fila.descripcion ?? "",
    lugar: fila.lugar ?? "",
    inicio,
    fin,
    invitados: invitadosLimpios(invitados, casilla),
  };
}

/**
 * ¿Ya dio por vista esta persona **esta** divergencia? Se compara el instante
 * de `divergencia_el` y no el texto: es lo que hace que una divergencia nueva
 * —otra fecha— vuelva a aparecer. Sin divergencia no hay nada que ver.
 */
export function divergenciaVista(
  divergenciaEl: string | null,
  vistas: { divergencia_el: string }[]
): boolean {
  if (!divergenciaEl) return false;
  const actual = instanteDe(divergenciaEl)?.ms;
  if (actual === undefined) return false;
  return vistas.some((v) => instanteDe(v.divergencia_el)?.ms === actual);
}
