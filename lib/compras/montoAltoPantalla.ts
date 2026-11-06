import { esMontoAlto, porQueEsAlto, type MarcaManual } from "./montoAlto";

/**
 * Lo que la ficha de un requerimiento dice sobre su monto alto.
 *
 * Existe aparte de `montoAlto.ts` porque ahí está la **regla** y acá la
 * **frase**: la regla se prueba contra la consulta de PostgREST, y esto sólo
 * tiene que contestar "¿qué leo en la pantalla?" sin dejar ningún caso mudo.
 *
 * El caso que más importa es el de un monto de 29 millones que figura como "no
 * alto" porque alguien lo desmarcó. Sin decirlo, eso parece un error del
 * sistema y la próxima persona lo vuelve a marcar. `porQueEsAlto` ya lo
 * distingue; lo que agrega esto es cubrir los casos donde esa función devuelve
 * `null` —no es alto y no hay nada que explicar— porque en pantalla "no es
 * alto" también necesita un motivo.
 */
export interface LecturaDeMontoAlto {
  alto: boolean;
  /** Lo que se ve en grande: «Monto alto» o «No es monto alto». */
  titulo: string;
  /** Cuál de los dos mandó, en una frase corta. */
  porque: string;
  /** Si lo que manda es la decisión de una persona y no el monto. */
  esManual: boolean;
}

export function lecturaDeMontoAlto(
  montoConocido: number | null,
  manual: MarcaManual,
  umbral: number
): LecturaDeMontoAlto {
  const alto = esMontoAlto(montoConocido, manual, umbral);
  const esManual = manual !== null;

  // `porQueEsAlto` devuelve null cuando no es alto y no hay nada que explicar:
  // acá sí lo hay, así que se completa.
  const porque =
    porQueEsAlto(montoConocido, manual, umbral) ??
    (manual === false
      ? "una persona lo desmarcó"
      : montoConocido === null
        ? "todavía no hay ningún monto"
        : "el monto no llega al umbral");

  return {
    alto,
    titulo: alto ? "Monto alto" : "No es monto alto",
    porque,
    esManual,
  };
}

/** Lo que dice un botón de la ficha, para que el valor y el texto no se separen. */
export const POSICIONES_DE_MONTO_ALTO: readonly {
  valor: MarcaManual;
  texto: string;
}[] = [
  { valor: null, texto: "Automático" },
  { valor: true, texto: "Es alto" },
  { valor: false, texto: "No es alto" },
];
