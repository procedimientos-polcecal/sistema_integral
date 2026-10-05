import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Quién hizo cada acción que no se deshace.
 *
 * Spec: docs/superpowers/specs/2026-09-22-auditoria-de-lo-irreversible-design.md
 * Tabla: migración 20261005090646.
 *
 * ── QUÉ SE AUDITA Y QUÉ NO ──────────────────────────────────
 *
 * Las acciones **irreversibles**, no todo cambio de todo campo. El catálogo es
 * `ACCIONES` y hoy son siete verbos sobre cinco circuitos: postear un asiento
 * en Odoo, mover los permisos de un usuario, cerrar una liquidación, ajustar
 * stock y aprobar o denegar una compra.
 *
 * Lo que ya tiene su propio registro no se duplica: el kardex de Inventario es
 * append-only con `creado_por` desde la 046, y `compras_historial` guarda cada
 * cambio de estado desde la 017. Esta tabla agrega lo que a esos dos les falta
 * —el autor y el motivo— en las acciones donde no tenerlo duele.
 *
 * ── POR QUÉ ESTO Y NO UN TRIGGER ────────────────────────────
 *
 * Porque un trigger no sabe quién. Medido: de las 2.922 filas de
 * `compras_historial`, **2.852 no tienen `usuario_id`** y **una sola tiene
 * nota**. Y no se arregla con `auth.uid()` adentro del trigger, porque 60 de
 * las 125 rutas que escriben usan la service role, donde `auth.uid()` es null
 * siempre.
 *
 * El precio es real: **una ruta nueva se puede olvidar de llamar a `auditar()`**.
 * Se acota con que la llamada viva acá y no copiada en cada ruta, con que esté
 * escrito en CLAUDE.md, y con que las decisiones —qué es obligatorio, quién es
 * el actor— estén en `filaDeAuditoria()`, que es pura y tiene test.
 */

/** Los verbos que se auditan. Agregar uno pide tocar también el check de la tabla. */
export const ACCIONES = [
  "postear",
  "aprobar",
  "denegar",
  "cerrar",
  "ajustar",
  "conceder_acceso",
  "quitar_acceso",
] as const;
export type Accion = (typeof ACCIONES)[number];

/**
 * Quién la hizo.
 *
 * Existe para distinguir **"no sé quién" de "no hubo nadie"**, que es
 * exactamente lo que hoy no se puede decir mirando las 2.852 filas sin autor de
 * Compras: un `usuario_id` vacío ahí puede ser un olvido de la ruta o la
 * sincronización de las 09:15 leyendo la planilla, y no hay forma de saberlo.
 */
export type Actor = "persona" | "sincronizacion" | "cron";

export interface Evento {
  modulo: string;
  entidad: string;
  entidadId: string;
  accion: Accion;
  /** Quien la hizo, si fue una persona. El nombre se cachea en la fila. */
  usuario?: { id: string; nombre: string } | null;
  /** Obligatorio cuando no hay usuario: dice por qué no lo hay. */
  actor?: Actor;
  valorAnterior?: string | null;
  valorNuevo?: string | null;
  motivo?: string | null;
  contexto?: Record<string, unknown> | null;
}

/** La fila tal como va a la tabla. */
export interface FilaDeAuditoria {
  usuario_id: string | null;
  usuario_nombre: string | null;
  actor: Actor;
  modulo: string;
  entidad: string;
  entidad_id: string;
  accion: Accion;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  motivo: string | null;
  contexto: Record<string, unknown> | null;
}

/**
 * Las acciones donde el motivo es obligatorio.
 *
 * Denegar y ajustar son las dos que **contradicen** lo que el sistema venía
 * diciendo: una compra que iba a salir no sale, un stock que decía 40 pasa a
 * decir 12. Sin el porqué, el registro dice que alguien lo hizo pero no sirve
 * para entender nada seis meses después, que es para lo que existe.
 *
 * Las otras cinco confirman algo que ya estaba en curso, así que el motivo es
 * opcional.
 */
const EXIGEN_MOTIVO: readonly Accion[] = ["denegar", "ajustar"];

export type Resultado =
  | { ok: true; fila: FilaDeAuditoria }
  | { ok: false; error: string };

/**
 * Valida el evento y arma la fila. **Pura**: no toca la base.
 *
 * Acá viven las dos reglas que hacen que la tabla sirva, y por eso están
 * separadas de la escritura: se pueden probar sin una base y sin una sesión.
 */
export function filaDeAuditoria(evento: Evento): Resultado {
  const motivo = (evento.motivo ?? "").trim() || null;

  if (EXIGEN_MOTIVO.includes(evento.accion) && !motivo) {
    return { ok: false, error: `Para registrar "${evento.accion}" hace falta un motivo.` };
  }

  // Regla del actor. Si hay persona, el actor es `persona` aunque el llamador
  // diga otra cosa: lo que manda es el dato, no la etiqueta.
  //
  // Y sin persona hay que decir **cuál** proceso fue. Dejar que pase un null
  // silencioso es volver a las 2.852 filas de las que no se puede decir si
  // falta el autor o no había ninguno.
  const actor: Actor = evento.usuario ? "persona" : (evento.actor ?? "persona");
  if (!evento.usuario && actor === "persona") {
    return {
      ok: false,
      error: "Falta decir quién: o viene el usuario, o el actor es 'sincronizacion' o 'cron'.",
    };
  }

  const nombre = (evento.usuario?.nombre ?? "").trim();

  return {
    ok: true,
    fila: {
      usuario_id: evento.usuario?.id ?? null,
      // Cacheado al escribir y no resuelto después por join: un usuario dado de
      // baja no puede dejar la auditoría sin nombre.
      usuario_nombre: nombre || null,
      actor,
      modulo: evento.modulo,
      entidad: evento.entidad,
      entidad_id: evento.entidadId,
      accion: evento.accion,
      valor_anterior: evento.valorAnterior ?? null,
      valor_nuevo: evento.valorNuevo ?? null,
      motivo,
      contexto: evento.contexto ?? null,
    },
  };
}

/**
 * Escribe el evento.
 *
 * **Nunca tira.** Devuelve `{ ok: false, error }` y deja que quien llama decida
 * qué hacer, que en todos los casos de hoy es informarlo sin deshacer la
 * acción. Es deliberado: estas acciones son irreversibles, así que para cuando
 * se audita el asiento ya está posteado y la liquidación ya está cerrada.
 * Reventar acá no desharía nada y además convertiría un problema de registro en
 * una pantalla rota.
 *
 * Lo que **no** se hace es tragárselo: la ruta devuelve el aviso, igual que con
 * los fallos de escritura a la planilla. Un fallo que no se distingue de un
 * éxito no es un registro.
 */
export async function auditar(
  cliente: SupabaseClient,
  evento: Evento
): Promise<{ ok: boolean; error?: string }> {
  const armada = filaDeAuditoria(evento);
  if (!armada.ok) return { ok: false, error: armada.error };

  const { error } = await cliente.from("auditoria").insert(armada.fila);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * El nombre que se guarda, a partir de la fila de `usuarios`.
 *
 * Vive acá para que las seis rutas no escriban seis veces el mismo
 * `${nombre} ${apellido}` —y para que la que se olvide del apellido no exista—.
 */
export function nombreParaAuditoria(
  usuario: { nombre?: string | null; apellido?: string | null; email?: string | null } | null | undefined
): string {
  const partes = [usuario?.nombre, usuario?.apellido].map((p) => (p ?? "").trim()).filter(Boolean);
  if (partes.length > 0) return partes.join(" ");
  return (usuario?.email ?? "").trim() || "";
}
