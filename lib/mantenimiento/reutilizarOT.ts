/**
 * Copiar una OT vieja para cargar una nueva.
 *
 * POR QUÉ EXISTE
 *
 * Se cargan OT de trabajos ya hechos, en tanda: varias del mismo día, hechas
 * por la misma gente, sobre el mismo equipo. Hoy eso es volver a elegir sector,
 * equipo, especialidad, tipo, quién, los tres operarios y las horas una y otra
 * vez, cambiando sólo el detalle del trabajo.
 *
 * Esto decide **qué le presta una OT vieja a una nueva**. Vive acá y no en el
 * modal porque es una decisión con reglas, no un `setState`: qué se copia, qué
 * no, y —lo que más importa— qué hacer con un valor que el formulario no puede
 * mostrar.
 *
 * LAS FECHAS NO SE COPIAN
 *
 * Es el pedido y es lo único que no se discute: la OT nueva es de otro día.
 * Tampoco el número, que lo da la planilla al guardar.
 *
 * UN VALOR QUE EL DESPLEGABLE NO TIENE, NO SE COPIA
 *
 * Y ésta es la que no se deduce. Si se copiara un valor que el desplegable no
 * tiene, mostraría "—" mientras el formulario guarda otra cosa — lo que se ve y
 * lo que se guarda, distintos, que es la familia de errores que este repo paga
 * más caro.
 *
 * El ejemplo con el que nació esto era `LUBRICACIÓN`, que 7 órdenes tienen y el
 * formulario no ofrecía. **Ya no aplica, y por qué dejó de aplicar importa más
 * que el ejemplo**: el 21/10/2026 se vio que esa lista era una copia a mano —y
 * que además ofrecía INSTRUMENTACIÓN, OTRO, PREDICTIVO, MEJORA y MIXTO, que
 * ningún filtro conocía—, así que ahora sale de `lib/` y esas 7 se copian. Lo
 * que todavía puede quedar afuera es el valor de una OT vieja que nadie ofrece
 * hoy, que es para lo que esta regla existe de verdad.
 *
 * Así que un valor fuera de la lista **no entra**, y se devuelve en
 * `noEntraron` para decírselo a quien está cargando. Dejarlo vacío y callarlo
 * sería la misma trampa con otra ropa.
 *
 * EL PUNTAJE GUT NO SE COPIA, Y NO ES POR EL DESPLEGABLE
 *
 * Es el único valor de la OT vieja que **sí tiene dónde mostrarse** y aun así
 * no entra. La regla de arriba no lo explica: el formulario tiene los tres
 * desplegables y podría perfectamente recibir un 5-4-4. No entra porque el
 * puntaje depende de **cuándo** es la orden y no de **qué** es: la quinta vez
 * que se cambian los mismos martillos no pesa lo que pesó la primera, porque
 * lo que se puntúa es cuánto tiempo hay y hacia dónde va, hoy. Copiarlo es la
 * misma equivocación que sembrar `gut_urgencia` desde el aviso —ver
 * `lib/mantenimiento/otDesdeAviso.ts`—: un número que nadie contestó pesando
 * igual que uno que sí.
 *
 * Es la clase de "mejora" que parece gratis —ya se copia la prioridad, ¿por qué
 * no esto?— y es justo lo que el diseño no quiere. La prioridad es una palabra
 * del trabajo; el GUT es una medición de este momento. Por eso va a
 * `noEntraron`, que ya se le dice a quien está cargando: que sepa que la vieja
 * tenía un puntaje y que éste lo tiene que contestar él.
 *
 * El `Select` de operarios no necesita esto: ya se agrega a sí mismo el valor
 * elegido cuando no está en la lista de Configuración, así que una persona que
 * ya no figura se sigue viendo.
 */
import type { LineaDeRepuesto } from "@/lib/mantenimiento/repuestosDeLaOT";
import { puntajeGut } from "@/lib/mantenimiento/gut";

/** La OT vieja, con lo único que se le pide prestado. */
export interface OTVieja {
  ot_number: number;
  equipment_id: string | null;
  sector_id: string | null;
  especialidad: string | null;
  tipo: string | null;
  quien: string | null;
  descripcion: string | null;
  estado: string | null;
  contratista: string | null;
  horas: number | null;
  operario_1: string | null;
  operario_2: string | null;
  operario_3: string | null;
  prioridad: string | null;
  requiere_parada_sector: boolean | null;
  /**
   * El puntaje GUT que la vieja tenía. Está acá **sólo para poder decir que no
   * se copia**: nada de esto entra en `campos`. Opcionales porque lo que llega
   * de la ruta puede no traerlas.
   */
  gut_gravedad?: number | null;
  gut_urgencia?: number | null;
  gut_tendencia?: number | null;
  /** El texto de la celda de la planilla, para las OT anteriores a los renglones. */
  repuesto: string | null;
  /** Los renglones, cuando la OT los tiene. */
  repuestos?: ReadonlyArray<{ nombre: string; cantidad: string | null }> | null;
}

/** Lo que cada desplegable del formulario puede mostrar. */
export interface Vocabulario {
  especialidades: readonly string[];
  tipos: readonly string[];
  quien: readonly string[];
  estados: readonly string[];
  prioridades: readonly string[];
}

export interface LoQueSeCopia {
  /** Para derramar sobre el estado del formulario. Las fechas no están. */
  campos: Record<string, string | boolean>;
  /** Los renglones de repuesto, listos para el formulario. */
  lineas: LineaDeRepuesto[];
  /**
   * Lo que la OT vieja tenía y el formulario no puede mostrar, en castellano.
   * Vacío es lo normal.
   */
  noEntraron: string[];
}

/** Un campo de texto libre: el null de la base es la cadena vacía del formulario. */
const texto = (v: string | null | undefined) => (v ?? "").trim();

/**
 * Qué se lleva la OT nueva de la vieja.
 *
 * `campos` se derrama sobre el formulario con `{...form, ...campos}`, así que
 * **lo que no está acá queda como estaba**: las tres fechas, y cualquier
 * desplegable cuyo valor no se pudo representar.
 */
export function copiarDeLaOT(vieja: OTVieja, vocabulario: Vocabulario): LoQueSeCopia {
  const campos: Record<string, string | boolean> = {};
  const noEntraron: string[] = [];

  /** Copia sólo si el desplegable puede mostrarlo; si no, lo dice. */
  const deLista = (
    campo: string,
    valor: string | null,
    lista: readonly string[],
    comoSeLlama: string
  ) => {
    const v = texto(valor);
    if (!v) return;
    if (lista.includes(v)) campos[campo] = v;
    else noEntraron.push(`${comoSeLlama} ("${v}")`);
  };

  // Los ids viajan juntos: el equipo filtra por sector, así que copiar uno sin
  // el otro deja el desplegable de equipos mostrando una lista que no lo tiene.
  campos.sector_id = texto(vieja.sector_id);
  campos.equipment_id = texto(vieja.equipment_id);

  deLista("especialidad", vieja.especialidad, vocabulario.especialidades, "la especialidad");
  deLista("tipo", vieja.tipo, vocabulario.tipos, "el tipo");
  deLista("quien", vieja.quien, vocabulario.quien, "quién realiza");
  deLista("estado", vieja.estado, vocabulario.estados, "el estado");
  // 2.040 de 2.206 OT no tienen prioridad, y su desplegable no tiene opción
  // vacía: copiar el null dejaría el campo sin nada seleccionado. Sin valor,
  // se queda el que el formulario ya traía.
  deLista("prioridad", vieja.prioridad, vocabulario.prioridades, "la prioridad");

  campos.descripcion = texto(vieja.descripcion);
  campos.contratista = texto(vieja.contratista);
  campos.operario_1 = texto(vieja.operario_1);
  campos.operario_2 = texto(vieja.operario_2);
  campos.operario_3 = texto(vieja.operario_3);

  // La base lo guarda como número y el formulario lo escribe como texto.
  campos.horas = vieja.horas === null || vieja.horas === undefined ? "" : String(vieja.horas);

  campos.requiere_parada_sector = Boolean(vieja.requiere_parada_sector);

  // El GUT no entra en `campos`: ver "EL PUNTAJE GUT NO SE COPIA" arriba. Sólo
  // se avisa, y sólo si la vieja tenía el puntaje entero —con una o dos notas
  // `puntajeGut` da null, y media puntuación cuenta como sin puntaje—.
  const puntaje = puntajeGut(vieja);
  if (puntaje !== null) noEntraron.push(`el puntaje GUT ("${puntaje}")`);

  return { campos, lineas: lineasDeLaOT(vieja), noEntraron };
}

/**
 * Los renglones de repuesto que se copian.
 *
 * Una OT cargada desde ayer los tiene en `ordenes_trabajo_repuestos`. Las
 * 2.200 anteriores no: tienen el texto suelto de la planilla, "2 grillas 2 mm".
 *
 * Ese texto entra **tal cual, en un solo renglón**. Hay un parseo que lo
 * partiría en cantidad y descripción —`itemsDeRepuesto()`, el que leyó las 275
 * OT viejas—, y a propósito no se usa acá: normaliza el texto, y lo que salga
 * de este formulario se escribe en la celda de la planilla. Que el sistema
 * reescriba "2 grillas 2 mm" como "2 grilla 2MM" es cambiarle las palabras a
 * quien las puso. Partirlo es una decisión de quien está cargando, que tiene
 * los dos campos al lado.
 */
export function lineasDeLaOT(vieja: OTVieja): LineaDeRepuesto[] {
  const renglones = (vieja.repuestos ?? [])
    .map((r) => ({ cantidad: texto(r?.cantidad), nombre: texto(r?.nombre) }))
    .filter((r) => r.nombre !== "");
  if (renglones.length > 0) return renglones;

  const suelto = texto(vieja.repuesto);
  return suelto ? [{ cantidad: "", nombre: suelto }] : [];
}

/**
 * El número tal como lo escribieron, listo para preguntar por él.
 *
 * Se acepta "2814", " 2814 " y "OT 2814": quien copia está mirando una
 * pantalla donde el número viene con esa etiqueta, y pedirle que la saque es
 * pedirle que haga de parser.
 */
export function numeroDeOT(escrito: string): number | null {
  const soloDigitos = String(escrito ?? "").replace(/[^0-9]/g, "");
  if (!soloDigitos) return null;
  const n = Number(soloDigitos);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** El aviso de la barra, con lo que no se pudo traer si hubo algo. */
export function avisoDeReutilizada(numero: number, noEntraron: readonly string[]): string {
  const base = `Los campos vienen de la OT ${numero} — revisalos antes de guardar.`;
  if (noEntraron.length === 0) return base;
  return `${base} No se pudo traer ${noEntraron.join(" ni ")}: elegilo a mano.`;
}
