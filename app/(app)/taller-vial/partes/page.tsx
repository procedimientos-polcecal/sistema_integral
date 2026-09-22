import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTallerVialDe } from "@/lib/tallerVial/auth";
import { traerPartesTallerVial } from "@/lib/tallerVial/consultas";

const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

/**
 * Los partes diarios de equipos móviles importados del Google Form "PARTE
 * DIARIO EQUIPOS MÓVILES" — sólo lectura, se escriben desde el cron
 * (`lib/tallerVial/importarPartes.ts`), no hay pantalla de carga. Últimos
 * 60 días.
 *
 * El estado de cada fila avisa, en vez de esconder, cuándo un bloque de
 * destape no se pudo vincular a Cantera (equipo u operario sin resolver) —
 * mismo criterio que el resto del sistema con un enlace que no se pudo
 * armar con certeza.
 */
export default async function PartesTallerVialPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosTallerVialDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request, no en cada render
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - 60 * 86400000).toISOString().slice(0, 10);

  const partes = await traerPartesTallerVial(supabase, { desde });

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/taller-vial" className="text-xs text-slate-500 underline">← Taller Vial</Link>
      <h1 className="mt-1 text-xl font-semibold">Partes diarios</h1>
      <p className="mt-1 text-sm text-slate-500">
        Últimos 60 días, importados del formulario de partes diarios de equipos móviles. No se cargan desde acá.
      </p>

      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100">
              {["Fecha", "Operario", "Equipo", "Sector", "Horario", "Horas", "Estado"].map((c) => (
                <th key={c} className="px-3 py-2 text-left text-xs font-semibold text-slate-600">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {partes.map((p, i) => (
              <tr key={p.id} style={{ backgroundColor: i % 2 === 1 ? "#F8FAFC" : undefined }}>
                <td className="px-3 py-2 text-slate-700">{p.fecha}</td>
                <td className="px-3 py-2">{p.operario_raw}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{p.equipo_raw}</td>
                <td className="px-3 py-2">{p.sector_raw}</td>
                <td className="px-3 py-2 font-mono tabular-nums text-slate-500">
                  {p.hora_inicio && p.hora_fin ? `${p.hora_inicio}–${p.hora_fin}` : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{p.horas !== null ? num1.format(p.horas) : "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {!p.yacimiento_destape_codigo ? (
                    <span className="text-slate-400">— no es destape</span>
                  ) : p.destape_id ? (
                    <Link href={`/cantera/destape?mes=${p.fecha.slice(0, 7)}`} className="text-emerald-700 underline">
                      ✅ vinculado a Destape
                    </Link>
                  ) : (
                    <span className="text-amber-700">⚠ sin resolver operario/equipo</span>
                  )}
                </td>
              </tr>
            ))}
            {partes.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Sin partes cargados en los últimos 60 días.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
