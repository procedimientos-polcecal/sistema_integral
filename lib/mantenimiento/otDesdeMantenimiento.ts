/**
 * La orden de trabajo que sale de un mantenimiento programado.
 *
 * ── LOS DOS ERRORES QUE ARREGLA, MEDIDOS EL 21/10/2026 ───────────────────────
 *
 * **1. Mandaba el nombre de una persona en un campo de vocabulario cerrado.**
 * El botón armaba `quien: nombreCompleto(s.assigned_user)`, pero `quien` vale
 * INTERNO, CONTRATADO o MIXTO —`QUIENES_DE_OT`; las 2.223 órdenes con ese campo
 * cargado usan las dos primeras—. Una OT con `quien = "Juan Pérez"` no la
 * encuentra nunca el filtro del listado, que es un `.in()` liso, y a la columna
 * G de la planilla le llega un nombre donde va una categoría. Es la misma clase
 * de error que las prioridades del 16/10: dos vocabularios para lo mismo.
 *
 * **2. Y además no generaba nada.** El único mantenimiento programado que
 * existe no tiene `assigned_to`, así que ese nombre salía vacío y
 * `loQueFaltaParaCrear` —obligatorio desde el 19/10/2026— contestaba «Falta
 * cargar quién lo realiza». Medido: 1 mantenimiento programado, 0 con
 * `assigned_to`, y **0 OT nacidas de un schedule en toda la historia**.
 *
 * Su `maintenance_type` es `"Lubricacion"` y viajaba crudo a `especialidad`,
 * donde el vocabulario es `ESPECIALIDADES`. O sea que aunque hubiera pasado,
 * esa OT tampoco se habría podido filtrar por especialidad: sin tilde y
 * capitalizado no es ninguna de las de la lista.
 *
 * ── CÓMO QUEDÓ, Y POR QUÉ ASÍ ────────────────────────────────────────────────
 *
 * `quien` es **INTERNO** porque un mantenimiento programado lo hace personal
 * propio, y la persona asignada va a **`operario_1`**, que es el campo que
 * existe para nombrar gente. Viene puesto y se puede cambiar a CONTRATADO: hay
 * preventivos que se tercerizan —una certificación anual— y fijarlo obligaría a
 * cargar ésos desde otra pantalla.
 *
 * Lo que cuesta, dicho: `loQueHayQueExportar` manda `operario_1` a la columna P
 * del master, que allá significa «quién lo hizo» y no «quién lo tiene
 * asignado». En una OT que nace POR_HACER eso se lee como que esa persona ya la
 * hizo. Se acepta a pedido, el 21/10/2026: es el único campo donde el nombre
 * cabe, y quien cierre la orden lo confirma o lo corrige.
 *
 * ── Y EL PATRÓN, QUE ES LO ÚNICO QUE IMPIDE QUE VUELVA ───────────────────────
 *
 * El formulario **no tiene su propia lista de campos**. Arma el cuerpo acá, con
 * lo que el mantenimiento ya sabe, y pregunta por lo que nombre
 * `loQueFaltaParaCrear` —la misma función que corre el servidor—. Si mañana la
 * regla exige un campo más, el formulario lo pide solo. Es el mismo patrón que
 * `otDesdeAviso.ts`, escrito el mismo día por el mismo motivo: las dos mitades
 * estaban en archivos distintos y ninguna sabía de la otra.
 */

import { loQueFaltaParaCrear, type DatosDelAltaDeOT } from "@/lib/mantenimiento/altaDeOT";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";
import { norm } from "@/lib/core/texto";

/**
 * Los tipos de tarea que ofrece el formulario de mantenimientos programados.
 *
 * Vive acá y no en la pantalla porque `especialidadDeTipo` tiene que traducirlo
 * y la descripción de la OT tiene que nombrarlo: tres lugares leyendo la misma
 * lista, y una copia en un `.tsx` es cómo se agrega un tipo que la traducción no
 * conoce.
 *
 * **No es `ESPECIALIDADES`**, y por eso hace falta traducir: esto dice qué
 * tarea es y aquello de qué oficio es. Una inspección puede ser mecánica o
 * eléctrica.
 */
export const TIPOS_DE_MANTENIMIENTO = [
  { value: "Lubricacion",        label: "Lubricación" },
  { value: "Inspeccion",         label: "Inspección" },
  { value: "Limpieza",           label: "Limpieza" },
  { value: "Ajuste",             label: "Ajuste" },
  { value: "Reemplazo",          label: "Reemplazo" },
  { value: "Revision_electrica", label: "Revisión eléctrica" },
  { value: "Otro",               label: "Otro" },
] as const;

/** Cómo se nombra un tipo en pantalla. Lo crudo lleva guión bajo y no lleva tilde. */
export function etiquetaDeTipo(tipo: string | null | undefined): string {
  const crudo = String(tipo ?? "").trim();
  if (!crudo) return "";
  return TIPOS_DE_MANTENIMIENTO.find((t) => t.value === crudo)?.label ?? crudo;
}

/**
 * Comparar tipos: lo de `norm` más el guión bajo.
 *
 * `norm` saca tildes, mayúsculas y espacios de más, pero no toca el `_` con el
 * que la base escribe `Revision_electrica`. Sin esto, ese tipo no se parece a
 * nada.
 */
const comoSeCompara = (v: unknown) => norm(String(v ?? "").replace(/_/g, " "));

/**
 * Los tipos cuyo oficio se sabe con certeza aunque se llamen distinto.
 *
 * Es una tabla corta a propósito: **sólo entra lo que no admite discusión**.
 * Una revisión eléctrica es trabajo eléctrico y no hay otra lectura. Una
 * inspección, una limpieza, un ajuste o un reemplazo pueden ser de cualquier
 * oficio, así que no están acá y quedan sin enlazar — ver abajo.
 */
const ESPECIALIDAD_CIERTA: Readonly<Record<string, (typeof ESPECIALIDADES)[number]>> = {
  "REVISION ELECTRICA": "ELÉCTRICO",
};

/**
 * El tipo que **se llama igual que una especialidad y aun así no la prueba**.
 *
 * El 21/10/2026 `ESPECIALIDADES` sumó OTRO, y con eso el tipo de tarea "Otro"
 * pasó a coincidir por nombre con la especialidad "OTRO" — una traducción
 * automática que no dice nada: que la tarea esté sin clasificar no prueba que el
 * oficio esté sin clasificar. Si se dejara pasar, el formulario nunca más
 * preguntaría de qué oficio es un trabajo marcado "Otro", que es exactamente el
 * caso donde más hace falta preguntarlo.
 *
 * Está como lista y no como un `if` porque el problema es de forma, no de este
 * valor: cualquier futuro tipo «cajón de sastre» que se llame igual que una
 * especialidad cae en la misma trampa.
 */
const NO_PRUEBAN_NADA: readonly string[] = ["OTRO"];

/**
 * De qué especialidad es un tipo de mantenimiento, o `""` si no se sabe.
 *
 * Dos caminos, los dos ciertos: que el tipo **sea** una especialidad escrita de
 * otra forma —`"Lubricacion"` es `"LUBRICACIÓN"` sin la tilde, y así está hoy
 * el único mantenimiento que existe— o que esté en la tabla de arriba.
 *
 * Todo lo demás devuelve `""`, y eso es la decisión y no una omisión:
 * **enlazar al que se le parece es peor que dejar en null**. Un "Ajuste"
 * mandado como MECÁNICO porque la mayoría de los ajustes lo son deja la OT en
 * el filtro equivocado, y eso no se nota nunca — el dato aparece en el lugar
 * que no es. Sin enlazar, en cambio, la pantalla lo pregunta y alguien lo
 * elige.
 */
export function especialidadDeTipo(tipo: string | null | undefined): string {
  const t = comoSeCompara(tipo);
  if (!t || NO_PRUEBAN_NADA.includes(t)) return "";

  const igual = ESPECIALIDADES.find((e) => norm(e) === t);
  if (igual) return igual;

  return ESPECIALIDAD_CIERTA[t] ?? "";
}

/** Lo que de un mantenimiento programado hace falta para armar la orden. */
export interface MantenimientoParaLaOT {
  id: string;
  equipment_id: string | null;
  maintenance_type: string | null;
  description: string | null;
  next_date: string | null;
  estimated_hours: number | string | null;
  equipos: {
    code: string | null;
    name: string | null;
    sector_id: string | null;
    sectores: { nombre: string | null } | null;
  } | null;
  assigned_user: { nombre?: string | null; apellido?: string | null } | null;
}

/** Lo que el mantenimiento no contesta solo y confirma una persona. */
export interface RespuestasDelMantenimiento {
  especialidad: string;
  quien: string;
  fecha_ejecucion: string;
}

export const RESPUESTAS_VACIAS: RespuestasDelMantenimiento = {
  especialidad: "", quien: "", fecha_ejecucion: "",
};

/** El nombre de la persona asignada, o `""`. Sin el "—" de la pantalla. */
export function nombreDelAsignado(m: MantenimientoParaLaOT): string {
  const u = m.assigned_user;
  if (!u) return "";
  return `${u.nombre ?? ""} ${u.apellido ?? ""}`.trim();
}

/**
 * Con qué llega el formulario antes de que nadie toque nada.
 *
 * Las tres se muestran y se pueden cambiar. Que se vean es la diferencia entre
 * un dato heredado y uno inventado: una especialidad puesta sin que se vea
 * sería exactamente el enlace por parecido que `especialidadDeTipo` evita.
 */
export function respuestasIniciales(m: MantenimientoParaLaOT): RespuestasDelMantenimiento {
  return {
    // Vacía cuando el tipo no se reconoce. La pantalla avisa por qué.
    especialidad: especialidadDeTipo(m.maintenance_type),
    // El trabajo lo hace nuestra gente salvo que se diga otra cosa: 1.677 de
    // las 2.223 órdenes con `quien` cargado son INTERNO, y un preventivo
    // programado más todavía.
    quien: "INTERNO",
    // La que el mantenimiento ya tiene puesta. Puede estar en el pasado —la de
    // hoy vence el 08/08/2026— y se ve, así que se corrige antes de generar.
    fecha_ejecucion: String(m.next_date ?? ""),
  };
}

/**
 * El cuerpo que se le manda a `POST /api/mantenimiento/ordenes`.
 *
 * **PROGRAMADO siempre**: esto nace de un preventivo con fecha, no de una falla
 * que alguien reportó. Y sin prioridad, que es lo que hacía antes: un
 * mantenimiento programado no tiene urgencia de donde sacarla, y ponerle
 * "MEDIA" sería inventar el dato del que después sale el orden del tablero.
 */
export function cuerpoDeLaOT(
  m: MantenimientoParaLaOT,
  respuestas: RespuestasDelMantenimiento
): Record<string, unknown> & DatosDelAltaDeOT {
  const eq = m.equipos;
  const asignado = nombreDelAsignado(m);

  return {
    schedule_id: m.id,
    equipment_id: m.equipment_id,
    sector_id: eq?.sector_id ?? null,
    sector_raw: eq?.sectores?.nombre ?? null,
    equipo_raw: eq ? `${eq.code ?? ""} — ${eq.name ?? ""}`.trim() : null,
    equipo_code: eq?.code ?? null,
    descripcion:
      m.description?.trim() ||
      `${etiquetaDeTipo(m.maintenance_type)} — ${eq?.name ?? ""}`.trim(),
    tipo: "PROGRAMADO",
    estado: "POR_HACER",

    especialidad: respuestas.especialidad,
    quien: respuestas.quien,
    fecha_ejecucion: respuestas.fecha_ejecucion,

    /**
     * Las horas **estimadas** del mantenimiento, que la planilla recibe en su
     * columna O de horas **trabajadas**. Son dos cosas distintas y se deja así
     * a pedido, el 21/10/2026: la estimación arranca ahí y quien cierre la
     * orden la corrige. Hoy no muerde porque el único mantenimiento que existe
     * la tiene vacía.
     *
     * Va como texto porque eso es lo que la regla compartida compara; la ruta
     * hace `horas ? Number(horas) : null`.
     */
    horas: m.estimated_hours === null || m.estimated_hours === undefined
      ? ""
      : String(m.estimated_hours),

    /**
     * La persona asignada, **salvo que el trabajo esté contratado**: nombrar a
     * alguien de la casa como operario de un trabajo que hace un tercero es
     * dejar la orden diciendo dos cosas.
     */
    operario_1: respuestas.quien.trim().toUpperCase() === "CONTRATADO" ? "" : asignado,

    // Se está pidiendo trabajo, no cargando trabajo hecho. Van explícitos para
    // que `loQueFaltaParaCrear` vea lo mismo acá que en el servidor.
    fecha_cierre: "",
    contratista: "",
    operario_2: "",
    operario_3: "",
  };
}

/**
 * Qué le falta a la orden, con las respuestas que haya hasta ahora.
 *
 * Delega en la regla compartida. **No hay una lista de campos acá**: ése es el
 * punto de todo el archivo.
 */
export function loQueFaltaDelMantenimiento(
  m: MantenimientoParaLaOT,
  respuestas: RespuestasDelMantenimiento
): string[] {
  return loQueFaltaParaCrear(cuerpoDeLaOT(m, respuestas));
}

/**
 * Lo que el mantenimiento **no puede** contestar por su cuenta.
 *
 * Es lo mismo de arriba con las respuestas vacías: lo que quede nombrado es lo
 * que el formulario tiene que dibujar. Así, el día que la regla cambie, el
 * formulario cambia con ella sin que nadie se acuerde.
 */
export function loQueHayQuePreguntar(m: MantenimientoParaLaOT): string[] {
  return loQueFaltaDelMantenimiento(m, RESPUESTAS_VACIAS);
}

/**
 * Lo que falta y **el formulario no puede arreglar**: el sector y el equipo.
 *
 * Un mantenimiento programado siempre tiene equipo —es obligatorio al cargarlo—
 * pero su equipo puede no tener sector, y una OT sin sector no suma a las horas
 * de nadie. Se arregla en el equipo, no acá: ponerle un desplegable de sectores
 * a esta pantalla dejaría la OT diciendo una cosa y la ficha del equipo otra.
 */
export function loQueNoSeArreglaAca(m: MantenimientoParaLaOT): string[] {
  const falta: string[] = [];
  if (!String(m.equipos?.sector_id ?? "").trim()) falta.push("el sector");
  if (!String(m.equipment_id ?? "").trim()) falta.push("el equipo");
  return falta;
}
