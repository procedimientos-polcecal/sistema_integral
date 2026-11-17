/**
 * Las cantidades del parte de un turno de trituración, leídas como las tipeó
 * la persona.
 *
 * POR QUÉ EXISTE
 *
 * El 05/11/2026, arreglando en Calidad/Ensayos un bug de la coma decimal, se
 * encontró el mismo acá y en su peor forma: la que no frena.
 *
 *   - El formulario mandaba `Number(form.horasMantenimiento)`, que con "1,5"
 *     da `NaN`; `JSON.stringify(NaN)` es `null`, así que la ruta recibía null.
 *   - La ruta hacía `Number(horas_mantenimiento) || 0`, que convierte ese null
 *     —y también un "dos"— en **cero, sin un error**. Una parada de hora y
 *     media se guardaba como que no hubo parada, y esa planta salía con el
 *     100 % de disponibilidad.
 *   - La vista previa de la pantalla usaba `Number(x) || 0`: el mismo cero,
 *     mostrado como si fuera el número cargado.
 *   - Y `toneladas_procesadas` tenía además la otra mitad: `Number("1.440")`
 *     da 1,44, que entra sin avisar como mil cuatrocientas veces menos.
 *
 * La causa de fondo no era ninguno de esos `Number()` sino que hubiera tres
 * funciones leyendo la misma cadena. Acá hay una sola y la usan las dos
 * puntas, igual que `interpretarCantidadOpcional` en Producción —que es el
 * mismo artefacto, el parte de un turno, y ya había pasado por esto—.
 *
 * LA REGLA DE MILES VA
 *
 * Medido el 05/11/2026 sobre los 263 partes cargados: `toneladas_procesadas`
 * tiene 11 valores de más de mil y el máximo es 1440, así que "1.440" es mil
 * cuatrocientos cuarenta y no 1,44. Por eso se lee con `numeroDelFormulario`
 * —que arrastra la regla de `numeroArgentino`— y no con la `numeroTipeado` de
 * Calidad/Ensayos, donde la balanza no puede pasar los mil y el punto es
 * siempre decimal. Las horas no llegan a 8 en ninguno de los 263, así que para
 * ellas las dos lecturas dan lo mismo y se usa la misma por no tener dos.
 */

import { numeroDelFormulario } from "@/lib/core/numeroArgentino";

export type Leido<T> = { ok: true; valor: T } | { ok: false; error: string };

/**
 * Las horas de una parada. **Vacío es cero** —no hubo parada— y eso sí es una
 * afirmación; lo que no se puede leer es un error y nunca un cero.
 */
export function horasDeParada(v: unknown, queEs: string): Leido<number> {
  if (v === null || v === undefined || String(v).trim() === "") return { ok: true, valor: 0 };
  const n = numeroDelFormulario(v);
  if (n === null) return { ok: false, error: `No se entiende ${queEs}: "${String(v).trim()}".` };
  if (n < 0) return { ok: false, error: `${mayuscula(queEs)} no pueden ser negativas.` };
  return { ok: true, valor: n };
}

/**
 * Una cantidad que puede no haberse contado: toneladas y camiones. **Vacío es
 * `null`, no cero**: un turno sin pesaje no es un turno de cero toneladas, y
 * confundirlos hunde el promedio del mes.
 */
export function cantidadOpcional(v: unknown, queEs: string): Leido<number | null> {
  if (v === null || v === undefined || String(v).trim() === "") return { ok: true, valor: null };
  const n = numeroDelFormulario(v);
  if (n === null) return { ok: false, error: `No se entiende ${queEs}: "${String(v).trim()}".` };
  if (n < 0) return { ok: false, error: `${mayuscula(queEs)} no pueden ser negativas.` };
  return { ok: true, valor: n };
}

export interface CantidadesDelParte {
  horas_mantenimiento: number;
  horas_falta_piedra: number;
  horas_produccion: number;
  horas_otro: number;
  camiones_llegados: number | null;
  toneladas_procesadas: number | null;
}

/**
 * El parte entero. Informa **todos** los problemas juntos y en castellano, que
 * es la vara del resto del sistema (`lib/core/validar.ts`): corregir de a uno
 * es lo que en Calidad/Ensayos hacía aparecer una malla distinta cada vez.
 */
export function leerCantidadesDelParte(
  cuerpo: Record<string, unknown>
): { ok: true; valor: CantidadesDelParte } | { ok: false; errores: string[] } {
  const errores: string[] = [];

  const horas = (campo: string, queEs: string): number => {
    const r = horasDeParada(cuerpo[campo], queEs);
    if (!r.ok) { errores.push(r.error); return 0; }
    return r.valor;
  };
  const opcional = (campo: string, queEs: string): number | null => {
    const r = cantidadOpcional(cuerpo[campo], queEs);
    if (!r.ok) { errores.push(r.error); return null; }
    return r.valor;
  };

  const valor: CantidadesDelParte = {
    horas_mantenimiento: horas("horas_mantenimiento", "las horas de mantenimiento"),
    horas_falta_piedra: horas("horas_falta_piedra", "las horas por falta de piedra"),
    horas_produccion: horas("horas_produccion", "las horas de producción"),
    horas_otro: horas("horas_otro", "las horas por otro motivo"),
    camiones_llegados: opcional("camiones_llegados", "los camiones llegados"),
    toneladas_procesadas: opcional("toneladas_procesadas", "las toneladas procesadas"),
  };

  return errores.length > 0 ? { ok: false, errores } : { ok: true, valor };
}

function mayuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
