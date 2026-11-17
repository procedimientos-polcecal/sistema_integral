import { aQuienLeLlega, type Destinatario } from "@/lib/core/mensajes";

/**
 * Qué se anota de cada mención cuando se la guarda, antes de mandar ningún
 * correo.
 *
 * ## Por qué esto existe aparte de `aQuienLeLlega`
 *
 * `aQuienLeLlega` dice **a quién** se le manda y calla por qué se quedó afuera
 * el resto. Pero cada mención lleva dos columnas, `avisado_en` y `aviso_fallo`,
 * y una mención en `null`/`null` tiene que querer decir **una sola cosa**:
 * «el `after()` todavía no corrió o no llegó a correr». Si también quisiera
 * decir «no correspondía» o «falló», la pantalla no podría distinguir un correo
 * perdido de uno que nunca se iba a mandar, y quien escribió seguiría creyendo
 * que avisó. Entonces a cada mención que **no** se va a intentar se le escribe
 * el motivo, y acá está el motivo.
 *
 * No decide por su cuenta: parte de `aQuienLeLlega`, que es la única fuente de
 * verdad de a quién le llega un aviso, y sólo pone palabras a lo que ésa dejó
 * afuera. Dos funciones que decidieran lo mismo por separado terminarían
 * diciendo cosas distintas.
 */

/** Lo que se anota cuando el correo no está configurado en el servidor. */
export const MOTIVO_SIN_CONFIGURAR =
  "El correo no está configurado en el servidor: no se intentó mandarlo.";

export const MOTIVO_NO_PUEDE_VERLO =
  "No puede ver el registro: no se le mandó el correo porque llevaría el texto del mensaje.";

export const MOTIVO_SIN_CORREO = "No tiene correo cargado: no se le pudo mandar el aviso.";

/**
 * Lo que se anota cuando el servicio de correo falló **y no dijo nada**.
 *
 * Es el último recurso: lo normal es anotar el `detalle` que devuelve
 * `enviarCorreo()`, que es lo que contestó el Apps Script sin traducir. Un texto
 * fijo no distingue un dominio rechazado de un cupo agotado, así que sólo entra
 * cuando no hay otra cosa.
 */
export const MOTIVO_EL_SERVICIO_FALLO =
  "El servicio de correo no lo pudo enviar y no dijo por qué.";

export interface AvisoOmitido {
  usuarioId: string;
  motivo: string;
}

export interface ReparticionDeAvisos {
  /** A quienes sí se les intenta mandar el correo. */
  aEnviar: Destinatario[];
  /** A quienes no, cada uno con el motivo que se guarda en su mención. */
  sinAviso: AvisoOmitido[];
}

/**
 * Parte a los mencionados en quienes reciben el correo y quienes no, con el
 * motivo de cada uno de éstos.
 *
 * **El autor no está en ninguna de las dos listas.** Su mención ni siquiera se
 * guarda: se mencionó a sí mismo y eso ensuciaría su propia bandeja con todo lo
 * que escribe.
 *
 * **Si el correo no está configurado, nadie recibe nada** y todos quedan con el
 * mismo motivo, aunque tengan correo y puedan ver el registro: es la causa que
 * importa, porque es la que quien escribe puede ir a arreglar.
 */
export function repartirAvisos(
  mencionados: Destinatario[],
  autorId: string,
  correoConfigurado: boolean
): ReparticionDeAvisos {
  // Una persona mencionada dos veces es una sola mención: es la clave primaria
  // de la tabla, y si dos entraran la segunda inserción la rechazaría entera.
  const vistos = new Set<string>();
  const candidatos: Destinatario[] = [];
  for (const m of mencionados) {
    if (m.usuarioId === autorId || vistos.has(m.usuarioId)) continue;
    vistos.add(m.usuarioId);
    candidatos.push(m);
  }

  const reciben = new Set(aQuienLeLlega(candidatos, autorId).map((d) => d.usuarioId));

  const aEnviar: Destinatario[] = [];
  const sinAviso: AvisoOmitido[] = [];
  for (const m of candidatos) {
    if (!correoConfigurado) {
      sinAviso.push({ usuarioId: m.usuarioId, motivo: MOTIVO_SIN_CONFIGURAR });
    } else if (reciben.has(m.usuarioId)) {
      aEnviar.push(m);
    } else if (!m.puedeVerElRegistro) {
      sinAviso.push({ usuarioId: m.usuarioId, motivo: MOTIVO_NO_PUEDE_VERLO });
    } else {
      // Lo único que queda por las reglas de `aQuienLeLlega`: sin correo, o con
      // uno en blanco.
      sinAviso.push({ usuarioId: m.usuarioId, motivo: MOTIVO_SIN_CORREO });
    }
  }
  return { aEnviar, sinAviso };
}

/** «Nombre Apellido», o sólo el nombre si no hay apellido. */
export function nombreCompleto(u: { nombre: string; apellido?: string | null }): string {
  return `${u.nombre} ${u.apellido ?? ""}`.trim();
}

/**
 * En qué estado está el aviso de una mención, para la pantalla.
 *
 * `pendiente` es el único estado que quiere decir «no se sabe»: o el correo
 * todavía está saliendo, o el `after()` nunca llegó a correr. Los otros dos
 * dicen algo cierto.
 */
export function estadoDelAviso(m: {
  avisado_en: string | null;
  aviso_fallo: string | null;
}): "enviado" | "fallo" | "pendiente" {
  if (m.avisado_en) return "enviado";
  if (m.aviso_fallo) return "fallo";
  return "pendiente";
}
