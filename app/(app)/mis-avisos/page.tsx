import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/core/paginado";
import { areaPorDefecto } from "@/lib/compras/areaDelUsuario";
import { puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import MisAvisosClient from "./MisAvisosClient";

/**
 * Fuera del módulo Mantenimiento a propósito: quien ve una máquina rota
 * trabaja en Producción, en Cantera o en el laboratorio, y de 14 usuarios 10 no
 * tienen el módulo. Hasta que existió esta pantalla avisaban por un formulario
 * de Google afuera del sistema: de 184 avisos, ninguno nació en la app.
 *
 * Es la gemela de «Mis pedidos», que resolvió lo mismo para Compras, y repite
 * sus decisiones: se ven los avisos **de mi área** y se pueden mirar los de los
 * demás, y acá no se decide nada. Generar la OT, desestimar y sincronizar siguen
 * en `/mantenimiento/avisos`, que es de quien es la decisión.
 *
 * La lectura de `avisos` está abierta a cualquier autenticado desde la
 * migración `20261022101507`, la misma que le agregó `area_id`.
 *
 * Los avisos los trae el cliente, no esta página: acá queda sólo lo que se
 * necesita enseguida —los catálogos chicos del formulario y de los filtros— y
 * quién mira, que decide si el número de OT es un enlace.
 */
export default async function MisAvisosPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: areas }, { data: mias }, { data: yo }, tieneMantenimiento, urgencias] =
    await Promise.all([
      supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
      // De qué áreas es esta persona. Igual que en «Mis pedidos»: se filtra por
      // área y no por quién cargó, porque los 184 avisos que hay vinieron de la
      // planilla y ninguno trae `creado_por`.
      supabase.from("usuario_areas_compras").select("area_id").eq("usuario_id", user.id),
      supabase.from("usuarios").select("nombre, apellido").eq("id", user.id).single(),
      // Si puede abrir `/mantenimiento/ordenes`. Esa ruta rebota a `/` a quien no
      // tiene el módulo, y se resuelve con la misma función que el layout.
      puedeVerMantenimiento(supabase, user.id),
      // Las urgencias salen de los datos y no de una lista fija: vienen de la
      // planilla con su emoji —«🟡 Media», «🟠 Alta»— y una lista a mano quedaría
      // corta. Se pide sólo esa columna y entera, porque el cliente pagina y
      // desde sus 50 filas no se vería la lista completa.
      traerTodo<{ urgencia: string | null }>((desde, hasta) =>
        supabase.from("avisos").select("urgencia").order("id").range(desde, hasta)
      ),
    ]);

  const misAreas = (mias ?? []).map((a) => a.area_id as string);

  return (
    <MisAvisosClient
      usuarioId={user.id}
      misAreas={misAreas}
      areas={areas ?? []}
      // Con cero o dos áreas queda vacío y el modal pide elegir: no se adivina.
      areaInicial={areaPorDefecto(misAreas)}
      quienAviso={yo ? `${yo.nombre} ${yo.apellido}`.trim() : ""}
      tieneMantenimiento={tieneMantenimiento}
      urgencias={[...new Set(urgencias.map((u) => u.urgencia).filter((u): u is string => Boolean(u)))].sort()}
    />
  );
}
