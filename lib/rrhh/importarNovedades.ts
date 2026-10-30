import { norm } from "@/lib/core/texto";
import type { Ausencia } from "./ausentismo/diasDeAusencia";
import { TIPOS_AUSENCIA } from "./tiposAusencia";

/**
 * La importación de una sola vez de la pestaña NOVEDADES.
 *
 * NOVEDADES es la tabla `ausencias` llevada a mano en una planilla de Google, y
 * las dos listas divergieron en las dos direcciones. La decisión (spec del
 * 29/10/2026) es que el SdG pasa a ser el único lugar donde se carga una
 * ausencia, y lo que sólo está en la planilla entra una vez. Este archivo es la
 * parte que decide qué hacer con cada fila; `scripts/importar-novedades.mts` es
 * sólo la lectura y la escritura.
 *
 * DOS REGLAS MANDAN ACÁ, y las dos son del proyecto:
 *
 * 1. **Enlazar al que se le parece es peor que dejar en null.** Una novedad cuyo
 *    nombre no coincide con exactitud con un único empleado no se le adjudica a
 *    «el más parecido»: va a `sinReconocer` y la resuelve una persona. Un enlace
 *    equivocado no se nota nunca —la ausencia aparece en la persona que no es,
 *    en su recibo y en los dos reportes—, mientras que una fila sin reconocer
 *    se ve en la lista el mismo día.
 *
 * 2. **La importación inserta SIN recalcular.** No llama a
 *    `recalcularEmpleadoPeriodo()`. Importar enero a junio reescribiría medio
 *    año de `calculos_diarios`, que hoy está 77% marcado como ausente sin
 *    motivo: no hay fichadas antes de julio y el motor asume que, sin fichada,
 *    no se vino. Eso es una reescritura masiva de la tabla diaria de RRHH que
 *    nadie pidió. Es seguro porque **los tres reportes de ausentismo leen
 *    `ausencias` y no `calculos_diarios`**. Quien toque esto después tiene que
 *    saberlo: si algún día un reporte pasa a leer la tabla diaria, los meses
 *    importados no van a estar ahí.
 *    (Tampoco sincroniza el período de `vacaciones`, por la misma razón:
 *    importa el historial de ausencias, no reabre cuentas de saldo.)
 */

/** Una fila de NOVEDADES ya leída: las fechas en ISO, o `""` si no se pudieron leer. */
export interface NovedadDePlanilla {
  fila: number;
  nombre: string;
  desde: string;
  hasta: string;
  motivo: string;
}

type EmpleadoParaEmparejar = { id: string; nombre: string; apellido: string };

/**
 * El id del empleado, o null si no se lo reconoce con certeza. Nunca adivina.
 *
 * La planilla escribe «APELLIDO Nombre Nombre»; `empleados` guarda `apellido` y
 * `nombre` aparte. Se compara el nombre completo normalizado, **igual contra
 * igual**: sin acentos, sin mayúsculas, sin espacios de más. De 207 nombres, 188
 * coinciden así; los 8 que no son errores de tipeo y truncados
 * («MILIA Pablo Ramiro Ramiro», «VARELA Francisco Enrique Enrique») y ésos van
 * a una persona.
 *
 * No hay un segundo intento por apellido, ni por prefijo, ni por distancia de
 * edición: en `emp` hay dos FERNANDEZ y un «FERNANDEZ» a secas no dice cuál. Y
 * si dos empleados tuvieran el nombre completo idéntico, tampoco se elige.
 */
export function emparejarEmpleado(nombre: string, empleados: EmpleadoParaEmparejar[]): string | null {
  const buscado = norm(nombre);
  if (!buscado) return null;

  const coinciden = empleados.filter((e) => norm(`${e.apellido} ${e.nombre}`) === buscado);
  return coinciden.length === 1 ? coinciden[0].id : null;
}

/**
 * Cómo la planilla escribe un motivo que la pantalla escribe distinto. Van por
 * `norm`, así que acá no importan ni las tildes ni las mayúsculas. Los otros
 * diez coinciden con la etiqueta de `TIPOS_AUSENCIA` tal cual.
 */
const SINONIMOS_DE_LA_PLANILLA: Record<string, string> = {
  "FALLECIMIENTO FAMILIAR": "FALLECIMIENTO_FAMILIAR",
};

const TIPO_POR_ETIQUETA = new Map<string, string>([
  ...TIPOS_AUSENCIA.map(([valor, etiqueta]) => [norm(etiqueta), valor] as [string, string]),
  ...Object.entries(SINONIMOS_DE_LA_PLANILLA).map(([etiqueta, valor]) => [norm(etiqueta), valor] as [string, string]),
]);

/** El valor del enum para la etiqueta de la planilla, o null. */
export function tipoDesdeElMotivo(motivo: string): string | null {
  return TIPO_POR_ETIQUETA.get(norm(motivo)) ?? null;
}

const ES_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Por qué una novedad no se reconoce, en una frase, o null si se reconoce.
 *
 * Sólo informa: `clasificar` es el que decide. Sale de las mismas tres
 * comprobaciones, así que lo que dice acá y lo que hace allá no pueden
 * contradecirse. Existe porque «sin reconocer» a secas obliga a quien revisa la
 * lista a adivinar cuál de las tres falló.
 */
export function porQueNoSeReconoce(n: NovedadDePlanilla, empleados: EmpleadoParaEmparejar[]): string | null {
  const motivos: string[] = [];
  if (!emparejarEmpleado(n.nombre, empleados)) motivos.push("nombre sin coincidencia exacta");
  if (!tipoDesdeElMotivo(n.motivo)) motivos.push(`motivo «${n.motivo}» desconocido`);
  if (!ES_FECHA_ISO.test(n.desde) || !ES_FECHA_ISO.test(n.hasta)) motivos.push("fecha ilegible");
  else if (n.desde > n.hasta) motivos.push("rango invertido (hasta antes de desde)");
  return motivos.length ? motivos.join("; ") : null;
}

/** Dos rangos ISO se tocan si cada uno empieza antes de que termine el otro. Incluye los extremos. */
const seSolapan = (aDesde: string, aHasta: string, bDesde: string, bHasta: string) =>
  aDesde <= bHasta && bDesde <= aHasta;

/**
 * Qué hacer con cada novedad.
 *
 * - `yaEstaban`: la misma persona ya tiene una ausencia que se solapa con ese
 *   rango. **El tipo no cuenta**: de las 60 que están en los dos lados, 57
 *   coinciden en el tipo y 3 no, y las 3 siguen siendo la misma ausencia
 *   cargada con otro nombre. También cae acá una novedad idéntica a otra que
 *   esta misma corrida ya va a importar, para que una fila repetida en la
 *   planilla no entre dos veces.
 * - `sinReconocer`: nombre que no empareja con certeza, motivo que no es uno de
 *   los doce, fecha ilegible, o **rango invertido** (`hasta` antes de `desde`).
 *   Este último no se importa aunque la persona y el motivo estén claros: la
 *   tabla no tiene un check para eso, el alta de RRHH tampoco, y en producción
 *   hay cero. No se va a crear la primera acá; la corrige una persona.
 * - `aImportar`: el resto, con el `empleadoId` y el `tipo` ya resueltos.
 *
 * Dos novedades de la misma persona que se pisan sin ser idénticas entran las
 * dos: no se adivina cuál es la buena.
 */
export function clasificar(
  novedades: NovedadDePlanilla[],
  empleados: EmpleadoParaEmparejar[],
  existentes: Ausencia[]
): {
  aImportar: (NovedadDePlanilla & { empleadoId: string; tipo: string })[];
  yaEstaban: NovedadDePlanilla[];
  sinReconocer: NovedadDePlanilla[];
} {
  const aImportar: (NovedadDePlanilla & { empleadoId: string; tipo: string })[] = [];
  const yaEstaban: NovedadDePlanilla[] = [];
  const sinReconocer: NovedadDePlanilla[] = [];

  // Los rangos de cada persona. Las ya cargadas, más —sólo para las idénticas— lo que
  // esta corrida va importando.
  const porEmpleado = new Map<string, Ausencia[]>();
  for (const a of existentes) {
    const lista = porEmpleado.get(a.empleado_id) ?? [];
    lista.push(a);
    porEmpleado.set(a.empleado_id, lista);
  }
  const importadas = new Set<string>();

  for (const n of novedades) {
    const empleadoId = emparejarEmpleado(n.nombre, empleados);
    const tipo = tipoDesdeElMotivo(n.motivo);
    const fechasBuenas = ES_FECHA_ISO.test(n.desde) && ES_FECHA_ISO.test(n.hasta) && n.desde <= n.hasta;

    if (!empleadoId || !tipo || !fechasBuenas) {
      sinReconocer.push(n);
      continue;
    }

    const yaCargada = (porEmpleado.get(empleadoId) ?? []).some((a) =>
      seSolapan(n.desde, n.hasta, a.fecha_desde, a.fecha_hasta)
    );
    const clave = `${empleadoId}|${n.desde}|${n.hasta}|${tipo}`;
    if (yaCargada || importadas.has(clave)) {
      yaEstaban.push(n);
      continue;
    }

    importadas.add(clave);
    aImportar.push({ ...n, empleadoId, tipo });
  }

  return { aImportar, yaEstaban, sinReconocer };
}
