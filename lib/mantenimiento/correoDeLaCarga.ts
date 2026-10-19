import { conSuArticulo } from "@/public/cola/colaOffline.js";

/**
 * Si una carga rechazada merece un correo, y cuál de los dos textos.
 *
 * ## Por qué esto existe
 *
 * Una carga hecha sin señal en la planta puede llegar horas después y ser
 * rechazada cuando la persona ya se fue, convencida de que la cargó. La
 * pantalla `/cargar` se lo dice si entra a mirar, y el push si lo tiene
 * prendido —una sola persona de trece, medido el 19/10/2026—. El correo es para
 * que se entere **sin tener que mirar**.
 *
 * ## Las dos condiciones, y por qué son dos
 *
 * **Que la haya mandado el teléfono solo**, con la app cerrada. Si salió de la
 * pantalla, la persona está leyendo el cartel que dice exactamente lo mismo, y
 * un correo que repite lo que alguien está mirando es cómo se aprende a
 * ignorar los correos del sistema. El dato viaja en una cabecera desde
 * `public/sw.js`, que es el único que lo sabe.
 *
 * **Que el rechazo sea definitivo.** Los mismos tres que para la cola —400, 403
 * y 409—, y el criterio sale de `clasificarFallo` de `public/cola/colaOffline.js`:
 * están escritos en dos lugares porque uno corre en el navegador y el otro en
 * el servidor, así que si allá cambian, acá hay que mirarlo.
 *
 * ## Es pura
 *
 * No toca la base, ni `fetch`, ni `process.env`. Decide y arma texto; quien
 * manda es `lib/core/correo.ts` y quien junta los datos son las dos rutas de
 * alta. Eso es lo que la hace probable, y acá está casi todo lo que puede
 * salir mal.
 */

/** Los tres que la cola trata como definitivos, y por lo tanto los que avisan. */
const DEFINITIVOS = [400, 403, 409];

export interface RechazoDeCarga {
  /** Si la mandó el teléfono solo. Sin este dato no se avisa. */
  delFondo: boolean;
  status: number;
  /** Lo que contestó la ruta, **sin traducir**: es lo que la persona necesita leer. */
  error: string;
  /** La fila puede estar en la planilla y no en el sistema: cambia el texto entero. */
  enDuda: boolean;
  tipo: "aviso" | "orden";
  descripcion: string;
  sector: string | null;
  /** El día en que se cargó, en ISO. */
  fecha: string;
}

/** El día como lo escribe este sistema: d/m, nunca m/d. */
function comoSeEscribe(fecha: string): string {
  const [, mes, dia] = fecha.split("-");
  return dia && mes ? `${Number(dia)}/${Number(mes)}` : fecha;
}

/** Qué carga era, lo suficiente para reconocerla entre varias. */
function cualEra(rechazo: RechazoDeCarga): string {
  const sector = rechazo.sector?.trim();
  return `«${rechazo.descripcion}»${sector ? ` — ${sector}` : ""}`;
}

export function correoPorElRechazo(
  rechazo: RechazoDeCarga,
): { asunto: string; cuerpo: string } | null {
  if (rechazo.delFondo !== true) return null;
  if (!DEFINITIVOS.includes(rechazo.status)) return null;

  // Con su artículo y en minúscula, porque acá va adentro de una oración. Es
  // la misma función que nombra la carga en la pantalla y en el service
  // worker: tres nombres distintos para la misma cosa ya fue un hallazgo.
  const laCarga = conSuArticulo(rechazo.tipo);
  const dia = comoSeEscribe(rechazo.fecha);
  const dijo = `El sistema dijo: ${rechazo.error}`;

  // El caso en duda **no puede decir que no se cargó**, porque quizás sí: la
  // clave quedó reservada y no se sabe si la fila llegó a escribirse en la
  // planilla. Es el aviso más caro de perderse —si nadie lo mira, termina en
  // una orden duplicada en la fuente de verdad del módulo— y por eso avisa
  // igual, con su propio texto.
  if (rechazo.enDuda) {
    return {
      asunto: `Revisá la planilla: ${cualEra(rechazo)} puede haber quedado cargado`,
      cuerpo: [
        `${laCarga.charAt(0).toUpperCase()}${laCarga.slice(1)} que cargaste el ${dia} se mandó, y no sabemos si entró.`,
        cualEra(rechazo),
        dijo,
        "Puede haber quedado escrito en la planilla. Miralo ahí antes de cargarlo de nuevo, o quedan dos.",
      ].join("\n\n"),
    };
  }

  // Ningún enlace, a propósito: la carga vive en el IndexedDB de **ese**
  // teléfono. Un enlace abriría la pantalla en el aparato donde se lea el
  // correo, que puede ser la computadora, y ahí no está. Decir dónde está es
  // verdad; linkear a donde no está, no.
  return {
    asunto: `No se pudo cargar ${laCarga} del ${dia}`,
    cuerpo: [
      cualEra(rechazo),
      dijo,
      "Quedó guardado en tu teléfono, en Cargar. Corregilo y mandalo de nuevo.",
    ].join("\n\n"),
  };
}
