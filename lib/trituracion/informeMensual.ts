/**
 * El informe mensual "oficial" de plantas de trituración — reproduce, tabla
 * por tabla, la pestaña "Informe Mensual"/"AGOSTO" de la planilla real
 * (`1QU1iDgcsTSwTe_RMzUs9DOJwfDV0H6ylR7ublMwcMdI`), leída con `leerFormulas()`
 * el 22/09/2026 para sacar las fórmulas exactas en vez de adivinarlas a
 * partir de los resultados.
 *
 * "Horas teóricas" ACÁ es **días operativos × 8** — la definición de LA
 * PLANILLA, no la de `lib/trituracion/horas.ts` (que suma
 * `hora_inicio`→`hora_fin` de cada parte, la que usa el resto del SdG:
 * `/trituracion`, `/trituracion/partes`). El usuario eligió a propósito
 * mantener el número que ya se venía reportando (22/09/2026, tras avisarle
 * que con agosto real la diferencia es grande: Planta 1 da 208h por acá y
 * 169h por la otra) — así que estas cuentas NO van a coincidir con las que
 * ya se ven en otras pantallas del módulo para el mismo mes. Es a propósito:
 * este archivo reproduce el informe que ya se armaba a mano, no una segunda
 * fuente de verdad para "cuántas horas trabajó la planta".
 *
 * Verificado cifra por cifra contra agosto 2026 real (partes reales de la
 * base, las 3 plantas): Tablas 1 (menos productividad), 3, 5 y 6 exactas;
 * Disponibilidad, "% horas perdidas", "Toneladas por viaje", "Dirección" y
 * los tres % de causa (Falta de piedra/Mantenimiento/Varios) exactos en las
 * tres plantas.
 *
 * "Utilización", "Productividad media (t/h marcha)" y "Producción (Tn/h)"
 * **no coinciden exacto** — pueden diferir varios puntos (Planta 3 dio 13
 * puntos de diferencia en Utilización). Las tres dependen de "Hs reales", y
 * ahí la planilla NO tiene una fórmula: para cada planta suma un puñado de
 * rangos de celda sueltos, elegidos a mano al armar ese informe puntual (se
 * ve en las fórmulas reales de la fila 16-18 de "Informe Mensual" — no es
 * un `SUMIFS` por fecha como el resto). Acá "Hs reales" sale de restar las
 * horas perdidas de las teóricas, que es la única cuenta reproducible sin
 * adivinar qué filas curó a mano quien armó cada informe mensual.
 */

export interface ParteParaInformeMensual {
  fecha: string; // "YYYY-MM-DD"
  estado: "opero" | "no_opero";
  material: string | null;
  origen: string | null;
  horasMantenimiento: number;
  horasFaltaPiedra: number;
  horasProduccion: number;
  horasOtro: number;
  camionesLlegados: number | null;
  toneladasProcesadas: number | null;
}

export interface TablaPorMaterial {
  dolomita: number;
  chocolata: number;
  caliza: number;
  /** Un material vacío o combinado ("Caliza + Chocolata", del histórico importado, ver `lib/trituracion/importar.ts`) no se reparte adivinando a cuál de los tres asignarlo — mismo criterio que `toneladasPorMaterial` de `informe.ts`. */
  sinClasificar: number;
  total: number;
}

export interface InformeMensualPlanta {
  diasOperativos: number;
  /** Cuenta filas (partes), no días distintos — mismo criterio que el `COUNTIFS` de la planilla: un día con dos turnos y falta de piedra en los dos cuenta dos veces. */
  diasConFaltaPiedra: number;
  horasTeoricas: number;
  horasFaltaPiedra: number;
  horasMantenimiento: number;
  /** Producción + Otro combinadas — así es como la planilla junta esas dos columnas bajo "Varios". */
  horasVarios: number;
  horasPerdidasTotal: number;
  horasReales: number;
  viajes: number;
  toneladas: number;
  /** toneladas / horasReales — es el mismo número que "Producción (Tn/h)" de la Tabla 2, la planilla lo repite en las dos tablas. */
  productividadTHMarcha: number | null;
  toneladasPorViaje: number | null;
  pctHorasPerdidas: number | null;
  /** (horasTeoricas − mantenimiento − varios) / horasTeoricas — la falta de piedra NO resta disponibilidad: no es un fallo de la planta. */
  disponibilidad: number | null;
  /** horasReales / horasTeoricas. */
  utilizacion: number | null;
  /** horasTeoricas / horas del mes calendario (días del mes × 24) — qué fracción del mes entero fueron horas de turno teórico. */
  direccion: number | null;
  pctFaltaPiedra: number | null;
  pctMantenimiento: number | null;
  pctVarios: number | null;
  porMaterial: TablaPorMaterial;
}

/** Días del mes × 24 — para "Dirección". */
export function horasDelMes(mes: string): number {
  const [anio, m] = mes.split("-").map(Number);
  const dias = new Date(Date.UTC(anio, m, 0)).getUTCDate();
  return dias * 24;
}

function porcentaje(numerador: number, denominador: number): number | null {
  return denominador > 0 ? numerador / denominador : null;
}

export function informeMensualPorPlanta(partes: ParteParaInformeMensual[], mes: string): InformeMensualPlanta {
  const operativos = partes.filter((p) => p.estado === "opero");

  const diasOperativos = new Set(operativos.map((p) => p.fecha)).size;
  const diasConFaltaPiedra = operativos.filter((p) => p.horasFaltaPiedra > 0).length;

  const horasFaltaPiedra = operativos.reduce((s, p) => s + p.horasFaltaPiedra, 0);
  const horasMantenimiento = operativos.reduce((s, p) => s + p.horasMantenimiento, 0);
  const horasVarios = operativos.reduce((s, p) => s + p.horasProduccion + p.horasOtro, 0);
  const horasPerdidasTotal = horasFaltaPiedra + horasMantenimiento + horasVarios;

  const horasTeoricas = diasOperativos * 8;
  const horasReales = horasTeoricas - horasPerdidasTotal;

  const viajes = operativos.reduce((s, p) => s + (p.camionesLlegados ?? 0), 0);
  const toneladas = operativos.reduce((s, p) => s + (p.toneladasProcesadas ?? 0), 0);

  const porMaterial: TablaPorMaterial = { dolomita: 0, chocolata: 0, caliza: 0, sinClasificar: 0, total: 0 };
  for (const p of operativos) {
    const t = p.toneladasProcesadas ?? 0;
    if (t === 0) continue;
    porMaterial.total += t;
    if (p.material === "Dolomita") porMaterial.dolomita += t;
    else if (p.material === "Chocolata") porMaterial.chocolata += t;
    else if (p.material === "Caliza") porMaterial.caliza += t;
    else porMaterial.sinClasificar += t;
  }

  return {
    diasOperativos,
    diasConFaltaPiedra,
    horasTeoricas,
    horasFaltaPiedra,
    horasMantenimiento,
    horasVarios,
    horasPerdidasTotal,
    horasReales,
    viajes,
    toneladas,
    productividadTHMarcha: horasReales > 0 ? toneladas / horasReales : null,
    toneladasPorViaje: viajes > 0 ? toneladas / viajes : null,
    pctHorasPerdidas: porcentaje(horasPerdidasTotal, horasTeoricas),
    disponibilidad: porcentaje(horasTeoricas - horasMantenimiento - horasVarios, horasTeoricas),
    utilizacion: porcentaje(horasReales, horasTeoricas),
    direccion: porcentaje(horasTeoricas, horasDelMes(mes)),
    pctFaltaPiedra: porcentaje(horasFaltaPiedra, horasTeoricas),
    pctMantenimiento: porcentaje(horasMantenimiento, horasTeoricas),
    pctVarios: porcentaje(horasVarios, horasTeoricas),
    porMaterial,
  };
}

export interface FilaPorOrigen {
  origen: string;
  toneladas: number;
}

/**
 * Toneladas procesadas por origen (yacimiento o proveedor externo),
 * sumando TODAS las plantas juntas — Tabla N°6 de la planilla real
 * ("Toneladas acarreadas por cantera"). Sin origen cargado no entra: no se
 * inventa de dónde vino la piedra.
 */
export function toneladasPorOrigen(partesDeTodasLasPlantas: ParteParaInformeMensual[]): FilaPorOrigen[] {
  const totales = new Map<string, number>();
  for (const p of partesDeTodasLasPlantas) {
    if (p.estado !== "opero" || !p.origen || !p.toneladasProcesadas) continue;
    totales.set(p.origen, (totales.get(p.origen) ?? 0) + p.toneladasProcesadas);
  }
  return [...totales.entries()]
    .map(([origen, toneladas]) => ({ origen, toneladas }))
    .sort((a, b) => b.toneladas - a.toneladas);
}
