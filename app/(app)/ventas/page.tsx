import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { nivelVentasDe } from "@/lib/ventas/auth";
import { armarEmbudo } from "@/lib/ventas/crm/embudo";
import { comoMontos, comoToneladas } from "@/lib/ventas/crm/formato";
import {
  estadoDeSeguimiento,
  resumirPasos,
  ultimaActividadPorCliente,
} from "@/lib/ventas/crm/seguimiento";
import KpiCard from "@/components/KpiCard";

/**
 * El tablero de Ventas: la puerta del módulo.
 *
 * Hoy tiene un solo frente —el CRM— y está hecho así a propósito: el módulo
 * tiene que poder recibir pedidos, listas de precios y presupuestos sin mudar
 * lo que ya anda. Es el mismo molde que `/calidad` y `/seguridad-higiene`.
 *
 * ── QUÉ NÚMERO VA PRIMERO ───────────────────────────────────
 *
 * **Lo vencido**, y no la cantidad de clientes. Un tablero que abre con «47
 * clientes» no le pide nada a nadie; lo que hace que alguien entre al CRM a la
 * mañana es ver que hay tres cosas que tenían que estar hechas ayer. El orden
 * de las tarjetas es el orden en que hay que mirarlas: lo que vence, lo que se
 * enfrió, lo que está en juego.
 *
 * ── LOS CONTEOS SE HACEN EN MEMORIA, CON LAS MISMAS FUNCIONES QUE LA PANTALLA ──
 *
 * «Vencido» y «sin contacto» son reglas de varias columnas que viven en
 * `lib/ventas/crm/seguimiento.ts`. Repetirlas como filtros de SQL sería la
 * segunda copia, y el día que una cambie el tablero y la lista a la que lleva
 * van a decir cosas distintas. Es el criterio de `/seguridad-higiene`.
 *
 * Un fallo de lectura deja la tarjeta en «—» y no en cero: «no se pudo contar»
 * y «hay cero» son dos cosas distintas, y un cero inventado en un tablero es
 * peor que un hueco porque nadie lo va a ir a mirar.
 */

const VENCIDO = "#B91C1C";
const ENFRIADO = "#B45309";
const EMBUDO = "#0284C7";
const CLIENTES = "#15803D";

/** Íconos al molde de los del menú: SVG de 20×20, `currentColor`, trazo 1,8. */
function IconReloj() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconNieve() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" strokeLinecap="round" />
    </svg>
  );
}

function IconEmbudo() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconGente() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" strokeLinecap="round" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M22 20v-1.5a4 4 0 0 0-3-3.87M16.5 3.6a4 4 0 0 1 0 6.8" strokeLinecap="round" />
    </svg>
  );
}

export default async function VentasPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  // Un fallo de la lectura de permisos no es «no tenés acceso»: redirigir a la
  // portada le diría a alguien que sí lo tiene que no lo tiene, y no dejaría
  // rastro. Se rompe a la vista, que es lo que se puede reintentar.
  const permiso = await nivelVentasDe(supabase, user.id);
  if (!permiso.ok) {
    throw new Error(`No se pudieron comprobar tus permisos de Ventas: ${permiso.error}`);
  }
  if (!permiso.nivel) redirect("/");

  const hoy = hoyEnArgentina();

  // Las tres lecturas en paralelo: no dependen entre sí. Cada una puede fallar
  // sola y deja su tarjeta en «—».
  const [clientes, actividades, oportunidades] = await Promise.all([
    traerTodo((desde, hasta) =>
      supabase.from("ventas_clientes").select("id, estado").range(desde, hasta)
    ).catch(() => null),
    traerTodo((desde, hasta) =>
      supabase
        .from("ventas_actividades")
        .select("cliente_id, fecha, proximo_paso, proximo_paso_el, cumplido_el")
        .range(desde, hasta)
    ).catch(() => null),
    traerTodo((desde, hasta) =>
      supabase
        .from("ventas_oportunidades")
        .select("etapa, monto_estimado, moneda, toneladas_estimadas")
        .range(desde, hasta)
    ).catch(() => null),
  ]);

  const pasos = actividades ? resumirPasos(actividades, hoy) : null;

  // Los clientes enfriados: los que hace más de 60 días que nadie toca. Los que
  // nunca tuvieron una actividad se cuentan aparte —son otra cosa y lo que hay
  // que hacer con ellos es distinto: a uno hay que llamarlo por primera vez, al
  // otro hay que explicar qué pasó—.
  let enfriados: number | null = null;
  let sinActividad: number | null = null;
  if (clientes && actividades) {
    const ultima = ultimaActividadPorCliente(actividades);
    enfriados = 0;
    sinActividad = 0;
    for (const c of clientes) {
      const estado = estadoDeSeguimiento(ultima.get(c.id), hoy);
      if (estado === "sin_contacto") enfriados += 1;
      if (estado === "nunca") sinActividad += 1;
    }
  }

  const embudo = oportunidades ? armarEmbudo(oportunidades) : null;
  const activos = clientes ? clientes.filter((c) => c.estado === "activo").length : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Ventas</h1>
        <p className="text-sm text-slate-500">Tocá una tarjeta para trabajarla.</p>
      </div>

      <section>
        {/* `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` y no `grid-cols-4`: en
            343 px de ancho útil, cuatro columnas dan 78 px cada una y ahí no
            entra una etiqueta con su número. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            color={pasos && pasos.vencidos > 0 ? VENCIDO : CLIENTES}
            icon={<IconReloj />}
            label="Para hoy y vencido"
            value={pasos ? pasos.vencidos + pasos.hoy : "—"}
            sub={
              pasos ? (
                <>
                  <span className={pasos.vencidos > 0 ? "font-semibold text-red-700" : ""}>
                    {pasos.vencidos} {pasos.vencidos === 1 ? "vencido" : "vencidos"}
                  </span>
                  {` · ${pasos.hoy} para hoy`}
                  <br />
                  {pasos.proximos} en los próximos 7 días
                </>
              ) : (
                "no se pudo contar"
              )
            }
            href="/ventas/crm/seguimiento"
          />

          <KpiCard
            color={ENFRIADO}
            icon={<IconNieve />}
            label="Clientes enfriados"
            value={enfriados ?? "—"}
            sub={
              enfriados === null ? (
                "no se pudo contar"
              ) : (
                <>
                  sin contacto hace más de 60 días
                  <br />
                  {sinActividad} nunca tuvieron una actividad
                </>
              )
            }
            href="/ventas/crm/clientes?seguimiento=sin_contacto"
          />

          <KpiCard
            color={EMBUDO}
            icon={<IconEmbudo />}
            label="En el embudo"
            value={embudo ? embudo.abiertas.cantidad : "—"}
            sub={
              embudo ? (
                <>
                  {comoMontos(embudo.abiertas.monto)}
                  <br />
                  {comoToneladas(embudo.abiertas.toneladas)} · ponderado{" "}
                  {comoMontos(embudo.abiertas.ponderado)}
                </>
              ) : (
                "no se pudo contar"
              )
            }
            href="/ventas/crm/oportunidades"
          />

          <KpiCard
            color={CLIENTES}
            icon={<IconGente />}
            label="Clientes"
            value={clientes ? clientes.length : "—"}
            sub={
              clientes ? (
                <>
                  {activos} activos
                  <br />
                  {clientes.filter((c) => c.estado === "prospecto").length} prospectos
                </>
              ) : (
                "no se pudo contar"
              )
            }
            href="/ventas/crm/clientes"
          />
        </div>
      </section>
    </div>
  );
}
