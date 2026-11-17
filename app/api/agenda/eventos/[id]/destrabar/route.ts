import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { esquemaDeDestrabar, eventoParaGoogle } from "@/lib/agenda/pedido";
import { destrabar } from "@/lib/agenda/escribirEnGoogle";
import { cargarEvento, rechazoDeEventoDeOT, anotarEnLaFila } from "@/lib/agenda/cargar";
import { quienLlama } from "@/lib/agenda/sesion";

/**
 * Destrabar un evento divergido: **es lo que lo vuelve a atar al SdG**. Sin
 * esta ruta un evento que alguien movió o borró desde Google queda muerto para
 * siempre, porque la sincronización deja de escribirlo. Es del dueño.
 *
 * `{ como: "reescribir" }` manda a Google lo que dice el SdG; `{ como:
 * "aceptar" }` trae lo que dice Google a la fila. Qué hace cada una con cada
 * tipo de divergencia, y por qué un borrado se restaura con `PUT` y no con
 * `PATCH`, está en `destrabar()` de `lib/agenda/escribirEnGoogle.ts`.
 *
 * **No es `visto`.** `visto` apaga la campana para una persona y no cambia el
 * evento; esto cambia el evento y lo desata para todos.
 *
 * Si Google falla, el evento sigue divergido —no se destrabó nada— y la
 * respuesta es un 502 con lo que dijo Google. Si Google contestó bien y lo que
 * falla es anotarlo, el 500 lo dice con todas las letras: reintentar es seguro,
 * reescribir lo mismo dos veces no cambia nada.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const quien = await quienLlama(supabase);
  if (!quien.ok) return quien.respuesta;

  const cuerpo = await request.json().catch(() => null);
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return NextResponse.json({ error: "El pedido no trae un cuerpo válido" }, { status: 400 });
  }
  const r = validar(esquemaDeDestrabar, cuerpo);
  if (!r.ok) return errorDeValidacion(r.problemas);

  const cargado = await cargarEvento(supabase, id, quien.id, { accion: "destrabarlo" });
  if (!cargado.ok) return cargado.respuesta;
  const actual = cargado.evento;

  if (!actual.divergencia) {
    return NextResponse.json({ error: "Ese evento no está divergido: no hay nada que destrabar" }, { status: 409 });
  }

  // `aceptar` en un evento de OT cambiaría `inicio`/`fin`, que salen de la
  // `fecha_ejecucion` y la sincronización volvería a pisar. `reescribir` sí
  // pasa: es lo único que resucita un evento de OT que alguien borró en Google.
  if (r.datos.como === "aceptar") {
    const deUnaOT = await rechazoDeEventoDeOT(supabase, actual, "aceptar");
    if (deUnaOT) return deUnaOT;
  }

  const resultado = await destrabar(
    r.datos.como,
    {
      casilla: actual.casilla,
      google_event_id: actual.google_event_id,
      inicio: actual.inicio,
      fin: actual.fin,
      divergencia: actual.divergencia,
      // Acá el `ot_id` no es defensivo: `reescribir` es el único camino que
      // resucita el evento de una OT que alguien borró en Google, así que esta
      // ruta sí escribe eventos de OT. Sin esto, resucitar uno le mandaría la
      // invitación de nuevo a las cuatro casillas.
      ot_id: actual.ot_id,
    },
    eventoParaGoogle(actual, actual.invitados, actual.casilla)
  );

  if (!resultado.ok) {
    // Un fallo de escritura se guarda con lo que dijo Google, aunque no destrabe.
    if (resultado.columnas) await anotarEnLaFila(supabase, id, resultado.columnas);
    return NextResponse.json({ error: resultado.error }, { status: resultado.estado });
  }

  const error = await anotarEnLaFila(supabase, id, resultado.columnas);
  if (error) {
    return NextResponse.json(
      {
        error:
          `Google quedó como se pidió, pero no se pudo anotar en el evento ni en dos intentos y sigue ` +
          `figurando divergido: ${error}. Volvé a destrabarlo: repetirlo no cambia nada.`,
      },
      { status: 500 }
    );
  }

  const { data, error: errorDeLectura } = await supabase
    .from("agenda_eventos")
    .select("*, agenda_invitados(email, usuario_id), usuarios!dueno_id(nombre, apellido, email)")
    .eq("id", id)
    .maybeSingle();

  return NextResponse.json({
    data: data ?? null,
    ...(errorDeLectura || !data
      ? { advertencia: "El evento se destrabó, pero no se pudo volver a leer para mostrarlo. Recargá la pantalla." }
      : {}),
  });
}
