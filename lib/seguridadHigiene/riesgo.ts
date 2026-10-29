/**
 * El riesgo de una condición insegura: cómo se clasifica un nivel y qué dice
 * cada opción de los cinco criterios.
 *
 * **Los umbrales salen de la única fila del Excel de origen que tenía la
 * fórmula sana.** Las demás decían `IF(151>=49,"M",…)`: una constante donde iba
 * el nivel, así que nada podía salir PS ni NS y nadie lo notó en 44 filas. Los
 * cortes (139 / 90 / 49 / 18) son los de esa fila, comparados contra el nivel
 * de verdad.
 *
 * **Esta función es para la pantalla.** El nivel lo calculan columnas generadas
 * en Postgres, y la ruta de alta no pasa por acá: así un cambio de umbral no
 * puede dejar dos respuestas distintas, una en la base y otra en la ruta.
 */

export type Clasificacion = "I" | "S" | "M" | "PS" | "NS";

/**
 * Un nivel 0 no clasifica y devuelve `null`, igual que la falta de nivel: el
 * corte de NS es `> 0`, y 0 no es mayor que 0. Un 0 sólo puede salir de una
 * evaluación que no está, y llamarlo "NS" (no significativo) diría que alguien
 * evaluó algo y concluyó que no importa.
 */
export function clasificar(nivel: number | null): Clasificacion | null {
  if (nivel === null) return null;
  if (nivel >= 139) return "I";
  if (nivel >= 90) return "S";
  if (nivel >= 49) return "M";
  if (nivel >= 18) return "PS";
  if (nivel > 0) return "NS";
  return null;
}

export type Criterio =
  | "frecuencia"
  | "antecedentes"
  | "controles"
  | "magnitud_dano"
  | "legislacion";

/**
 * Las opciones de cada criterio, de mayor a menor puntaje, con el texto de la
 * planilla **tal cual**.
 *
 * El texto no es decoración: es lo que hace que dos personas que miran la misma
 * condición le pongan un puntaje parecido. Por eso no se resume ni se reescribe
 * —incluso donde la redacción es torpe—, y por eso vive en una constante y no
 * en la pantalla: la cargan el formulario de alta y la edición de la condición.
 *
 * Frecuencia y antecedentes son probabilidad junto con los controles; magnitud
 * del daño y legislación son gravedad.
 */
export const CRITERIOS: Record<Criterio, { puntos: number; texto: string }[]> = {
  frecuencia: [
    { puntos: 3, texto: "Diaria. Muy frecuente" },
    { puntos: 2, texto: "Media. Su frecuencia es mayor a un día pero no alcanza el mes" },
    { puntos: 1, texto: "Mensual o mayor. El peligro se repite esporádicamente" },
  ],
  antecedentes: [
    {
      puntos: 3,
      texto:
        "Reiterados antecedentes de accidentes, enfermedades y/o fallas. Antecedente de accidentes mortales o de incapacidad permanente",
    },
    {
      puntos: 2,
      texto:
        "Se conocen antecedentes. Incidentes que casi desencadenaron el accidente y/o fallas, durante el último año calendario",
    },
    { puntos: 1, texto: "No se conocen antecedentes" },
  ],
  // Cada opción pide "al menos uno de" los ítems de su renglón.
  controles: [
    {
      puntos: 5,
      texto: "Equipos especiales o EPP específicos · Capacitación específica para poder realizar la tarea",
    },
    {
      puntos: 3,
      texto:
        "Requiere instructivo · Permisos de trabajo · EPP básicos (casco, calzado, lentes y/o protectores auditivos) · Equipos no especiales",
    },
    {
      puntos: 1,
      texto:
        "Capacitación básica de SH&MA · No requiere procedimientos ni permisos de trabajo · No se requiere EPP para realizar la tarea",
    },
  ],
  magnitud_dano: [
    {
      puntos: 9,
      texto:
        "Puede producir muerte, amputaciones, lesiones invalidantes o múltiples, envenenamientos, enfermedades ocupacionales permanentes, fracturas mayores; daños que provocan parada o interrupción del servicio, o con costo de reparación elevado, o que comprometen la estructura y la funcionalidad de las instalaciones; alta o media tensión",
    },
    {
      puntos: 7,
      texto:
        "Puede producir quemaduras localizadas, laceraciones, fracturas menores o lesiones musculares, dermatitis, lesiones a la vista, problemas auditivos o respiratorios; daños parciales con costo accesible, que no interrumpen la actividad y no comprometen la estructura pero sí la funcionalidad; baja tensión",
    },
    {
      puntos: 3,
      texto:
        "Riesgos fácilmente solucionados, sin acción severa sobre la salud: lesiones superficiales, cortes o contusiones menores, irritación, afecciones temporarias; daños materiales menores con costo bajo, sin comprometer estructura ni funcionalidad; sin tensión",
    },
  ],
  legislacion: [
    { puntos: 5, texto: "El peligro está regulado por legislación aplicable específica" },
    { puntos: 3, texto: "El peligro está regulado pero no es de aplicación directa" },
    { puntos: 1, texto: "El peligro no está regulado por ningún requisito legal aplicable" },
  ],
};
