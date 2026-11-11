import type { Modulo } from "@/lib/core/types";
import type { EntradaCaida, SaludDelSistema } from "@/lib/core/saludDeLasSincronizaciones";
import { hoyEnArgentina } from "@/lib/core/fechas";
import type { Notificacion } from "./notificaciones";
import { cantidadDelAviso, type Ritmo } from "./ritmo";

/**
 * Los conteos que pueden generar un aviso. Todos opcionales: cada ruta pasa los
 * de los módulos que el usuario tiene, y los que faltan no generan nada.
 */
export interface ConteosParaAvisos {
  rrhhSinClasificar: number;
  mantenimientoAtrasadas: number;
  mantenimientoDivergencias: number;
  comprasEsperandoAprobacion: number;
  comprasConsultasAbiertas: number;
  inventarioSinPlanilla: number;
  produccionSinPlanilla: number;
  despachoAbiertas: number;
  despachoSinPlanilla: number;
  facturacionSinVincular: number;
  canteraSinConciliar: number;
  calidadEnvasesSinPlanilla: number;
  calidadCarbonillaBandeja: number;
  tallerVialSinEquipo: number;
  tallerVialSinService: number;
  trituracionSinPlanilla: number;
  syhVencidas: number;
  syhSinCompletar: number;
  syhFotosSinRespaldar: number;
  agendaDivergencias: number;
}

/**
 * Qué título y qué link le corresponde a cada conteo. El orden de esta lista es
 * el orden en que salen los avisos.
 *
 * Lo que entra acá tiene que **pedir hacer algo**. Un movimiento que no llegó a
 * la planilla no es decorativo: el stock sale de las fórmulas de allá, así que
 * la próxima sincronización lo revierte.
 */
const AVISOS: { clave: keyof ConteosParaAvisos; id: string; titulo: string; href: string }[] = [
  { clave: "rrhhSinClasificar", id: "rrhh-sin-clasificar", titulo: "Ausencias sin clasificar", href: "/rrhh/asistencia?tab=dia" },
  { clave: "mantenimientoAtrasadas", id: "mant-atrasadas", titulo: "Órdenes de trabajo atrasadas", href: "/mantenimiento/ordenes?estado=ATRASADO" },
  // Órdenes en las que el sistema y la planilla dicen cosas distintas. La
  // tabla se rehace en cada sincronización, así que su tamaño es la
  // divergencia de hoy y no un acumulado: lo que se arregla desaparece solo.
  { clave: "mantenimientoDivergencias", id: "mant-divergencias", titulo: "Órdenes que dicen distinto en el sistema y en la planilla", href: "/mantenimiento/ordenes" },
  { clave: "comprasEsperandoAprobacion", id: "compras-por-aprobar", titulo: "Requerimientos esperando aprobación", href: "/compras/aprobaciones" },
  /*
   * Una pregunta de Mantenimiento por un repuesto que nadie contestó. Es el
   * estado que el diseño del 26/10/2026 existe para hacer visible, y el push del
   * momento no alcanza para sostenerlo: fuera de la ventana de 7:00 a 21:00 no
   * se manda y **no se reintenta nunca**, así que una pregunta de las 22:00 no
   * interrumpió a nadie. Esto es la red que la recoge a la mañana siguiente.
   *
   * No lleva umbral de días, aunque el spec lo dejaba a elección del
   * constructor: una pregunta contestada el mismo día no llega a aparecer acá
   * —el conteo son las que siguen esperando—, y esperar N días para nombrarla es
   * justo el silencio que este aviso viene a tapar. Si en la práctica hiciera
   * ruido, el umbral se agrega donde se cuenta y **con un id nuevo**.
   *
   * Va a `compras_consultados` y no a todo el que vea Compras: lo reparte
   * `DE_UNA_LISTA` en `avisosDeUsuario.ts`, por lo mismo que
   * `compras-por-aprobar` va a los aprobadores.
   */
  { clave: "comprasConsultasAbiertas", id: "compras-consultas-repuestos", titulo: "Consultas de repuestos sin responder", href: "/compras/consultas" },
  { clave: "inventarioSinPlanilla", id: "inv-sin-planilla", titulo: "Movimientos que no llegaron a la planilla", href: "/inventario/movimientos" },
  { clave: "produccionSinPlanilla", id: "produccion-sin-planilla", titulo: "Partes de producción que no llegaron a la planilla", href: "/produccion" },
  /*
   * Una orden sin cerrar es un camión que se fue sin que nadie marcara la
   * salida. No es sólo un dato faltante: el espejo escribe **al cerrar**, así
   * que esa orden todavía no está en la planilla, y la planilla es de donde lee
   * quien no entra al sistema. Se avisa de las de días anteriores y no de las de
   * hoy, que están abiertas porque el camión está ahí.
   */
  { clave: "despachoAbiertas", id: "despacho-sin-cerrar", titulo: "Órdenes de carga sin cerrar de días anteriores", href: "/despacho" },
  { clave: "despachoSinPlanilla", id: "despacho-sin-planilla", titulo: "Órdenes de carga que no llegaron a la planilla", href: "/despacho/ordenes" },
  { clave: "facturacionSinVincular", id: "facturacion-sin-vincular", titulo: "Facturas en el buzón sin vincular a una compra", href: "/facturacion?estado=recibida" },
  { clave: "canteraSinConciliar", id: "cantera-sin-conciliar", titulo: "Registros de cantera con factura sin conciliar o a revisar", href: "/cantera/registros" },
  { clave: "calidadEnvasesSinPlanilla", id: "calidad-envases-sin-planilla", titulo: "Movimientos de envases que no llegaron a la planilla", href: "/calidad/envases/movimientos" },
  /*
   * En carbonilla manda la planilla, y desde el 23/10/2026 una fila que cambió
   * se relee sola. Lo que queda en la bandeja es lo que el SdG **no puede**
   * resolver y necesita una persona: una fila vaciada —que no se borra sola
   * porque una planilla calculando se lee igual que una vacía—, un código que
   * no es de ningún carbonillero, o un id duplicado por copiar y pegar una
   * fila.
   *
   * La bandeja existe desde el 13/10 y en diez días no la miró nadie. En ese
   * tiempo el SdG estuvo 8 t abajo y después 59 t abajo, y las dos veces se
   * supo porque alguien preguntó. Un tablero que hay que acordarse de abrir no
   * es un tablero: por eso esto va al resumen diario, que llega solo.
   */
  { clave: "calidadCarbonillaBandeja", id: "calidad-carbonilla-bandeja", titulo: "Filas de la planilla de carbonilla que el sistema no pudo leer", href: "/calidad/carbonilla" },
  { clave: "tallerVialSinEquipo", id: "taller-vial-sin-equipo", titulo: "Cargas de combustible sin un equipo reconocido", href: "/taller-vial/cargas" },
  /*
   * Reemplaza a "service de 250 hs vencido" y "service por vencer", que medían
   * una tabla con **un solo service** en todo el sistema y por lo tanto sólo
   * podían decir 0 o 1. Lo accionable son los 15 equipos de 16 a los que nunca
   * se les anotó uno.
   *
   * El id es nuevo a propósito. Los dos viejos
   * —`taller-vial-service-vencido` y `taller-vial-service-proximo`— quedan
   * huérfanos en `notificaciones_descartes`, lo cual es inofensivo porque nunca
   * más coinciden con nada. Reusar uno sería peor: a quien lo había descartado
   * le llegaría ya silenciado un aviso que nunca vio.
   */
  { clave: "tallerVialSinService", id: "taller-vial-sin-service", titulo: "Equipos sin ningún service registrado", href: "/taller-vial/services" },
  { clave: "trituracionSinPlanilla", id: "trituracion-sin-planilla", titulo: "Partes de trituración sin exportar a la planilla", href: "/trituracion/partes" },
  { clave: "syhVencidas", id: "syh-vencidas", titulo: "Condiciones inseguras vencidas", href: "/seguridad-higiene/condiciones?estado=Vencida" },
  /*
   * Es **un** aviso y no tres («sin evaluar», «sin asignar», «sin lugar»), a
   * propósito. Una condición a la que le pusieron los cinco puntajes pero
   * nunca le asignaron responsable ni fecha máxima **no puede vencer nunca** —no
   * hay fecha que pase— y deja de ser «sin evaluar»: con un aviso por cada
   * cosa, esa fila desaparecería de todos y del push para siempre. Juntos no
   * hay por dónde escaparse. Cuenta lo mismo que `faltasPendientes`: las
   * abiertas a las que les falta algo.
   *
   * Los href usan el vocabulario de los filtros de la pantalla (`Vencida`,
   * `alguna`) y son lo que hacen los botones del encabezado de esa pantalla: lo
   * ata `lib/seguridadHigiene/filtrosUrl.test.ts`.
   */
  { clave: "syhSinCompletar", id: "syh-sin-completar", titulo: "Condiciones inseguras sin completar", href: "/seguridad-higiene/condiciones?estado=abierta&falta=alguna" },
  /*
   * La foto que lleva más de tres días sin copia en Drive: el respaldo está
   * **atascado**, que no es lo mismo que «todavía no corrió el cron».
   *
   * Existe porque el cron (`syh-respaldo-de-fotos`) falla en silencio por
   * diseño —la carpeta que falta, la carpeta en «Mi unidad», una foto que no
   * sale— y el único rastro es una fila en `sincronizaciones` que ninguna
   * pantalla lee. Las 52 fotos del Excel se perdieron exactamente así: un
   * respaldo que no respalda y nadie se entera. Este aviso mira **el dato y no
   * el log**: cuenta fotos, así que cubre los tres casos de una vez.
   *
   * **El umbral de tres días es lo que lo hace tolerable**, y no un detalle: el
   * aviso sale también por push, y sin el umbral sonaría todas las mañanas con
   * las fotos de ayer, que el cron de esta noche todavía no alcanzó. La cuenta
   * está en `corteDeFotosAtascadas`, que tiene su test.
   */
  { clave: "syhFotosSinRespaldar", id: "syh-fotos-sin-respaldar", titulo: "Fotos de condiciones inseguras sin copia de respaldo en Drive", href: "/seguridad-higiene" },
  /*
   * LA AGENDA.
   *
   * **`agenda-divergencias` es de quien mira.** Un evento que el SdG escribió en
   * Google y alguien movió o borró desde allá: el calendario y la OT dicen cosas
   * distintas y la sincronización dejó de pisarlo. Cuenta los eventos suyos —dueño
   * o invitado con usuario del SdG— con divergencia que **todavía no dio por
   * vista** (`contarDivergenciasSinVer`). Dar por vista apaga la campana de quien
   * aprieta y de nadie más, así que el número depende de la persona.
   *
   * Por eso es **el primer aviso de esta lista que no se gatea por módulo**: la
   * Agenda no es un módulo —la ven todos los que tienen sesión—, no pasa por
   * `contarSiTiene` y el conteo necesita el id de quien mira. Y por lo mismo
   * **no puede estar en la foto diaria**, que es global: ver `ES_POR_PERSONA`.
   *
   * Además de este aviso hay un push **en el momento** (`avisarDeLasDivergencias`,
   * en `lib/agenda/avisoDeDivergencia.ts`). Son dos avisos del mismo hecho y no se
   * pisan: el push es la interrupción, y esto es el stock que queda en la campana
   * hasta que se da por visto.
   *
   * **Acá había otros dos, y se retiraron el 05/11/2026**: `agenda-pasos-caidos`
   * y `agenda-salud-sin-comprobar`, que miraban si el cron de la Agenda seguía
   * hablando con Google. Lo que hacían para dos pasos lo hace ahora
   * `avisosDeSalud` para los 29 recursos de `ultima_sincronizacion`, con la
   * tolerancia declarada de cada uno. Dos avisos de salud con umbrales distintos
   * diciendo cosas parecidas es exactamente lo que la campana y el push evitan
   * al salir de una sola función.
   */
  { clave: "agendaDivergencias", id: "agenda-divergencias", titulo: "Eventos del calendario que alguien cambió desde Google", href: "/agenda" },
];

/**
 * Los avisos cuyo número **depende de quién mira** y que por lo tanto no caben en
 * la foto diaria (`avisos_fotos`), que es una sola para todo el sistema.
 *
 * El resumen diario compara cada aviso contra esa foto. Un aviso que no está en
 * la foto «subió desde cero», así que sin esta lista el de la Agenda saldría
 * todos los días como «3 más · Eventos del calendario…» con el total entero,
 * rotulado como incremento y repitiéndose hasta que alguien abra la Agenda: la
 * novedad falsa que el diseño del resumen existe para evitar. `loQueSeMovio` los
 * saltea, y quedan en la campana y en el resumen de los lunes, que lleva totales.
 *
 * **Lo que se pierde con esto**, dicho: la divergencia que se detecta fuera de la
 * ventana del aviso en el momento (de noche, o la que halla el barrido de las 2 de
 * la mañana) no la repesca el resumen de las 8:30 salvo los lunes —la campana sí la muestra
 * enseguida, porque el conteo se calcula en vivo por persona cada vez que alguien
 * abre el SdG; lo único que se atrasa es el push—. Hacerlo bien
 * pide una foto por persona en `avisos_fotos` (ids como `agenda-divergencias:<usuario>`)
 * y enseñarle al cron del resumen a leerla.
 */
export const ES_POR_PERSONA: ReadonlySet<string> = new Set(["agenda-divergencias"]);

export function avisosDeConteos(conteos: Partial<ConteosParaAvisos>): Notificacion[] {
  return AVISOS.flatMap(({ clave, id, titulo, href }) => {
    const cantidad = conteos[clave] ?? 0;
    return cantidad > 0 ? [{ id, titulo, cantidad, href }] : [];
  });
}

const NOMBRE: Record<Modulo, string> = {
  rrhh: "RRHH", mantenimiento: "Mantenimiento", remises: "Remises", compras: "Compras",
  inventario: "Inventario", produccion: "Producción", despacho: "Despacho",
  facturacion: "Facturación", cantera: "Cantera", calidad: "Calidad",
  taller_vial: "Taller Vial", trituracion: "Trituración", seguridad_higiene: "Seguridad e Higiene",
};

const HREF: Record<Modulo, string> = {
  rrhh: "/rrhh", mantenimiento: "/mantenimiento", remises: "/remises", compras: "/compras",
  inventario: "/inventario", produccion: "/produccion", despacho: "/despacho",
  facturacion: "/facturacion", cantera: "/cantera", calidad: "/calidad",
  taller_vial: "/taller-vial", trituracion: "/trituracion", seguridad_higiene: "/seguridad-higiene",
};

/**
 * Los avisos de ritmo que van al globo de la campana.
 *
 * En la tarjeta la señal aparece apenas se pasa el umbral; acá recién al
 * **doble**, para que Despacho con 5 días no haga ruido y Trituración con 36 sí.
 * Medido el 06/10/2026, entrarían siete: RRHH y Taller Vial justo en el borde,
 * Calidad por partida doble, Trituración, Remises y Producción.
 */
export function avisosDeRitmo(
  ritmo: Partial<Record<Modulo, Ritmo>>,
  modulos: Modulo[]
): Notificacion[] {
  return modulos.flatMap((m) => {
    const r = ritmo[m];
    if (!r || !r.atrasado) return [];
    if (r.diasSinCargar !== null && r.diasSinCargar < r.umbral * 2) return [];
    return [{
      id: `ritmo-${m}`,
      titulo: r.diasSinCargar === null
        ? `${NOMBRE[m]}: nunca se cargó nada`
        : `${NOMBRE[m]}: hace ${r.diasSinCargar} días que no se carga`,
      cantidad: cantidadDelAviso(r.diasSinCargar, r.umbral),
      href: HREF[m],
    }];
  });
}

// ── La salud de las sincronizaciones ────────────────────────────────────────

/** Donde aterriza todo aviso de salud: la pantalla con el estado de lo declarado. */
const HREF_DE_LA_SALUD = "/administracion/salud";

/*
 * `CRECE_CON_EL_DIA` —los avisos cuyo número es un reloj— vive en
 * `./notificaciones.ts` y no acá, porque lo necesitan **las tres** superficies:
 * el movimiento del push, el resumen y la campana, que es un componente de
 * cliente y no puede importar este archivo.
 */

/**
 * Lo más largo que entra del detalle en el título de un aviso.
 *
 * El título es lo único que llega al teléfono, y lo que no entra lo corta el
 * sistema operativo donde se le ocurre. 90 caracteres deja ver el nombre del
 * recurso y el principio de lo que dijo el otro lado, que es lo que permite
 * decidir si hay que levantarse; el texto entero, sin traducir, está en la
 * pantalla a un toque.
 */
const LARGO_DEL_DETALLE = 90;

/**
 * El detalle, en **una sola línea** y cortado por nosotros.
 *
 * Lo de una línea no es cosmético: `resumirParaPush` junta los títulos con
 * saltos de línea, así que un error de Google de tres renglones —y los hay— le
 * rompe el formato al resumen entero y descoloca a los demás avisos.
 */
function enUnaLinea(detalle: string): string {
  const plano = detalle.replace(/\s+/g, " ").trim();
  return plano.length > LARGO_DEL_DETALLE ? `${plano.slice(0, LARGO_DEL_DETALLE - 1)}…` : plano;
}

/**
 * Qué dice el título de un recurso caído, según de qué manera lo está.
 *
 * Va «no corre — hace 3 días» y no «no corre desde hace 3 días» porque el
 * detalle de un recurso viejo puede ser también «en una fecha ilegible», que es
 * lo que dice `haceCuantoCorto` de un `created_at` que no se entiende. Con
 * «desde» adelante, ese caso sale en un castellano roto.
 *
 * **Un fallo con racha dice cuántas corridas seguidas lleva**, que distingue
 * «se cayó recién» de «hace una semana que nadie lo mira» y es el dato que el
 * error solo no da. Con una sola no se escribe: «falló 1 corrida seguida» no
 * dice nada que «falló» no diga. La racha va en el título y **no en el
 * `detalle`**, que es el texto del otro lado sin traducir y tiene que seguir
 * siéndolo.
 */
function tituloDeLaCaida(caida: EntradaCaida): string {
  if (caida.estado === "nunca") return `${caida.titulo}: nunca corrió`;
  if (caida.estado === "vieja") return `${caida.titulo}: no corre — ${enUnaLinea(caida.detalle)}`;
  const racha = caida.cuantoLlevaMal > 1 ? ` ${caida.cuantoLlevaMal} corridas seguidas` : "";
  return `${caida.titulo}: falló${racha} — ${enUnaLinea(caida.detalle)}`;
}

/**
 * Los avisos de la salud de las sincronizaciones: **uno por recurso caído**.
 *
 * Tiene la forma de `avisosDeRitmo` —un productor **dinámico**— y no la de
 * `avisosDeConteos`, que mapea un record fijo: el `REGISTRO` declara hoy 30
 * recursos en 23 entradas, de las cuales **20 se vigilan** —una entrada puede
 * agrupar varios recursos, como el respaldo con sus ocho pestañas—, y la lista
 * crece sola cuando alguien declara una nueva.
 *
 * ── POR QUÉ UNO POR RECURSO Y NO UNO CON EL CONTEO ──────────────────────────
 *
 * Un solo aviso que dijera «3 sincronizaciones caídas» es la forma obvia y es la
 * que rompe el objetivo de todo esto. El mismo día se arregla
 * `calidad/carbonilla-odoo` y se rompe `agenda/canales`: el conteo queda en 1,
 * `filtrarDescartadas` compara `cantidad > cantidad_vista` y `loQueSeMovio`
 * reporta la diferencia, así que **no suena la campana ni sale el push** y el
 * fallo nuevo es invisible. Con los dos pasos de la Agenda eso era tolerable;
 * con 29 es el agujero que esto viene a cerrar, reabierto adentro del arreglo.
 * Por el mismo mecanismo, un fallo crónico descartado con `cantidad = 1`
 * silenciaba al siguiente.
 *
 * Un aviso por recurso le devuelve identidad al descarte —se silencia *ese*
 * problema y no «la salud»—, hace que un fallo nuevo sea siempre una novedad y
 * deja que el título diga cuál es. `resumirParaPush` ya sabe juntar varios en un
 * mensaje, así que el push no se multiplica.
 *
 * ── LAS TRES COSAS QUE HAY QUE SABER SI SE TOCA ─────────────────────────────
 *
 *  - **La `cantidad` no cuenta cosas**, y mide algo distinto según el estado:
 *    corridas fallidas seguidas en un `fallo`, tolerancias enteras de silencio
 *    en una `vieja` (ver `cuantoLlevaMal`). Las dos tienen el mismo trabajo:
 *    **crecer mientras el problema siga**, para que descartar el aviso no lo
 *    calle para siempre. **Una `nunca` es la excepción y no crece: vale 1
 *    fijo**, así que un descarte ahí dura mientras ese recurso no pase a `fallo`
 *    con racha de dos. Está así a propósito —el porqué, que es el id compartido
 *    `salud-${clave}`, está en `cuantoLlevaMal`— y es el borde conocido de este
 *    aviso. Por eso, además, el número no se imprime en ninguna superficie: ver
 *    `suNumeroSeMuestra` en `./notificaciones.ts`.
 *  - **Los ids son nuevos y no se reusan.** `agenda-pasos-caidos` y
 *    `agenda-salud-sin-comprobar` quedan huérfanos en `notificaciones_descartes`,
 *    lo cual es inofensivo porque nunca más coinciden con nada; reusar uno le
 *    entregaría a quien lo había descartado un aviso ya silenciado que nunca vio.
 *  - **`sinComprobar` es su propio aviso y no un cero.** «No sé» no es «todo
 *    bien» ni «algo cayó», y un aviso de salud que calla cuando no pudo mirar es
 *    el fallo silencioso que esto viene a cerrar.
 *
 * Le llegan sólo a `admin_sistema` (ver `sinLoQueNoPuedeAtender`): lo arregla
 * quien toca las credenciales y las variables de Vercel, no quien usa el módulo.
 */
export function avisosDeSalud(
  salud: SaludDelSistema,
  hoy: string = hoyEnArgentina()
): Notificacion[] {
  const avisos: Notificacion[] = salud.caidas.map((caida) => ({
    id: `salud-${caida.clave}`,
    titulo: tituloDeLaCaida(caida),
    cantidad: caida.cuantoLlevaMal,
    href: HREF_DE_LA_SALUD,
  }));

  /*
   * Los que la vista trae y el registro no nombra van **juntos y nombrados**:
   * la acción es una sola —declararlos en el `REGISTRO`— y el título los lista
   * porque su número no se imprime. Mientras no estén declarados nadie sabe qué
   * esperar de ellos, así que no se puede decir si están caídos: esto es «falta
   * fichar esto», no «esto se rompió», y por eso va después de las caídas.
   */
  if (salud.sinDeclarar.length > 0) {
    avisos.push({
      id: "salud-sin-declarar",
      titulo: `Sincronizaciones sin declarar en el registro: ${enUnaLinea(salud.sinDeclarar.join(", "))}`,
      cantidad: salud.sinDeclarar.length,
      href: HREF_DE_LA_SALUD,
    });
  }

  // El título dice que falló **la comprobación**, no que algo esté caído ni
  // sano. La cantidad es el día: ver `elDiaComoNumero`.
  if (salud.sinComprobar) {
    avisos.push({
      id: "salud-sin-comprobar",
      titulo: "No se pudo comprobar la salud de las sincronizaciones",
      cantidad: elDiaComoNumero(hoy),
      href: HREF_DE_LA_SALUD,
    });
  }

  return avisos;
}

/**
 * La `cantidad` de `salud-sin-comprobar`: **el día, y no un conteo de nada.**
 *
 * Es el aviso que avisa que **el vigilante quedó ciego**, así que es el peor de
 * todos para dejar descartable para siempre: con un número fijo, una lectura
 * fallida, un descarte, y una rotura posterior de `ultima_sincronizacion` no se
 * anuncia nunca más. Y no hay de dónde sacar una racha —no se guarda cuántas
 * veces seguidas falló la lectura, justamente porque lo que falló es la
 * lectura—.
 *
 * Entonces cuenta días: sube de a uno cada noche, así que **el descarte dura
 * exactamente una jornada** y dentro del día no se mueve por más veces que se
 * mire. Es la misma idea de `cantidadDelAviso` en `./ritmo.ts` —un número que
 * existe sólo para que `filtrarDescartadas` lo suelte y que no significa nada
 * para quien lo lee—, y por eso no se imprime (`sinNumero`) y queda afuera del
 * movimiento diario (`CRECE_CON_EL_DIA`).
 *
 * Son días desde la época, sobre la fecha de Argentina, que es la misma con la
 * que el cron decide si hoy ya mandó. Una fecha ilegible cae en 1, que es el
 * comportamiento viejo: sin saber qué día es, no se puede contar nada.
 */
function elDiaComoNumero(hoy: string): number {
  const ms = Date.parse(`${hoy}T00:00:00Z`);
  return Number.isNaN(ms) ? 1 : Math.floor(ms / 86_400_000);
}
