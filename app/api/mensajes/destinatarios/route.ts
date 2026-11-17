import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { estaConfigurado } from "@/lib/core/correo";
import { errorDeValidacion, validar } from "@/lib/core/validar";
import { ENTIDADES, quienesLoVenConDatos } from "@/lib/mensajes/entidades";
import { esquemaDelTipo, parametrosDeLaUrl } from "@/lib/mensajes/pedidos";

/**
 * GET ?tipo=… — a quién se puede mencionar en el hilo de un registro de ese
 * tipo, y si el correo está configurado.
 *
 * **Sólo se puede mencionar a quien puede ver el registro**, así que la lista
 * es menos que los catorce y depende del tipo: el correo lleva el texto del
 * mensaje y el enlace rebotaría a quien no tiene el módulo.
 *
 * **`correo_configurado` es lo que le permite a la pantalla avisar antes de que
 * alguien escriba creyendo que avisó.** Sin él, `enviarCorreo()` devuelve
 * `estado: "sin-configurar"` en silencio y el único aviso sería el que se descubre
 * después.
 *
 * **No devuelve la dirección de correo, sólo si la tiene** (`tiene_correo`). La
 * pantalla necesita saber que a esa persona no le va a llegar nada, no a qué
 * casilla. `usuarios` sólo deja leer la fila propia con el cliente de la sesión
 * (la policy es `id = auth.uid() or es_admin()`), y esta ruta lee con el admin,
 * donde RLS no corre: lo que sale lo decide acá, campo por campo.
 *
 * **Quien pregunta no está en la lista**: no se menciona a uno mismo.
 *
 * Pide poder ver los registros de ese tipo. Sin eso listaría quiénes tienen
 * Mantenimiento o Seguridad e Higiene a alguien que no lo tiene.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const pedido = validar(esquemaDelTipo, parametrosDeLaUrl(request.url, ["tipo"]));
  if (!pedido.ok) return errorDeValidacion(pedido.problemas);
  const { tipo } = pedido.datos;

  const admin = createAdminClient();

  try {
    if (!(await ENTIDADES[tipo].puedeVerlo(admin, user.id))) {
      return NextResponse.json({ error: "Sin permisos para ver este registro" }, { status: 403 });
    }

    const quienes = await quienesLoVenConDatos(admin, tipo);
    return NextResponse.json({
      correo_configurado: estaConfigurado(),
      data: quienes
        .filter((u) => u.id !== user.id)
        .map((u) => ({
          id: u.id,
          nombre: u.nombre,
          tiene_correo: Boolean(u.email && u.email.trim()),
        })),
    });
  } catch (e) {
    console.error("mensajes: no se pudo armar la lista de destinatarios", (e as Error).message);
    return NextResponse.json(
      { error: "No se pudieron comprobar los permisos. Probá de nuevo en un momento." },
      { status: 503 }
    );
  }
}
