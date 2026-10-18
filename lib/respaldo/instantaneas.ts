import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import {
  desdeHace, fecha, hora, nombreDe, numero, quien, si, uno, type Persona,
} from "./celdas";

/**
 * Qué se copia al libro de respaldo, y por qué justamente esto.
 *
 * ── POR QUÉ EXISTE ESTE ARCHIVO ──────────────────────────────────────────
 *
 * El sistema ya tiene dos respaldos: el de Supabase y el dump cifrado que sube
 * a Drive todas las noches. Los dos sirven para *restaurar*, y ninguno sirve
 * para *seguir trabajando el martes a la mañana* si el lunes se cayó todo: son
 * SQL, los abre un técnico, no el que tiene que liquidar sueldos.
 *
 * Y la otra mitad del sistema ya tiene esa clase de respaldo sin que nadie lo
 * haya pedido: Compras, Mantenimiento, Inventario y las dos mitades de Calidad
 * con planilla espejan libros de Sheets donde **manda la planilla**. Si el SdG
 * desaparece, esos cuatro módulos siguen enteros en Google, que es de donde
 * leen hoy los que no entran al sistema.
 *
 * Lo que queda sin red son los módulos que **no tienen planilla ninguna**:
 * RRHH, Remises, los ensayos del laboratorio y el buzón de Facturación. Ahí el
 * SdG es el único lugar donde existe el dato. Eso es lo que copia este archivo.
 *
 * ── LA REGLA QUE NO SE PUEDE ROMPER ──────────────────────────────────────
 *
 * **Este libro es de una sola dirección y el SdG no lo lee nunca.** No es un
 * espejo: es una fotocopia. Nada de lo que alguien escriba acá vuelve al
 * sistema, y por eso cada pestaña se reescribe entera cada noche sin mirar qué
 * había.
 *
 * Esa distinción es la que hace que esto sea seguro, y lo contrario sería
 * destructivo. Las planillas donde **manda la planilla** no se tocan desde acá
 * bajo ningún concepto: desde el 18/10/2026 su sincronización **borra** las
 * filas que la planilla dejó de tener. Escribirles encima el estado del
 * sistema no sería un respaldo, sería darle de comer al importador su propia
 * salida — y una fila que el respaldo no alcanzó a copiar se leería como una
 * fila que alguien borró a mano. Por eso el libro es **aparte**, y por eso su
 * id va en su propia variable de entorno y no se reusa ninguno de los que ya
 * están configurados.
 *
 * ── LO QUE NO VA, A PROPÓSITO ────────────────────────────────────────────
 *
 * **El valor hora no se copia.** Vive en `rrhh_empleados_datos`, cerrado con
 * `tiene_acceso_rrhh()`, justamente porque `empleados` tiene la lectura abierta
 * a cualquier autenticado y RLS no sabe tapar una columna sola. Una planilla de
 * Drive no tiene RLS: cualquiera con el link la lee entera. Copiar el valor
 * hora acá desarmaría en una línea la separación que costó una migración.
 *
 * Lo mismo con el domicilio de `remises_empleados_datos`: es dato personal y no
 * hace falta para seguir operando.
 */

/** Cuántos días hacia atrás copian las instantáneas que son una serie de tiempo.
 *
 * 60 cubre el mes que se liquida y el anterior entero, que es lo que alguien
 * necesitaría tener a mano para cerrar sueldos a mano si el sistema no está.
 * Más atrás que eso ya es trabajo de restaurar el dump, no de seguir operando. */
export const DIAS_DE_VENTANA = 60;

/** Lo que Remises copia hacia atrás: su carga es semanal y mucho más rala que
 * la de RRHH, así que una ventana de dos meses puede devolver cero filas y
 * parecer un error. Un año entero son pocas filas igual. */
export const DIAS_DE_VENTANA_REMISES = 365;

export interface Instantanea {
  /** Nombre de la pestaña en el libro de respaldo. */
  pestana: string;
  /** Qué es, en una línea: va en la fila 1, arriba del encabezado. */
  descripcion: string;
  encabezados: string[];
  filas(admin: SupabaseClient, hoy: string): Promise<(string | number)[][]>;
}

/*
 * Todo lo que se lee pasa por `traerTodo`. No es precaución de más: la
 * instantánea de asistencia son 4.241 filas en 60 días, y PostgREST corta en
 * 1.000 sin avisar. Un respaldo truncado en silencio es la peor clase de
 * respaldo que hay — parece completo hasta el día que hace falta.
 */

export const INSTANTANEAS: Instantanea[] = [
  {
    pestana: "RRHH - Padron",
    descripcion:
      "Los empleados activos. Es el dato que no existe en ningún otro lado: sin esto no se sabe ni quién trabaja acá. NO lleva valor hora, a propósito.",
    encabezados: [
      "Legajo", "Apellido", "Nombre", "Empresa", "Sector",
      "Ingreso", "Modalidad", "Horas teoricas",
    ],
    async filas(admin) {
      const datos = await traerTodo<Record<string, unknown>>((desde, hasta) =>
        admin
          .from("empleados")
          .select(
            "legajo, apellido, nombre, fecha_ingreso, modalidad_pago, horas_teoricas_diarias, empresas(nombre), sectores(nombre)"
          )
          .eq("activo", true)
          .order("legajo", { ascending: true })
          .range(desde, hasta)
      );
      return datos.map((e) => [
        String(e.legajo ?? ""),
        String(e.apellido ?? ""),
        String(e.nombre ?? ""),
        nombreDe(e.empresas),
        nombreDe(e.sectores),
        fecha(e.fecha_ingreso as string),
        String(e.modalidad_pago ?? ""),
        numero(e.horas_teoricas_diarias),
      ]);
    },
  },

  {
    pestana: "RRHH - Asistencia",
    descripcion:
      `El cálculo diario de los últimos ${DIAS_DE_VENTANA} días: horas, extras y ausencias ya resueltas. Es lo que haría falta para liquidar a mano.`,
    encabezados: [
      "Fecha", "Legajo", "Empleado", "Tipo de dia", "Horas normales",
      "Extra 50", "Extra 100", "Ausente", "Tipo de ausencia", "Justificada",
      "Tarde", "Retiro anticipado", "Observaciones",
    ],
    async filas(admin, hoy) {
      const desdeIso = desdeHace(hoy, DIAS_DE_VENTANA);
      const datos = await traerTodo<Record<string, unknown>>((desde, hasta) =>
        admin
          .from("calculos_diarios")
          .select(
            "fecha, tipo_dia, horas_normales, horas_extra_50, horas_extra_100, ausente, tipo_ausencia, justificada, tarde, retiro_anticipado, observaciones, empleados(legajo, apellido, nombre)"
          )
          .gte("fecha", desdeIso)
          .lte("fecha", hoy)
          // Por fecha y después por id: `.range()` sin un orden estable puede
          // repetir y saltear filas entre páginas, y eso en un respaldo no se
          // nota nunca.
          .order("fecha", { ascending: true })
          .order("id", { ascending: true })
          .range(desde, hasta)
      );
      return datos.map((c) => [
        fecha(c.fecha as string),
        uno<Persona>(c.empleados)?.legajo ?? "",
        quien(c.empleados),
        String(c.tipo_dia ?? ""),
        numero(c.horas_normales),
        numero(c.horas_extra_50),
        numero(c.horas_extra_100),
        si(c.ausente),
        String(c.tipo_ausencia ?? ""),
        si(c.justificada),
        si(c.tarde),
        si(c.retiro_anticipado),
        String(c.observaciones ?? ""),
      ]);
    },
  },

  {
    pestana: "RRHH - Marcaciones",
    descripcion:
      `Las fichadas crudas de los últimos ${DIAS_DE_VENTANA} días, como entraron del reloj. Van además del cálculo porque son el insumo: con esto se puede rehacer la cuenta, con el cálculo solo hay que creerle.`,
    encabezados: ["Fecha", "Legajo", "Empleado", "Entrada", "Salida", "Origen", "Observaciones"],
    async filas(admin, hoy) {
      const desdeIso = desdeHace(hoy, DIAS_DE_VENTANA);
      const datos = await traerTodo<Record<string, unknown>>((desde, hasta) =>
        admin
          .from("fichadas")
          .select("fecha, hora_entrada, hora_salida, origen, observaciones, empleados(legajo, apellido, nombre)")
          .gte("fecha", desdeIso)
          .lte("fecha", hoy)
          .order("fecha", { ascending: true })
          .order("id", { ascending: true })
          .range(desde, hasta)
      );
      return datos.map((f) => [
        fecha(f.fecha as string),
        uno<Persona>(f.empleados)?.legajo ?? "",
        quien(f.empleados),
        hora(f.hora_entrada as string),
        hora(f.hora_salida as string),
        String(f.origen ?? ""),
        String(f.observaciones ?? ""),
      ]);
    },
  },

  {
    pestana: "Remises - Plan",
    descripcion:
      "Quién viaja en qué turno. Remises no tiene planilla propia: si el SdG no está, esto no existe en ningún lado.",
    encabezados: ["Fecha", "Legajo", "Empleado", "Turno", "Tipo"],
    async filas(admin, hoy) {
      const desdeIso = desdeHace(hoy, DIAS_DE_VENTANA_REMISES);
      const datos = await traerTodo<Record<string, unknown>>((desde, hasta) =>
        admin
          .from("remises_plan_semana")
          .select("fecha, tipo, empleados(legajo, apellido, nombre), remises_turnos(nombre)")
          .gte("fecha", desdeIso)
          .order("fecha", { ascending: true })
          .order("empleado_id", { ascending: true })
          .range(desde, hasta)
      );
      return datos.map((p) => [
        fecha(p.fecha as string),
        uno<Persona>(p.empleados)?.legajo ?? "",
        quien(p.empleados),
        nombreDe(p.remises_turnos),
        String(p.tipo ?? ""),
      ]);
    },
  },

  {
    pestana: "Remises - Asistencia",
    descripcion: "Quién viajó de verdad, contra el plan de la pestaña anterior.",
    encabezados: ["Fecha", "Legajo", "Empleado", "Turno"],
    async filas(admin, hoy) {
      const desdeIso = desdeHace(hoy, DIAS_DE_VENTANA_REMISES);
      const datos = await traerTodo<Record<string, unknown>>((desde, hasta) =>
        admin
          .from("remises_asistencia")
          .select("fecha, empleados(legajo, apellido, nombre), remises_turnos(nombre)")
          .gte("fecha", desdeIso)
          .order("fecha", { ascending: true })
          .order("empleado_id", { ascending: true })
          .range(desde, hasta)
      );
      return datos.map((a) => [
        fecha(a.fecha as string),
        uno<Persona>(a.empleados)?.legajo ?? "",
        quien(a.empleados),
        nombreDe(a.remises_turnos),
      ]);
    },
  },

  {
    pestana: "Calidad - Ensayos",
    descripcion:
      "Las muestras del laboratorio, enteras. Es el único de los tres frentes de Calidad que no tiene planilla: acá el SdG es el único lugar.",
    encabezados: [
      "Fecha", "Producto",
      "Humedad p. recipiente", "Humedad p. inicial", "Humedad p. final",
      "Peso vol. gramos", "Peso vol. volumen cc",
      "Cal util ml acido", "Cal util peso muestra g",
      "Granulometria peso muestra g", "Observaciones",
    ],
    async filas(admin) {
      // Sin ventana: son 27 filas en total. Un respaldo parcial del único lugar
      // donde vive un dato no tiene sentido.
      const datos = await traerTodo<Record<string, unknown>>((desde, hasta) =>
        admin
          .from("calidad_ensayos_muestras")
          .select(
            "fecha, observaciones, humedad_p_recipiente, humedad_p_inicial, humedad_p_final, peso_vol_gramos, peso_vol_volumen_cc, cal_util_ml_acido, cal_util_peso_muestra_g, granulometria_peso_muestra_g, calidad_ensayos_productos(nombre)"
          )
          .order("fecha", { ascending: true })
          .order("id", { ascending: true })
          .range(desde, hasta)
      );
      return datos.map((m) => [
        fecha(m.fecha as string),
        nombreDe(m.calidad_ensayos_productos),
        numero(m.humedad_p_recipiente),
        numero(m.humedad_p_inicial),
        numero(m.humedad_p_final),
        numero(m.peso_vol_gramos),
        numero(m.peso_vol_volumen_cc),
        numero(m.cal_util_ml_acido),
        numero(m.cal_util_peso_muestra_g),
        numero(m.granulometria_peso_muestra_g),
        String(m.observaciones ?? ""),
      ]);
    },
  },

  {
    pestana: "Facturacion - Buzon",
    descripcion:
      "Qué entró por el buzón y en qué estado quedó. El PDF no se copia —vive en Storage—: lo que se respalda es el índice, que es lo que permite saber qué falta.",
    encabezados: ["Recibido", "Remitente", "Asunto", "Tipo", "Estado", "Motivo", "Archivo"],
    async filas(admin) {
      const datos = await traerTodo<Record<string, unknown>>((desde, hasta) =>
        admin
          .from("facturacion_correo")
          .select("recibido_en, remitente, asunto, tipo, estado, motivo, archivo_url")
          .order("recibido_en", { ascending: false })
          .order("id", { ascending: true })
          .range(desde, hasta)
      );
      return datos.map((c) => [
        // `recibido_en` es un timestamp con zona, no una fecha: se corta el día
        // para el serial y la hora queda en el mismo texto del remitente si
        // hiciera falta. Acá alcanza con el día.
        fecha(String(c.recibido_en ?? "").slice(0, 10)),
        String(c.remitente ?? ""),
        String(c.asunto ?? ""),
        String(c.tipo ?? ""),
        String(c.estado ?? ""),
        String(c.motivo ?? ""),
        String(c.archivo_url ?? ""),
      ]);
    },
  },
];

/** El día de hoy en Argentina, que es el que acota las ventanas.
 *
 * No `new Date().toISOString()`: el respaldo corre a la medianoche argentina,
 * que en UTC ya es el día siguiente. Tomar el día de UTC haría que la ventana
 * terminara en un día que todavía no empezó acá. */
export function hoyParaElRespaldo(): string {
  return hoyEnArgentina();
}
