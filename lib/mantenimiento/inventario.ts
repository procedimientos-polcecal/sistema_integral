/**
 * El inventario de equipos: leer el libro "BD Equipos".
 *
 * Es el padrón de la planta —qué máquinas hay, cómo se llaman y dónde están—,
 * distinto de la ficha técnica, que es lo que se releva de cada una. El libro
 * trae las dos cosas en la misma hoja `EQUIPOS`, pero al portarlo el
 * relevamiento estaba casi vacío: de 239 equipos, 15 tienen marca y ninguno
 * rodamientos.
 *
 * Verificado contra el archivo: `PLANTAS` (3), `SECTORES` (15), `EQUIPOS` (239),
 * `TIPO_EQUIPO` (26) y `COMPONENTES` (398), sin códigos repetidos ni
 * componentes colgados de un equipo que no existe.
 */

import { texto, normalizar } from "@/lib/mantenimiento/planilla";
import { entero, numero, fechaDeExcel, type FilaDelLibro } from "@/lib/mantenimiento/ficha";

/**
 * El estado de la máquina, como lo abrevia el libro.
 *
 * Sin estado se da por operativa: es de lo que se parte, y 215 de los 239
 * equipos vienen así. Darlos por fuera de servicio apagaría media planta.
 */
export function estadoDelLibro(valor: unknown): string {
  const v = normalizar(valor);

  if (v === "op" || v === "operativo") return "OPERATIVO";
  if (v === "rep" || v.includes("reparacion")) return "EN_REPARACION";
  if (v === "fuera" || v.includes("fuera")) return "FUERA_DE_SERVICIO";
  if (v.includes("mantenimiento")) return "EN_MANTENIMIENTO";
  if (v === "standby" || v === "stand by") return "STANDBY";

  return "OPERATIVO";
}

/**
 * Si esa "planta" del libro es en realidad las dos.
 *
 * El libro llama `AMBOS` a lo que el SdG llama transversal: un sector que no es
 * de una empresa sino compartido —los compresores, los equipos móviles—.
 */
export const esPlantaCompartida = (planta: unknown): boolean =>
  normalizar(planta) === "ambos";

export interface PlantaLeida {
  codigo: string;
  nombre: string;
  /** `AMBOS` no es una planta: es donde van los equipos que sirven a las dos. */
  compartida: boolean;
}

/** Una fila de PLANTAS. `null` si no tiene identificador. */
export function filaDePlanta(fila: FilaDelLibro): PlantaLeida | null {
  const codigo = texto(fila.planta_id);
  if (!codigo) return null;

  return {
    codigo,
    nombre: texto(fila.nombre_planta) ?? codigo,
    compartida: esPlantaCompartida(codigo),
  };
}

export interface SectorLeido {
  codigo: string;
  planta: string;
  nombre: string;
  descripcion: string | null;
}

/** Una fila de SECTORES. Sin código o sin nombre no es un sector. */
export function filaDeSector(fila: FilaDelLibro): SectorLeido | null {
  const codigo = texto(fila.sector_id);
  const nombre = texto(fila.nombre_sector);
  if (!codigo || !nombre) return null;

  return {
    codigo,
    planta: texto(fila.planta_id) ?? "",
    nombre,
    descripcion: texto(fila.proceso_principal),
  };
}

/**
 * Qué sectores crearía este libro que hoy no existen.
 *
 * La importación reconoce los sectores por su código y los da de alta si no
 * están. Eso es lo correcto la primera vez y es una trampa después: el
 * 31/08/2026 se unieron `PY-A2 Despacho filler 1` a `Filler 1` y
 * `PY-B2 Despacho filler 2` a `Filler 2` —en la planta son un solo lugar y
 * ninguna orden de trabajo los distinguía—, y un libro sin corregir los vuelve
 * a crear y se lleva sus equipos de vuelta.
 *
 * No se nombran esos dos códigos acá a propósito. La regla es general: un
 * sector del libro que el sistema no tiene se va a crear, y quien importa
 * merece saberlo antes, no descubrirlo después. Si alguna vez se une otro par,
 * esto avisa igual sin que nadie se acuerde de tocarlo.
 *
 * Se cuentan los equipos que el libro le asigna a cada uno porque es el tamaño
 * real del cambio: dos sectores nuevos importan poco, 33 máquinas cambiando de
 * lugar importan bastante.
 */
export interface SectorQueSeCrearia {
  codigo: string;
  nombre: string;
  /** Cuántos equipos del libro caen en ese sector. */
  equipos: number;
}

export function sectoresQueElLibroCrearia(
  sectoresDelLibro: FilaDelLibro[],
  equiposDelLibro: FilaDelLibro[],
  codigosConocidos: (string | null | undefined)[]
): SectorQueSeCrearia[] {
  // La importación compara en mayúsculas; acá se hace igual para no avisar de
  // un sector que en realidad sí existe y sólo está escrito distinto.
  const conocidos = new Set(
    codigosConocidos.filter(Boolean).map((c) => String(c).trim().toUpperCase())
  );

  const equiposPorSector = new Map<string, number>();
  for (const fila of equiposDelLibro) {
    const cod = texto(fila.sector_id)?.toUpperCase();
    if (cod) equiposPorSector.set(cod, (equiposPorSector.get(cod) ?? 0) + 1);
  }

  const nuevos: SectorQueSeCrearia[] = [];
  const vistos = new Set<string>();

  for (const fila of sectoresDelLibro) {
    const sector = filaDeSector(fila);
    if (!sector) continue;

    const cod = sector.codigo.toUpperCase();
    if (conocidos.has(cod) || vistos.has(cod)) continue;
    vistos.add(cod);

    nuevos.push({
      codigo: sector.codigo,
      nombre: sector.nombre,
      equipos: equiposPorSector.get(cod) ?? 0,
    });
  }

  return nuevos;
}

/**
 * Las columnas del libro que son del equipo, no de su ficha.
 *
 * `lee` dice cómo convertir el valor.
 */
const CAMPOS_EQUIPO: {
  columna: string;
  enElLibro: string;
  lee: (v: unknown) => string | number | null;
}[] = [
  { columna: "name", enElLibro: "nombre_equipo", lee: texto },
  { columna: "power_kw", enElLibro: "potencia_kw", lee: numero },
  { columna: "tipo_id", enElLibro: "tipo_id", lee: texto },
  { columna: "descripcion_proceso", enElLibro: "descripcion_proceso", lee: texto },
  { columna: "notes", enElLibro: "observaciones", lee: texto },
  // Ficha técnica: casi toda vacía al portarla, pero el libro se vuelve a
  // importar a medida que se releva.
  { columna: "marca", enElLibro: "marca", lee: texto },
  { columna: "modelo", enElLibro: "modelo", lee: texto },
  { columna: "nro_serie", enElLibro: "nro_serie", lee: texto },
  { columna: "anio_fabricacion", enElLibro: "año_fabricacion", lee: entero },
  { columna: "anio_instalacion", enElLibro: "año_instalacion", lee: entero },
  { columna: "tension_v", enElLibro: "tension_v", lee: texto },
  { columna: "intensidad_nominal_a", enElLibro: "intensidad_nominal_a", lee: numero },
  { columna: "rpm_motor", enElLibro: "rpm_motor", lee: entero },
  { columna: "fp_cos_phi", enElLibro: "fp_cos_phi", lee: numero },
  { columna: "relacion_reduccion", enElLibro: "relacion_reduccion_real", lee: texto },
  { columna: "rpm_salida", enElLibro: "rpm_salida", lee: entero },
  { columna: "rodamiento_motor_de", enElLibro: "rodamiento_motor_DE", lee: texto },
  { columna: "rodamiento_motor_nde", enElLibro: "rodamiento_motor_NDE", lee: texto },
  { columna: "rodamiento_carga", enElLibro: "rodamiento_carga", lee: texto },
  { columna: "rodamiento_otro", enElLibro: "rodamiento_otro", lee: texto },
  { columna: "ubicacion_fisica", enElLibro: "ubicacion_fisica", lee: texto },
  { columna: "nivel_altura_m", enElLibro: "nivel_altura_m", lee: numero },
  { columna: "origen_equipo", enElLibro: "origen_equipo", lee: texto },
  { columna: "horas_marcha", enElLibro: "horas_marcha_uso", lee: numero },
  { columna: "proveedor_repuesto_critico", enElLibro: "proveedor_repuesto_critico", lee: texto },
  { columna: "foto_registro_url", enElLibro: "foto_registro_url", lee: texto },
  { columna: "fecha_ultimo_relevamiento", enElLibro: "fecha_ultimo_relevamiento", lee: fechaDeExcel },
];

export interface EquipoLeido {
  code: string;
  /** El código del sector donde está, tal como lo llama el libro. */
  sector: string;
  planta: string;
  /** Sólo los campos que la fila trajo con algo, más el estado. */
  campos: Record<string, string | number>;
}

/**
 * Una fila de EQUIPOS. Sin código o sin nombre no es un equipo.
 *
 * Devuelve **sólo los campos que vinieron con algo**: el libro se completa a
 * medida que alguien recorre la planta, y una celda vacía quiere decir
 * "todavía no lo relevé", no "borrá lo que ya está cargado".
 */
export function filaDeEquipo(fila: FilaDelLibro): EquipoLeido | null {
  const code = texto(fila.equipo_id);
  const nombre = texto(fila.nombre_equipo);
  if (!code || !nombre) return null;

  const campos: Record<string, string | number> = {};
  for (const campo of CAMPOS_EQUIPO) {
    const valor = campo.lee(fila[campo.enElLibro]);
    if (valor !== null) campos[campo.columna] = valor;
  }

  // El estado siempre va: sin dato es "operativo", que es de lo que se parte.
  campos.status = estadoDelLibro(fila.estado);

  return {
    code,
    sector: texto(fila.sector_id) ?? "",
    planta: texto(fila.planta_id) ?? "",
    campos,
  };
}

/**
 * El código de equipo que aparece en un texto libre, buscado contra los que
 * existen de verdad.
 *
 * Hace falta porque 21 equipos —los compartidos— se llaman `C1` o `EM2`, y
 * ningún patrón razonable los distingue de cualquier otra sigla suelta. La
 * planilla de OS dice "EM2 - Caterpillar 320 C" y hay que reconocerlo.
 *
 * Gana el código más largo: "EM1" está dentro de "EM16", y tomar el corto
 * mandaría el trabajo a otra máquina.
 */
export function buscarCodigo(
  texto: string | null | undefined,
  conocidos: string[]
): string | null {
  const s = String(texto ?? "").toUpperCase();
  if (!s) return null;

  let encontrado: string | null = null;

  for (const code of conocidos) {
    const c = code.toUpperCase();
    // Delimitado: que no sea parte de una palabra más larga. Los guiones del
    // código son parte del código, así que el límite lo dan los caracteres que
    // no son letra, número ni guión.
    const limite = new RegExp(`(^|[^A-Z0-9-])${escapar(c)}($|[^A-Z0-9-])`);
    if (limite.test(s) && (!encontrado || c.length > encontrado.length)) {
      encontrado = code;
    }
  }

  return encontrado;
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
