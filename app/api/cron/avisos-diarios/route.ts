import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revisarElSecreto } from "@/lib/core/cron";
import { traerTodo } from "@/lib/core/paginado";
import { enviarPush } from "@/lib/core/webpush";
import { avisosDeUsuario, avisosDeTodoElSistema } from "@/lib/home/avisosDeUsuario";
import { resumirParaPush, resumirElMovimiento } from "@/lib/home/resumenDeAvisos";
import { loQueSeMovio, queMandarHoy } from "@/lib/home/movimiento";
import { ultimaFoto, guardarFoto } from "@/lib/home/fotoDeAvisos";
import { hoyEnArgentina } from "@/lib/core/fechas";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * El resumen diario: una notificación por persona con lo que tiene para mirar.
 *
 * POR QUÉ UN RESUMEN Y NO UN AVISO POR CADA COSA
 *
 * Avisar en el momento exigiría enganchar las rutas de escritura de los doce
 * módulos, y además nada de esto es urgente a la hora: una orden atrasada o una
 * factura sin vincular son "miralo hoy", no "soltá lo que estás haciendo". Y un
 * aviso por ítem, con los números de hoy, son diez pushes a la mañana: la
 * persona los silencia y a partir de ahí el sistema no avisa más nada. La
 * notificación que se puede sostener todos los días es una sola.
 *
 * **No se manda nada cuando no hay nada.** Un push diario diciendo "no pasa
 * nada" es el que enseña a ignorarlos.
 *
 * SÓLO SE CALCULA PARA QUIEN PUEDE RECIBIR
 *
 * Se arranca de `push_suscripciones` y no de `usuarios`: calcularle los avisos
 * a alguien que nunca se suscribió son trece consultas para tirar el resultado.
 * Hoy son 13 usuarios activos y cero suscripciones, así que esto no hace nada
 * hasta que alguien prenda las notificaciones.
 *
 * EL COSTO, Y POR QUÉ SE DEJA ASÍ
 *
 * `avisosDeUsuario` lee la vista `inicio_ritmo_modulos` una vez **por persona**,
 * y esa vista recorre 180 días de trece tablas. Es la parte cara y es idéntica
 * para todos. Con la cantidad de gente de hoy no se nota —y el presupuesto de
 * una función de Vercel es de 300 s— así que no se optimiza todavía: el día que
 * moleste, la salida es leer el ritmo una vez acá y pasárselo. Queda dicho para
 * no tener que volver a medirlo.
 */
export async function GET(request: Request) {
  // El helper compartido y no una comparación propia: la que había en el cron de
  // Remises fallaba ABIERTA —sin `CRON_SECRET` el template literal daba "Bearer
  // undefined", así que cualquiera que mandara ese header disparaba los envíos—.
  // Éste devuelve 503 cuando el secreto no está configurado.
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const admin = createAdminClient();

  // ── Con qué se compara, y qué se manda hoy ──
  //
  // La foto es **la última que haya**, no la de ayer: el día que el cron no
  // corra, comparar contra ayer daría un delta vacío y al día siguiente uno
  // falso. Contra la última que exista, un día perdido se recupera solo.
  //
  // Sin ninguna foto es el primer día: no hay con qué comparar, así que no se
  // manda nada y sólo se guarda. Tratar "sin foto" como "todo es nuevo" sería
  // un push de estreno con los trece avisos, que es justo lo que este cambio
  // viene a evitar.
  const { fecha: fechaDeLaFoto, foto, error: errorAlLeerLaFoto } = await ultimaFoto(admin);

  // La tabla la crea una migración y la aplica una persona, así que entre el
  // deploy y esa aplicación no existe. Se dice con todas las letras y se corta:
  // seguir trataría la falta de tabla como "primer día" y el cron no mandaría
  // nada, todos los días, sin que nadie se entere. Mismo criterio que
  // `push_suscripciones` acá abajo.
  if (errorAlLeerLaFoto) {
    console.error("avisos-diarios: no se pudo leer avisos_fotos:", errorAlLeerLaFoto);
    return NextResponse.json(
      {
        error: "No se pudo leer la foto de avisos. ¿Falta aplicar la migración de avisos_fotos?",
        detalle: errorAlLeerLaFoto,
      },
      { status: 503 }
    );
  }

  const hoy = hoyEnArgentina();
  // Qué resumen le toca al día de hoy. La decisión vive en `queMandarHoy`
  // —pura y con tests— y no acá: es la que decide si alguien recibe un push.
  const queMandar = queMandarHoy({ fechaDeLaFoto, hoy });

  // La tabla la crea una migración y las migraciones las aplica una persona, así
  // que entre el deploy y esa aplicación puede no existir. Se dice con todas las
  // letras en vez de tirar un 500 diario que no explica nada — mismo criterio
  // que `traerRitmo` con la vista de ritmo.
  let suscripciones: { usuario_id: string; endpoint: string; p256dh: string; auth: string }[];
  try {
    suscripciones = await traerTodo((desde, hasta) =>
      admin.from("push_suscripciones").select("usuario_id, endpoint, p256dh, auth").range(desde, hasta)
    );
  } catch (e) {
    const mensaje = (e as Error)?.message ?? String(e);
    console.error("avisos-diarios: no se pudo leer push_suscripciones:", mensaje);
    return NextResponse.json(
      { error: "No se pudo leer las suscripciones. ¿Falta aplicar la migración de push_suscripciones?", detalle: mensaje },
      { status: 503 }
    );
  }

  const porUsuario = new Map<string, typeof suscripciones>();
  for (const s of suscripciones) {
    porUsuario.set(s.usuario_id, [...(porUsuario.get(s.usuario_id) ?? []), s]);
  }

  let conAvisos = 0;
  let enviadas = 0;
  let vencidas = 0;
  let fallos = 0;

  for (const [usuarioId, aparatos] of queMandar === "nada" ? [] : porUsuario) {
    // Una cuenta dada de baja no recibe: sigue teniendo suscripciones hasta que
    // el `on delete cascade` las limpie, y eso sólo pasa si se borra la fila.
    const { data: usuario } = await admin
      .from("usuarios").select("rol, activo").eq("id", usuarioId).maybeSingle();
    if (!usuario || !usuario.activo) continue;

    const { data: grants } = await admin
      .from("usuario_modulos").select("id, usuario_id, modulo, nivel").eq("usuario_id", usuarioId);

    const avisos = await avisosDeUsuario(admin, {
      id: usuarioId,
      rol: usuario.rol as Rol,
      grants: (grants ?? []) as UsuarioModulo[],
    });

    // Los lunes el total; el resto de los días, lo que se movió. Las dos
    // salen de los mismos avisos: lo único que cambia es contra qué se
    // comparan y cómo se redactan.
    const resumen =
      queMandar === "totales"
        ? resumirParaPush(avisos)
        : resumirElMovimiento(loQueSeMovio(avisos, foto));
    if (!resumen) continue;
    conAvisos++;

    for (const aparato of aparatos) {
      const resultado = await enviarPush(aparato, resumen);
      if (resultado === "enviada") enviadas++;
      else if (resultado === "fallo") fallos++;
      else {
        // Vencida: el push service dice que ese aparato ya no existe. Se borra
        // esa fila y no las otras de la misma persona — se desinstaló la app de
        // un teléfono, no se dio de baja de todo.
        vencidas++;
        await admin.from("push_suscripciones").delete()
          .eq("usuario_id", usuarioId).eq("endpoint", aparato.endpoint);
      }
    }
  }

  // ── La foto de hoy, al final ──
  //
  // **Después de mandar y no antes**: si se guardara antes, `ultimaFoto` de
  // esta misma corrida devolvería la de hoy y el delta daría cero para todos.
  //
  // Y sale de `avisosDeTodoElSistema` y no de lo que se le calculó a las
  // personas: si saliera de ahí dependería de quién esté suscripto ese día, y
  // un módulo que nadie suscripto mira quedaría sin foto — para aparecer
  // entero como novedad el día que alguien se suscriba.
  //
  // Si falla no se voltea nada: ya se mandó lo que había que mandar, y la
  // comparación de mañana se hace contra la última foto que exista.
  const todos = await avisosDeTodoElSistema(admin);
  const { error: errorDeLaFoto } = await guardarFoto(admin, hoy, todos);
  if (errorDeLaFoto) console.error("avisos-diarios: no se pudo guardar la foto:", errorDeLaFoto);

  return NextResponse.json({
    personasConSuscripcion: porUsuario.size,
    personasConAvisos: conAvisos,
    enviadas,
    vencidas,
    fallos,
    // Para poder mirar qué hizo sin adivinar.
    queMandar,
    fechaDeLaFoto,
    avisosEnLaFoto: todos.length,
    ...(errorDeLaFoto ? { errorDeLaFoto } : {}),
  });
}
