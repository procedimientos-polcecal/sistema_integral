import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { nivelSyhDe } from "@/lib/seguridadHigiene/auth";
import { resumenDeCondiciones } from "@/lib/seguridadHigiene/gestion";
import KpiCard from "@/components/KpiCard";

/**
 * El tablero de Seguridad e Higiene: la puerta del módulo.
 *
 * Hoy tiene una sola tarjeta, y está hecho así a propósito: el módulo tiene que
 * poder recibir accidentes, capacitaciones, entrega de EPP e inspecciones sin
 * mudar lo que ya anda. Agregar el segundo frente es agregar una tarjeta y una
 * ruta, no tocar ésta. Es el mismo molde que `/calidad`.
 *
 * El número que se ve primero es **cuántas condiciones abiertas les falta
 * algo** y no cuántas hay: es lo que la planilla de origen escondía (35 de 44
 * sin evaluar) y lo que este módulo existe para que se vea. Se cuenta con las
 * mismas funciones que usa la tabla, así el número de la tarjeta y la lista a la
 * que lleva no pueden discrepar.
 */

/** Un ícono al molde de los del menú: SVG de 20×20, `currentColor`, trazo 1,8. Un triángulo de aviso. */
function IconAviso() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path
        d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
    </svg>
  );
}

const CONDICIONES = "#B45309";
const ALERTA = "#B91C1C";

export default async function SeguridadHigienePage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelSyhDe(supabase, user.id);
  if (!nivel) redirect("/");

  // Se traen las filas, aunque sólo se cuenten, porque «le falta algo» es una
  // regla de varias columnas que vive en una función y no en un filtro de SQL:
  // repetirla en una consulta sería la segunda copia. La tabla crece de a unas
  // pocas por semana. El `select` va literal para que Supabase infiera tipos.
  let resumen: ReturnType<typeof resumenDeCondiciones> | null = null;
  try {
    const filas = await traerTodo((desde, hasta) =>
      supabase
        .from("syh_condiciones")
        .select(
          "numero, sector_id, equipo_id, responsable_id, fecha_maxima, fecha_ejecucion, frecuencia, antecedentes, controles, magnitud_dano, legislacion"
        )
        .order("numero")
        .range(desde, hasta)
    );
    resumen = resumenDeCondiciones(filas, hoyEnArgentina());
  } catch {
    // «No se pudo contar» no es «hay cero»: la tarjeta dice un guión.
    resumen = null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Seguridad e Higiene</h1>
        <p className="text-sm text-slate-500">Tocá una tarjeta para trabajarla.</p>
      </div>

      <section>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            color={resumen && resumen.vencidas > 0 ? ALERTA : CONDICIONES}
            icon={<IconAviso />}
            label="Condiciones inseguras"
            value={resumen ? resumen.sinCompletar : "—"}
            sub={
              resumen ? (
                <>
                  sin completar
                  <br />
                  <span className={resumen.vencidas > 0 ? "font-semibold text-red-700" : ""}>
                    {resumen.vencidas} {resumen.vencidas === 1 ? "vencida" : "vencidas"}
                  </span>
                  {` · ${resumen.abiertas} abiertas de ${resumen.total}`}
                </>
              ) : (
                "no se pudieron contar"
              )
            }
            href="/seguridad-higiene/condiciones"
          />
        </div>
      </section>
    </div>
  );
}
