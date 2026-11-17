import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revisarElSecreto } from "@/lib/core/cron";
import { traerTodo } from "@/lib/core/paginado";
import { enviarPush } from "@/lib/core/webpush";
import { avisosDeTodoElSistema, sinLoQueNoPuedeAtender } from "@/lib/home/avisosDeUsuario";
import { soloDeSusModulos } from "@/lib/home/moduloDelAviso";
import { novedadesAlInstante } from "@/lib/home/novedadAlInstante";
import { ultimoVistazo, guardarElVistazo, queMandarAhora } from "@/lib/home/vistazoDeAvisos";
import { contarAusenciasDesde, lineaDeAusencias } from "@/lib/rrhh/ausenciasRecientes";
import { resumirElMovimiento } from "@/lib/home/resumenDeAvisos";
import { filtrarDescartadas, type DescarteNotificacion } from "@/lib/home/notificaciones";
import { modulosVisibles, nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Las novedades al instante: lo que cambió desde la corrida anterior, cada
 * quince minutos.
 *
 * ── QUÉ PROBLEMA RESUELVE ────────────────────────────────────────────────────
 *
 * El resumen diario llega una vez por día, a las 8:30. Una ausencia cargada a
 * las 9:05 se contaba recién a la mañana siguiente, y lo que se pidió fue que
 * las ausencias y las novedades se sepan **enseguida**.
 *
 * ── UNA SOLA PASADA PARA LOS DIECISÉIS ───────────────────────────────────────
 *
 * `avisosDeTodoElSistema` se llama **una vez**, no una por persona: los
 * conteos son globales —salen de un `count` sobre las tablas— y lo único que
 * es por persona es el **filtrado**. Medido el 16/11/2026: una pasada global
 * 1,2 s; las dieciséis como las hace el cron diario, 8,7 s (544 ms cada una);
 * la vista de ritmo sola, 295 ms en caliente, idéntica para todos. Es la
 * salida que el encabezado de `avisos-diarios` ya había dejado anotada, y es
 * lo que vuelve barata la cadencia de quince minutos.
 *
 * Por eso mismo hizo falta `moduloDelAviso`: con una pasada por persona, el
 * módulo se aplicaba solo —el conteo de un módulo que no ve no se hacía—, y
 * con una pasada sola ya no hay dónde, así que cada aviso declara su módulo.
 *
 * Las tres lecturas de personas —usuarios, grants y descartes— también se
 * hacen de una, y no una por persona: son 56 corridas por día, y tres
 * consultas enteras cuestan menos que cuarenta y ocho chiquitas.
 *
 * ── POR QUÉ `compras-por-aprobar` NO ENTRA ───────────────────────────────────
 *
 * Ya avisa solo, en el momento en que el requerimiento nace esperando
 * (`lib/compras/avisoDeAprobacion.ts`), y a la lista de quien puede aprobar.
 * Dejarlo acá sería el mismo push dos veces por lo mismo. Se pidió
 * explícitamente dejarlo como está.
 *
 * Como es el único aviso que `QuePuedeAtender.apruebaCompras` gobierna,
 * sacarlo deja esa consulta sin objeto: no se le pregunta a
 * `compras_aprobadores` por cada persona en cada corrida.
 *
 * ── EL ORDEN DE LOS TRES FILTROS, QUE NO ES INTERCAMBIABLE ───────────────────
 *
 * Primero se filtra el **stock** de cada persona —módulos, descartes, lo que
 * no puede atender— y recién después se calcula la novedad. Al revés no
 * funciona: `filtrarDescartadas` compara `cantidad > cantidad_vista`, y la
 * cantidad de una novedad es un delta de 3, no el stock de 26. Comparar un
 * delta contra un descarte de 23 silenciaría todo para siempre.
 *
 * ── DOS RIESGOS ASUMIDOS, DICHOS ─────────────────────────────────────────────
 *
 * - **El segundo despliegue.** Hay otro proyecto de Vercel sirviendo este
 *   mismo repo contra esta misma base (ver CLAUDE.md), así que programa este
 *   cron también y consume `avisos_vistos`: una novedad que se lleva su
 *   corrida ya no la ve la nuestra. No se frena con `esLaCorridaCanonica()`
 *   **a propósito** — un falso negativo ahí (falta una variable en Vercel)
 *   dejaría al cron callado para siempre y en silencio, que es peor que el
 *   problema. Es además la misma exposición que `avisos_fotos` ya tiene desde
 *   el resumen diario. La defensa de verdad es apagar ese despliegue.
 * - **Los lunes se solapa con el resumen de totales.** La misma persona
 *   recibe las novedades desde las 7:00 y los totales a las 8:30. Es una vez
 *   por semana y es el precio de conservar la red semanal.
 */

/** Los avisos que ya tienen su propio push y llegarían dos veces. Ver arriba. */
const YA_AVISA_SOLO = new Set(["compras-por-aprobar"]);

export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const admin = createAdminClient();

  // ── Contra qué se compara ──
  //
  // La tabla la crea una migración y la aplica una persona, así que entre el
  // deploy y esa aplicación no existe. Se corta con 503 y se dice: seguir
  // trataría la falta de tabla como «primera corrida» y el cron guardaría sin
  // mandar nunca, 56 veces por día, sin que nadie se entere. Mismo criterio
  // que `avisos-diarios` con `avisos_fotos`.
  const { cuando, vistos, error: errorDelVistazo } = await ultimoVistazo(admin);
  if (errorDelVistazo) {
    console.error("avisos-al-instante: no se pudo leer avisos_vistos:", errorDelVistazo);
    return NextResponse.json(
      {
        error: "No se pudo leer el vistazo de avisos. ¿Falta aplicar la migración de avisos_vistos?",
        detalle: errorDelVistazo,
      },
      { status: 503 }
    );
  }

  const ahora = new Date();
  const queMandar = queMandarAhora({ cuando, ahora });

  // Los conteos de todo el sistema, una sola vez. Se leen **aunque no haya que
  // mandar nada**, porque el vistazo se guarda igual: si no, la primera
  // corrida nunca deja de ser la primera.
  const todos = await avisosDeTodoElSistema(admin);
  const paraElInstante = todos.filter((a) => !YA_AVISA_SOLO.has(a.id));

  let novedadesGlobales = 0;
  let ausencias = 0;
  let personas = 0;
  let enviadas = 0;
  let vencidas = 0;
  let fallos = 0;

  if (queMandar === "novedades" && cuando !== null) {
    // Cuántas ausencias entraron desde la corrida anterior. No es un aviso de
    // `lib/home/avisos.ts` —no hay stock que contar— y le llega a todos: se
    // pidió que una ausencia se sepa enseguida en todo el sistema.
    const { cuantas, error: errorDeAusencias } = await contarAusenciasDesde(admin, cuando);
    if (errorDeAusencias) {
      console.error("avisos-al-instante: no se pudieron contar las ausencias:", errorDeAusencias);
    }
    ausencias = cuantas;
    const deAusencias = lineaDeAusencias(cuantas);

    let suscripciones: { usuario_id: string; endpoint: string; p256dh: string; auth: string }[];
    try {
      suscripciones = await traerTodo((desde, hasta) =>
        admin
          .from("push_suscripciones")
          .select("usuario_id, endpoint, p256dh, auth")
          .range(desde, hasta)
      );
    } catch (e) {
      const mensaje = (e as Error)?.message ?? String(e);
      console.error("avisos-al-instante: no se pudo leer push_suscripciones:", mensaje);
      return NextResponse.json(
        { error: "No se pudo leer las suscripciones.", detalle: mensaje },
        { status: 503 }
      );
    }

    const porUsuario = new Map<string, typeof suscripciones>();
    for (const s of suscripciones) {
      porUsuario.set(s.usuario_id, [...(porUsuario.get(s.usuario_id) ?? []), s]);
    }

    // Las tres lecturas de personas, de una. Se piden sólo si hay alguien
    // suscripto: hoy puede no haber nadie y entonces no hay nada que filtrar.
    const ids = [...porUsuario.keys()];
    if (ids.length > 0) {
      const [usuarios, grants, descartes] = await Promise.all([
        admin
          .from("usuarios")
          .select("id, rol, activo")
          .in("id", ids)
          .then((r) => (r.data ?? []) as { id: string; rol: Rol; activo: boolean }[]),
        admin
          .from("usuario_modulos")
          .select("id, usuario_id, modulo, nivel")
          .in("usuario_id", ids)
          .then((r) => (r.data ?? []) as UsuarioModulo[]),
        admin
          .from("notificaciones_descartes")
          .select("usuario_id, notificacion_id, cantidad_vista")
          .in("usuario_id", ids)
          .then(
            (r) => (r.data ?? []) as (DescarteNotificacion & { usuario_id: string })[]
          ),
      ]);

      novedadesGlobales = novedadesAlInstante(paraElInstante, vistos).length;

      for (const usuario of usuarios) {
        // Una cuenta dada de baja no recibe: sigue teniendo suscripciones
        // hasta que el `on delete cascade` las limpie.
        if (!usuario.activo) continue;

        const suyos = grants.filter((g) => g.usuario_id === usuario.id);
        const sinDescartadas = filtrarDescartadas(
          soloDeSusModulos(paraElInstante, modulosVisibles(usuario.rol, suyos)),
          descartes.filter((d) => d.usuario_id === usuario.id)
        );
        const puedeAtender = sinLoQueNoPuedeAtender(sinDescartadas, {
          // Sin objeto: `compras-por-aprobar` ya se sacó más arriba y es el
          // único aviso que este permiso gobierna.
          apruebaCompras: false,
          evaluaSyh: nivelEnModulo(usuario.rol, suyos, "seguridad_higiene") === "admin",
          administraElSistema: usuario.rol === "admin_sistema",
        });

        // La línea de ausencias va **después** de los filtros y no pasa por
        // ellos: no es un aviso de la campana, así que nadie puede tener un
        // descarte suyo, y no es de ningún módulo a propósito.
        const novedades = [
          ...(deAusencias ? [deAusencias] : []),
          ...novedadesAlInstante(puedeAtender, vistos),
        ];

        const resumen = resumirElMovimiento(novedades);
        if (!resumen) continue;
        personas++;

        for (const aparato of porUsuario.get(usuario.id) ?? []) {
          const resultado = await enviarPush(aparato, resumen);
          if (resultado === "enviada") enviadas++;
          else if (resultado === "fallo") fallos++;
          else {
            // Vencida: ese aparato ya no existe. Se borra esa fila y no las
            // otras de la misma persona.
            vencidas++;
            await admin
              .from("push_suscripciones")
              .delete()
              .eq("usuario_id", usuario.id)
              .eq("endpoint", aparato.endpoint);
          }
        }
      }
    }
  }

  // ── El vistazo, al final y siempre ──
  //
  // **Al final**: guardarlo antes dejaría la comparación de esta misma corrida
  // en cero para todos.
  //
  // **Siempre**, incluso cuando no se mandó nada —fuera de hora, o la primera
  // corrida—: si no se guardara, la primera corrida nunca dejaría de ser la
  // primera y el cron quedaría callado para siempre.
  //
  // Sale de `todos` y no de lo que se le calculó a nadie: si dependiera de
  // quién está suscripto, un módulo que nadie mira quedaría sin vistazo para
  // aparecer entero como novedad el día que alguien se suscriba.
  const { error: errorAlGuardar } = await guardarElVistazo(admin, todos, ahora.toISOString());
  if (errorAlGuardar) {
    console.error("avisos-al-instante: no se pudo guardar el vistazo:", errorAlGuardar);
  }

  return NextResponse.json({
    queMandar,
    cuandoFueElVistazo: cuando,
    novedades: novedadesGlobales,
    ausencias,
    personas,
    enviadas,
    vencidas,
    fallos,
    avisosEnElVistazo: todos.length,
    ...(errorAlGuardar ? { errorAlGuardar } : {}),
  });
}
