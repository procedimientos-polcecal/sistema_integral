import { z } from "zod";
import { cuitEsValido, normalizarCuit } from "@/lib/core/cuit";
import { CLAVES_DE_ETAPA } from "./etapas";

/**
 * Lo que aceptan los cuerpos de las rutas del CRM.
 *
 * Los mensajes van en castellano y los arma `validar()` de `lib/core/validar.ts`,
 * que informa **todos** los problemas juntos y no de a uno.
 *
 * ── LOS ESQUEMAS DE CORRECCIÓN SON `.partial()` DEL DE ALTA ──
 *
 * Un PATCH manda sólo lo que cambió, así que exigir los obligatorios del alta
 * obligaría a reenviar la razón social para corregir un teléfono. Que sean el
 * mismo esquema con `.partial()` y no uno escrito aparte es lo que impide que
 * el PATCH acepte un valor que el POST rechaza: ya pasó en este repo que dos
 * copias de una validación se separaran, y la que se olvida de cambiar es la
 * que queda abierta.
 *
 * ── LO QUE NO SE VALIDA ACÁ, Y DÓNDE SE VALIDA ──────────────
 *
 * Tres reglas no entran en un esquema de un solo campo y viven en funciones
 * abajo o en la ruta:
 *
 *   * **El CUIT** se normaliza (`normalizarCuit`) y se avisa si el dígito
 *     verificador no cierra, pero **no se rechaza**: los CUITs los carga gente
 *     a mano y descartarlo en silencio es cómo el dato desaparece sin que nadie
 *     se entere. Mismo criterio que `cuitEsValido` del núcleo.
 *   * **Pasar de etapa** depende de la etapa que tenía antes, que la ruta lee
 *     de la base (`sePuedePasarDe`).
 *   * **El motivo al perder** es una regla sobre dos campos: `problemaDelCierre`.
 */

/** Un texto con algo escrito. El `refine` trae su mensaje, que `validar()` respeta. */
const textoNoVacio = (mensaje: string) =>
  z.string().trim().refine((t) => t.length > 0, mensaje);

/**
 * Un campo de texto opcional que, si viene vacío, se guarda como null.
 *
 * Es lo que hace que borrar el contenido de un campo en la pantalla lo deje
 * vacío de verdad y no en `""`. Un `""` y un null se ven igual en la ficha y se
 * comportan distinto en un filtro, que es la clase de diferencia que después
 * nadie entiende.
 */
const textoOpcional = z
  .string()
  .trim()
  .transform((t) => (t.length > 0 ? t : null))
  .nullish();

// ── Clientes ────────────────────────────────────────────────

export const esquemaDeCliente = z.object({
  razon_social: textoNoVacio("Falta la razón social"),
  nombre_fantasia: textoOpcional,
  cuit: textoOpcional,
  estado: z.literal(["prospecto", "activo", "inactivo"]).optional(),
  vendedor_id: z.guid().nullish(),
  localidad: textoOpcional,
  provincia: textoOpcional,
  rubro: textoOpcional,
  telefono: textoOpcional,
  email: z.union([z.email("El correo no parece un correo"), z.literal("")]).nullish(),
  sitio_web: textoOpcional,
  origen: textoOpcional,
  notas: textoOpcional,
});

export const esquemaDeClienteParcial = esquemaDeCliente.partial();

export type CuerpoDeCliente = z.infer<typeof esquemaDeCliente>;

// ── Contactos ───────────────────────────────────────────────

export const esquemaDeContacto = z.object({
  cliente_id: z.guid(),
  nombre: textoNoVacio("Falta el nombre del contacto"),
  cargo: textoOpcional,
  telefono: textoOpcional,
  email: z.union([z.email("El correo no parece un correo"), z.literal("")]).nullish(),
  es_principal: z.boolean().optional(),
  activo: z.boolean().optional(),
  notas: textoOpcional,
});

/** `cliente_id` no se corrige: un contacto no se muda de empresa, se carga de nuevo. */
export const esquemaDeContactoParcial = esquemaDeContacto.omit({ cliente_id: true }).partial();

// ── Oportunidades ───────────────────────────────────────────

/**
 * Un número que no puede ser negativo.
 *
 * Toneladas y montos negativos no existen acá —no hay devoluciones en una
 * oportunidad— y dejarlos pasar daría un embudo que se achica cuando alguien
 * se equivoca de signo, que es un error que nadie busca.
 */
const numeroNoNegativo = (mensaje: string) => z.number().min(0, mensaje).nullish();

export const esquemaDeOportunidad = z.object({
  cliente_id: z.guid(),
  titulo: textoNoVacio("Falta el título de la oportunidad"),
  producto_id: z.guid().nullish(),
  toneladas_estimadas: numeroNoNegativo("Las toneladas no pueden ser negativas"),
  monto_estimado: numeroNoNegativo("El monto no puede ser negativo"),
  moneda: z.literal(["ARS", "USD"]).optional(),
  etapa: z.literal(CLAVES_DE_ETAPA).optional(),
  vendedor_id: z.guid().nullish(),
  fecha_estimada_cierre: z.iso.date().nullish(),
  motivo_perdida: textoOpcional,
  notas: textoOpcional,
});

export const esquemaDeOportunidadParcial = esquemaDeOportunidad
  .omit({ cliente_id: true })
  .partial();

// ── Actividades ─────────────────────────────────────────────

export const esquemaDeActividad = z.object({
  cliente_id: z.guid(),
  contacto_id: z.guid().nullish(),
  oportunidad_id: z.guid().nullish(),
  tipo: z.literal(["llamado", "visita", "email", "whatsapp", "reunion", "otro"]),
  /**
   * Se tipea y no la pone el servidor: la visita se registra a la mañana
   * siguiente. Opcional porque la tabla tiene `default current_date`.
   */
  fecha: z.iso.date().optional(),
  resumen: textoNoVacio("Contá qué se habló"),
  proximo_paso: textoOpcional,
  proximo_paso_el: z.iso.date().nullish(),
  cumplido_el: z.iso.date().nullish(),
});

export const esquemaDeActividadParcial = esquemaDeActividad.omit({ cliente_id: true }).partial();

// ── Las reglas que no caben en un esquema de un campo ───────

/**
 * El próximo paso y su fecha van juntos o no van.
 *
 * La tabla también lo exige (`num_nonnulls(proximo_paso, proximo_paso_el) <> 1`),
 * pero ese rechazo llega como un 23514 de Postgres que no dice nada en
 * castellano a quien está cargando.
 *
 * **Recibe el valor que va a quedar, no el que vino.** En un PATCH que manda
 * sólo uno de los dos, el otro lo aporta la fila que ya está: quien llama tiene
 * que fusionar antes. Si no, borrar la fecha de un paso dejaría el texto
 * huérfano y esto no se enteraría.
 */
export function problemaDelProximoPaso(
  proximoPaso: string | null | undefined,
  proximoPasoEl: string | null | undefined
): string | null {
  if (proximoPaso && !proximoPasoEl) return "Falta para cuándo es el próximo paso.";
  if (!proximoPaso && proximoPasoEl) return "Falta decir cuál es el próximo paso.";
  return null;
}

/**
 * Cerrar una oportunidad como perdida pide el motivo.
 *
 * **Es la única cosa obligatoria de todo el módulo que no hace falta para
 * guardar la fila**, y está a propósito: el porqué de una venta perdida es el
 * único dato del CRM que no se puede reconstruir después mirando los números, y
 * es justo el que nadie carga si no se lo piden. La tabla no lo exige —una
 * oportunidad vieja corregida desde el editor SQL no tiene por qué saberlo— así
 * que la regla vive acá, que es por donde entra lo que carga la gente.
 */
export function problemaDelCierre(
  etapa: string | null | undefined,
  motivoPerdida: string | null | undefined
): string | null {
  if (etapa === "perdida" && !motivoPerdida?.trim()) {
    return "Para dar una oportunidad por perdida hay que decir por qué.";
  }
  return null;
}

/**
 * El CUIT listo para guardar, y el aviso si no cierra.
 *
 * Devuelve `{ cuit, aviso }`: el valor normalizado a once dígitos y, cuando
 * corresponde, un texto para mostrarle a quien cargó. **Nunca rechaza.** Lo que
 * entra con otra cantidad de dígitos se guarda como vino, limpio de espacios:
 * un CUIT a medio tipear es un dato a corregir, no un motivo para perder el
 * resto de la ficha.
 */
export function cuitParaGuardar(valor: string | null | undefined): {
  cuit: string | null;
  aviso: string | null;
} {
  const crudo = (valor ?? "").trim();
  if (!crudo) return { cuit: null, aviso: null };

  const normalizado = normalizarCuit(crudo);
  if (!normalizado) {
    return {
      cuit: crudo,
      aviso: `«${crudo}» no tiene once dígitos: se guardó como lo escribiste, revisalo.`,
    };
  }
  if (!cuitEsValido(normalizado)) {
    return {
      cuit: normalizado,
      aviso: `El dígito verificador de ${normalizado} no cierra: se guardó igual, revisalo.`,
    };
  }
  return { cuit: normalizado, aviso: null };
}
