import { estadoDelAviso, nombreCompleto } from "./avisos";

/**
 * La forma en que un mensaje sale hacia la pantalla.
 *
 * Es lo que dice el GET del hilo y también la respuesta del POST, así que vive
 * acá y no en una de las dos rutas: si la armara cada una, el mensaje que
 * acaba de escribir uno se vería distinto del mismo mensaje al recargar.
 *
 * ## Qué sale y qué no
 *
 * La ruta lee con el cliente admin, donde RLS no corre: lo que sale lo decide
 * esta función, campo por campo. Dos decisiones:
 *
 * **`aviso_fallo` sólo se le muestra a quien escribió el mensaje, y eso es una
 * cortesía de la pantalla, no una frontera.** Guarda lo que dijo el servicio de
 * correo y puede traer direcciones. Esta función se lo tapa a los demás —les
 * llega el estado (`enviado`, `fallo`, `pendiente`) sin el texto—, pero
 * `mensajes_menciones_leer` deja leer la fila entera a cualquiera que pueda ver
 * el mensaje, y PostgREST entrega la columna a quien le hable con su propio
 * token. Cerrarlo de verdad pide cambiar los `grant` de columna, y no se hizo
 * porque el dato es el correo de un compañero —los catorce usuarios son del
 * mismo dominio y trabajan juntos— y eso lo decide el usuario. **No apoyarse en
 * esto como si protegiera el dato.**
 *
 * **De la lectura ajena sólo sale un sí o un no.** Alcanza para que la pantalla
 * diga «no lo leyó todavía»; la hora en que cada uno abrió el hilo es
 * seguimiento de personas y nadie lo pidió.
 */

type Persona = { nombre: string; apellido?: string | null } | null;

export interface FilaDeMensaje {
  id: string;
  texto: string;
  creado_en: string;
  creado_por: string | null;
  autor: Persona;
  menciones:
    | {
        usuario_id: string;
        leido_en: string | null;
        avisado_en: string | null;
        aviso_fallo: string | null;
        usuario: Persona;
      }[]
    | null;
}

export interface MensajeParaLaPantalla {
  id: string;
  texto: string;
  creado_en: string;
  creado_por: string | null;
  /** Null si el autor ya no está en la tabla de usuarios. */
  autor: string | null;
  menciones: {
    usuario_id: string;
    nombre: string | null;
    leido: boolean;
    aviso: "enviado" | "fallo" | "pendiente";
    /** Sólo para quien escribió el mensaje; para el resto, null. */
    aviso_fallo: string | null;
  }[];
}

export function darFormaAlMensaje(
  fila: FilaDeMensaje,
  quienPregunta: string
): MensajeParaLaPantalla {
  const esElAutor = fila.creado_por === quienPregunta;
  return {
    id: fila.id,
    texto: fila.texto,
    creado_en: fila.creado_en,
    creado_por: fila.creado_por,
    autor: fila.autor ? nombreCompleto(fila.autor) : null,
    menciones: (fila.menciones ?? []).map((m) => ({
      usuario_id: m.usuario_id,
      nombre: m.usuario ? nombreCompleto(m.usuario) : null,
      leido: m.leido_en !== null,
      aviso: estadoDelAviso(m),
      aviso_fallo: esElAutor ? m.aviso_fallo : null,
    })),
  };
}
