/**
 * Lo que la planilla real no guarda por carga sino que se sabe de memoria: qué
 * combustible toma cada equipo y en qué se mide su avance. No vive en
 * `equipos` (tabla compartida con Mantenimiento) porque es un dato propio de
 * Taller Vial — mismo criterio que `TIPOS_DE_ACARREO` de Cantera, que tampoco
 * agrega columnas a un catálogo que otro módulo ya usa.
 */

export type UnidadDeUso = "horas" | "km";
export type TipoDeCombustible = "DIESEL_500" | "INFINIA";

/**
 * Nafta en vez de gasoil: EM7 (Liu Gong 856) y EM9 (Scania 420 8x4), tal cual
 * la fórmula real de la planilla ("DATOS", columna E) y confirmado contra
 * filas reales — el resto siempre carga DIESEL 500.
 */
const CODIGOS_A_INFINIA = new Set(["EM7", "EM9"]);

export function tipoDeCombustible(codigo: string): TipoDeCombustible {
  return CODIGOS_A_INFINIA.has(codigo) ? "INFINIA" : "DIESEL_500";
}

/**
 * Camiones y camioneta se miden por odómetro (km); excavadoras, cargadoras y
 * autoelevadores por horómetro (horas). Sólo EM9 (Scania 420 8x4, lectura real
 * de 199.342) se pudo confirmar contra un dato real de la planilla — el resto
 * de este grupo se asume por ser el mismo tipo de vehículo (EM8, otro Scania;
 * EM13, una camioneta; EM15, un camión). Si alguno resulta estar mal, se
 * corrige acá y no hace falta tocar nada más: nada en `lib/tallerVial/`
 * depende de que la lista sea perfecta desde el día uno, sólo la etiqueta que
 * ve quien carga y el cálculo de trabajado.
 */
const CODIGOS_EN_KM = new Set(["EM8", "EM9", "EM13", "EM15"]);

export function unidadDeUso(codigo: string): UnidadDeUso {
  return CODIGOS_EN_KM.has(codigo) ? "km" : "horas";
}

export const ETIQUETA_UNIDAD: Record<UnidadDeUso, string> = {
  horas: "hs",
  km: "km",
};

/**
 * El código EM al principio de un texto libre ("EM5 - Doosan SD 300" → "EM5").
 * Null si el texto no arranca con uno — la planilla real también tiene filas
 * sueltas de combustible que no son de un equipo móvil ("empresa piparo",
 * "sección hornos"), y esas no tienen que matchear ninguno.
 */
export function codigoDesdeTextoLibre(raw: string): string | null {
  const m = raw.trim().match(/^(EM\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** Orden numérico de códigos EM (EM2 antes que EM10), no alfabético. */
export function compararCodigosEM(a: string, b: string): number {
  const na = Number(a.replace(/^EM/i, ""));
  const nb = Number(b.replace(/^EM/i, ""));
  if (isFinite(na) && isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

/**
 * El término para acotar el buscador del pañol a los repuestos de ESTE
 * equipo puntual. Los artículos de Taller Vial en `inventario_articulos`
 * traen la marca y el modelo escritos en la descripción ("FILTRO DOOSAN 225
 * ACEITE MOTOR", "CORREA CAT 320B ALTERNADOR", "SELLO CAT 950G") — no hay
 * una columna ni una FK a `equipos`, es texto libre en la misma tabla que ya
 * usa el resto de Inventario. Verificado el 18/09/2026 contra los 125
 * artículos reales con `ubicacion = 'TALLER VIAL'`, uno por uno — no es una
 * lista adivinada desde el nombre del equipo.
 *
 * OJO CON LA NOTACIÓN: el pañol escribe el modelo sin el espacio que sí
 * tiene el nombre del equipo ("320B", no "320 B") y con la marca abreviada
 * ("CAT", "LIUGONG" en una palabra) — el término de acá es el del pañol, no
 * el nombre de `equipos.name`.
 *
 * Los que faltan (EM13 camioneta, EM14 carretón sin motor, EM15 camión
 * regador) no tienen ni un artículo con su modelo en el pañol relevado —
 * capaz porque se service-an afuera. Quedan sin término a propósito: no
 * tener uno mapeado no es lo mismo que "no tiene repuestos", así que quien
 * llama tiene que mostrar el pañol completo en vez de una lista vacía.
 */
const TERMINO_DE_PANOL_POR_CODIGO: Record<string, string> = {
  EM1: "CAT 320B",
  EM2: "CAT 320C",
  EM3: "DOOSAN 225",
  EM4: "DOOSAN 225",
  EM5: "DOOSAN 300",
  EM6: "CAT 950G",
  EM7: "LIUGONG 856",
  EM8: "SCANIA",
  EM9: "SCANIA",
  EM10: "AUTOELEVADOR TOYOTA",
  EM11: "AUTOELEVADOR TOYOTA",
  EM12: "AUTOELEVADOR XCMG",
};

export function terminoDePanolDelEquipo(codigo: string): string | null {
  return TERMINO_DE_PANOL_POR_CODIGO[codigo] ?? null;
}
