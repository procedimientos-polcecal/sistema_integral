/**
 * La ficha técnica de los equipos: leer el libro "BD Equipos".
 *
 * Es un libro de Excel con tres hojas que se completan a mano durante el
 * relevamiento: `TIPO_EQUIPO` (el catálogo de tipos), `EQUIPOS` (los datos
 * técnicos de cada máquina) y `COMPONENTES` (qué la compone).
 *
 * Se lee **por nombre de columna**, tolerando cómo lo escribió quien armó la
 * hoja: `año_fabricacion` y `anio_fabricacion`, con mayúsculas o sin ellas.
 * A diferencia de las otras planillas del módulo, ésta no se pudo contrastar
 * contra el archivo de verdad, así que los alias son deliberadamente amplios.
 */

import { texto, normalizar, monto } from "@/lib/mantenimiento/planilla";

/** Un entero, redondeado. `null` si la celda no tiene un número. */
export function entero(valor: unknown): number | null {
  const n = monto(valor);
  return n === null ? null : Math.round(n);
}

/** Un número con decimales. `null` si la celda no tiene un número. */
export const numero = (valor: unknown): number | null => monto(valor);

/**
 * Una fecha del libro.
 *
 * Excel la manda como serial; a mano se escribe d/m/aaaa.
 */
export function fechaDeExcel(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;

  const n = Number(valor);
  if (!isNaN(n) && n > 1) {
    return new Date((Math.floor(n) - 25569) * 86400 * 1000).toISOString().slice(0, 10);
  }

  const dmy = String(valor).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : null;
}

/** Una fila del libro, tal como la devuelve la lectura del xlsx. */
export type FilaDelLibro = Record<string, unknown>;

/**
 * Busca una columna por cualquiera de sus nombres.
 *
 * Compara normalizado —sin acentos, sin mayúsculas, sin espacios de más— para
 * que `año_fabricacion`, `anio_fabricacion` y `AÑO FABRICACION` sean la misma.
 */
function celda(fila: FilaDelLibro, ...nombres: string[]): unknown {
  const buscados = nombres.map((n) => normalizar(n).replace(/[\s_]+/g, ""));

  for (const [clave, valor] of Object.entries(fila)) {
    if (buscados.includes(normalizar(clave).replace(/[\s_]+/g, ""))) return valor;
  }
  return undefined;
}

/** Las columnas de la hoja TIPO_EQUIPO, tal como se llaman en la tabla. */
const COLUMNAS_TIPO = [
  "categoria", "nombre_tipo", "descripcion_funcion", "accionamiento",
  "potencia_kw_tipica", "tension_v", "velocidad_rpm_tipica", "tiene_reductor",
  "relacion_reduccion", "tipo_correa", "cant_correas", "rodamiento_lado_motor",
  "rodamiento_lado_carga", "rodamiento_intermedio", "lubricante_tipo",
  "lubricante_marca_ref", "frecuencia_lubricacion", "tiene_filtro_aceite",
  "tiene_filtro_aire", "tiene_filtro_hidraulico", "insumo_especial_1",
  "insumo_especial_2", "temperatura_max_rodamiento_c", "vibracion_max_mm_s",
  "amperaje_nominal_a", "freq_inspeccion_visual", "freq_lubricacion",
  "freq_revision_mayor", "notas_tecnicas",
] as const;

export interface TipoLeido {
  tipo_id: string;
  [columna: string]: string | null;
}

/**
 * Una fila de TIPO_EQUIPO. `null` si no tiene identificador.
 *
 * Todas las columnas del tipo son texto: son valores de referencia —"1450 rpm",
 * "cada 500 hs"— y no números con los que se calcule.
 *
 * Sólo se leen las columnas conocidas: guardar una de más haría fallar el
 * insert entero por una columna que la tabla no tiene.
 */
export function filaDeTipo(fila: FilaDelLibro): TipoLeido | null {
  const id = texto(celda(fila, "tipo_id"));
  if (!id) return null;

  const tipo: TipoLeido = { tipo_id: id };
  for (const columna of COLUMNAS_TIPO) tipo[columna] = texto(celda(fila, columna));
  return tipo;
}

/**
 * Las columnas de la hoja EQUIPOS: cómo se llaman ahí y cómo acá.
 *
 * `lee` dice cómo convertir el valor. Los nombres alternativos son los que
 * cambian entre la hoja y la tabla.
 */
const CAMPOS_FICHA: {
  columna: string;
  enLaHoja: string[];
  lee: (v: unknown) => string | number | null;
}[] = [
  { columna: "descripcion_proceso", enLaHoja: ["descripcion_proceso"], lee: texto },
  { columna: "power_kw", enLaHoja: ["potencia_kw", "power_kw"], lee: numero },
  { columna: "marca", enLaHoja: ["marca"], lee: texto },
  { columna: "modelo", enLaHoja: ["modelo"], lee: texto },
  { columna: "nro_serie", enLaHoja: ["nro_serie", "numero_serie"], lee: texto },
  { columna: "anio_fabricacion", enLaHoja: ["año_fabricacion", "anio_fabricacion"], lee: entero },
  { columna: "anio_instalacion", enLaHoja: ["año_instalacion", "anio_instalacion"], lee: entero },
  { columna: "tension_v", enLaHoja: ["tension_v"], lee: texto },
  { columna: "intensidad_nominal_a", enLaHoja: ["intensidad_nominal_a"], lee: numero },
  { columna: "rpm_motor", enLaHoja: ["rpm_motor"], lee: entero },
  { columna: "fp_cos_phi", enLaHoja: ["fp_cos_phi"], lee: numero },
  { columna: "relacion_reduccion", enLaHoja: ["relacion_reduccion_real", "relacion_reduccion"], lee: texto },
  { columna: "rpm_salida", enLaHoja: ["rpm_salida"], lee: entero },
  { columna: "rodamiento_motor_de", enLaHoja: ["rodamiento_motor_de"], lee: texto },
  { columna: "rodamiento_motor_nde", enLaHoja: ["rodamiento_motor_nde"], lee: texto },
  { columna: "rodamiento_carga", enLaHoja: ["rodamiento_carga"], lee: texto },
  { columna: "rodamiento_otro", enLaHoja: ["rodamiento_otro"], lee: texto },
  { columna: "ubicacion_fisica", enLaHoja: ["ubicacion_fisica"], lee: texto },
  { columna: "nivel_altura_m", enLaHoja: ["nivel_altura_m"], lee: numero },
  { columna: "origen_equipo", enLaHoja: ["origen_equipo"], lee: texto },
  { columna: "horas_marcha", enLaHoja: ["horas_marcha_uso", "horas_marcha"], lee: numero },
  { columna: "proveedor_repuesto_critico", enLaHoja: ["proveedor_repuesto_critico"], lee: texto },
  { columna: "relevado_por", enLaHoja: ["relevado_por"], lee: texto },
  { columna: "foto_registro_url", enLaHoja: ["foto_registro_url"], lee: texto },
  { columna: "fecha_ultimo_relevamiento", enLaHoja: ["fecha_ultimo_relevamiento"], lee: fechaDeExcel },
];

export interface FichaLeida {
  /** El código del equipo, que es con lo que se lo busca en el sistema. */
  code: string;
  /** Sólo los campos que la fila trajo con algo. */
  campos: Record<string, string | number>;
  /** El tipo al que la hoja lo asocia, si lo dice. */
  tipo_id: string | null;
}

/**
 * Una fila de EQUIPOS. `null` si no dice de qué equipo habla.
 *
 * Devuelve **sólo los campos que vinieron con algo**: la hoja se completa de a
 * poco durante el relevamiento, y una celda vacía significa "todavía no lo
 * relevé", no "borrá lo que ya está cargado".
 */
export function filaDeFicha(fila: FilaDelLibro): FichaLeida | null {
  const code = texto(celda(fila, "equipo_id", "code", "codigo"));
  if (!code) return null;

  const campos: Record<string, string | number> = {};
  for (const campo of CAMPOS_FICHA) {
    const valor = campo.lee(celda(fila, ...campo.enLaHoja));
    if (valor !== null) campos[campo.columna] = valor;
  }

  return { code, campos, tipo_id: texto(celda(fila, "tipo_id")) };
}

export interface ComponenteLeido {
  /** El código del equipo al que pertenece. */
  code: string;
  componente: {
    componente_id: string | null;
    nombre: string;
    categoria: string | null;
    especificacion: string | null;
    material: string | null;
    cantidad: string | null;
    proveedor_critico: string | null;
    criticidad: string | null;
    foto_url: string | null;
    fecha_relevamiento: string | null;
    relevado_por: string | null;
  };
}

/** Una fila de COMPONENTES. Sin equipo o sin nombre no es un componente. */
export function filaDeComponente(fila: FilaDelLibro): ComponenteLeido | null {
  const code = texto(celda(fila, "equipo_id", "code", "codigo"));
  const nombre = texto(celda(fila, "nombre_componente", "nombre"));
  if (!code || !nombre) return null;

  return {
    code,
    componente: {
      componente_id: texto(celda(fila, "componente_id")),
      nombre,
      categoria: texto(celda(fila, "categoria_componente", "categoria")),
      especificacion: texto(celda(fila, "especificacion")),
      material: texto(celda(fila, "material")),
      cantidad: texto(celda(fila, "cantidad")),
      proveedor_critico: texto(celda(fila, "proveedor_critico")),
      criticidad: texto(celda(fila, "criticidad_componente", "criticidad")),
      foto_url: texto(celda(fila, "foto_url")),
      fecha_relevamiento: fechaDeExcel(celda(fila, "fecha_relevamiento")),
      relevado_por: texto(celda(fila, "relevado_por")),
    },
  };
}

/** Los nombres de los campos de la ficha, para mostrarlos y para editarlos. */
export const CAMPOS_EDITABLES = CAMPOS_FICHA.map((c) => c.columna);

/**
 * Los campos de la ficha que llegan de un formulario.
 *
 * A diferencia de la importación, acá **vaciar un campo lo borra**: en la hoja
 * una celda vacía quiere decir "todavía no lo relevé", pero en el formulario
 * quiere decir "esto no va". Sólo se tocan los campos que el formulario mandó.
 */
export function fichaDesdeFormulario(
  valores: Record<string, unknown>
): Record<string, string | number | null> {
  const campos: Record<string, string | number | null> = {};

  for (const campo of CAMPOS_FICHA) {
    if (!(campo.columna in valores)) continue;
    campos[campo.columna] = campo.lee(valores[campo.columna]);
  }

  if ("tipo_id" in valores) campos.tipo_id = texto(valores.tipo_id);
  return campos;
}
