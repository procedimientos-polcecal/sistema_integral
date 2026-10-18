import type { Notificacion } from "./notificaciones";
import type { Aviso } from "@/lib/core/webpush";

/** Cuántos avisos se nombran en el cuerpo antes de resumir el resto. */
const CUANTOS_SE_NOMBRAN = 3;

/**
 * Un aviso de ritmo no cuenta cosas.
 *
 * Su `cantidad` es cuántos umbrales enteros lleva el módulo sin cargarse, y
 * existe sólo para que descartarlo no lo traiga de vuelta mañana —ver
 * `cantidadDelAviso` en `./ritmo.ts`—. Escribirla al lado del título daría
 * "9 · Trituración: hace 36 días que no se carga", que no significa nada. El
 * título de esos avisos ya es la frase completa, así que va solo.
 */
const esDeRitmo = (n: Notificacion) => n.id.startsWith("ritmo-");

const comoLinea = (n: Notificacion) => (esDeRitmo(n) ? n.titulo : `${n.cantidad} · ${n.titulo}`);

/**
 * Convierte los avisos de una persona en **una** notificación.
 *
 * Una por aviso sería la forma obvia y es la equivocada: con los números de hoy
 * —ocho módulos parados más las colas de trabajo— alguien se come diez pushes a
 * la mañana, los silencia, y a partir de ahí el sistema no avisa más nada. Una
 * sola que diga cuánto hay y lleve a mirarlo es lo que se puede sostener todos
 * los días.
 *
 * Devuelve `null` cuando no hay nada: **no se manda una notificación para decir
 * que no pasa nada.** Esa es la que enseña a ignorarlas.
 *
 * Con un solo aviso el link va directo a su pantalla. Mandar a la persona al
 * inicio para que vuelva a buscar de qué se trataba es el peor resultado
 * posible de haberla interrumpido.
 */
export function resumirParaPush(avisos: Notificacion[]): Aviso | null {
  if (avisos.length === 0) return null;

  if (avisos.length === 1) {
    const unico = avisos[0];
    return {
      title: unico.titulo,
      body: esDeRitmo(unico) ? "" : String(unico.cantidad),
      url: unico.href,
    };
  }

  const nombrados = avisos.slice(0, CUANTOS_SE_NOMBRAN).map(comoLinea);
  const restantes = avisos.length - CUANTOS_SE_NOMBRAN;
  if (restantes > 0) nombrados.push(`y ${restantes} más`);

  return {
    title: `${avisos.length} cosas para mirar`,
    body: nombrados.join("\n"),
    url: "/",
  };
}
