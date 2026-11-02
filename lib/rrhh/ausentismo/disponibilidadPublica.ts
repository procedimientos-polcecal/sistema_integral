import { sumarDias, esFechaIso, semanaDe } from "@/lib/core/fechas";
import { TIPOS_QUE_NO_SON_FALTA, type AusenciaCruda } from "@/lib/mantenimiento/disponibilidad";

/**
 * Lo que de las ausencias puede verlo cualquiera que entre al sistema: quién no
 * viene y qué día. **Nunca por qué.**
 *
 * `ausencias` está cerrada con `tiene_acceso_rrhh()` —hoy la leen 6 de 14
 * usuarios— porque guarda el motivo, y de las 218 novedades que RRHH llevaba en
 * la planilla 74 son enfermedad y 3 son ART: dato médico y disciplinario. La
 * pantalla de Disponibilidad es para todos, así que la ruta lee con el cliente
 * admin y **proyecta** con esta función a lo único que puede ser público.
 *
 * LA PROYECCIÓN SE ARMA CAMPO POR CAMPO, NO BORRANDO LOS PROHIBIDOS. Un
 * `{ ...fila, tipo: undefined }` o un `delete fila.tipo` filtra lo que alguien
 * agregue mañana a la consulta —`observaciones`, `justificada`— sin que nada
 * avise: la lista de lo que sale es positiva y tiene cuatro campos. Está
 * fijado con un test que serializa la respuesta y busca el motivo en el texto.
 *
 * EL `tipo` SÓLO ENTRA PARA EXCLUIR LA TARDANZA, y se descarta acá. Quien llega
 * tarde vino a trabajar, así que no es un hueco: es la misma regla que rige en
 * la programación del taller y por eso se comparte `TIPOS_QUE_NO_SON_FALTA`.
 * **Es lo opuesto de lo que hace el reporte mensual de RRHH**, que sí cuenta la
 * tardanza como un día porque la planilla la tenía como columna. Las dos cosas
 * son correctas y están a propósito: la misma fila cuenta distinto según quién
 * pregunta. No se unifican.
 */

export interface EmpleadoParaDisponibilidad {
  id: string;
  nombre: string;
  apellido: string;
  sector: string | null;
}

export interface AusentePublico {
  empleadoId: string;
  nombre: string;
  sector: string | null;
  dia: string;
}

/**
 * Una entrada por persona y por día en que no viene, ordenadas por día y por
 * nombre. Dos ausencias que se pisan el mismo día dan una sola entrada: el
 * hueco es el mismo.
 *
 * Una ausencia cuyo empleado no está en `empleados` se saltea: no hay a quién
 * nombrar. No puede pasar con la clave foránea, y por eso no se cuenta ni se
 * avisa.
 */
export function ausentesPublicos(
  ausencias: readonly AusenciaCruda[],
  empleados: readonly EmpleadoParaDisponibilidad[],
  dias: readonly string[],
): AusentePublico[] {
  const empleadoPorId = new Map(empleados.map((e) => [e.id, e]));
  const vistos = new Set<string>();
  const salida: AusentePublico[] = [];

  for (const a of ausencias) {
    // El `tipo` se usa acá y no sale de esta función.
    if (TIPOS_QUE_NO_SON_FALTA.includes(a.tipo)) continue;
    const e = empleadoPorId.get(a.empleado_id);
    if (!e) continue;
    for (const dia of dias) {
      if (dia < a.fecha_desde || dia > a.fecha_hasta) continue;
      const clave = `${e.id}|${dia}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      salida.push({
        empleadoId: e.id,
        nombre: `${e.apellido}, ${e.nombre}`,
        sector: e.sector,
        dia,
      });
    }
  }

  return salida.sort(
    (x, y) => x.dia.localeCompare(y.dia) || x.nombre.localeCompare(y.nombre, "es"),
  );
}

/** Lo más largo que se puede pedir de una vez: un trimestre. */
export const MAXIMO_DE_DIAS = 93;

/**
 * Los días que se piden, o por qué no se pueden dar.
 *
 * Sin parámetros, la semana de hoy (lunes a domingo): es lo que mira quien
 * dirige un área. Con uno solo de los dos, es un error y no un valor por
 * defecto: adivinar el otro extremo devolvería un rango que nadie pidió.
 *
 * El tope existe porque la respuesta crece con los días y no hay motivo para
 * que un pedido a mano devuelva años enteros.
 */
export function rangoPedido(
  desde: string | null,
  hasta: string | null,
  hoy: string,
): { dias: string[] } | { error: string } {
  if (desde === null && hasta === null) return { dias: semanaDe(hoy) };
  if (desde === null || hasta === null) {
    return { error: "Hay que pedir las dos fechas, desde y hasta, o ninguna." };
  }
  if (!esFechaIso(desde) || !esFechaIso(hasta)) {
    return { error: "Las fechas tienen que ser AAAA-MM-DD y existir en el calendario." };
  }
  if (hasta < desde) return { error: "La fecha hasta no puede ser anterior a la fecha desde." };

  const dias: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) {
    dias.push(d);
    if (dias.length > MAXIMO_DE_DIAS) {
      return { error: `Se pueden pedir hasta ${MAXIMO_DE_DIAS} días de una vez.` };
    }
  }
  return { dias };
}
