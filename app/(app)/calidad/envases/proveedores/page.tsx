import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";

interface Proveedor {
  id: string;
  nombre: string;
  tipos: string | null;
  contacto_nombre: string | null;
  contacto_tel: string | null;
  cuit: string | null;
  proveedor_id: string | null;
}

/**
 * Los proveedores de envases y la referencia de color.
 *
 * Sin cliente: son tres tablas que se leen, sin filtros ni estado.
 */
export default async function ProveedoresDeEnvasesPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  if (!(await nivelCalidadDe(supabase, user.id))) redirect("/");

  const [{ data: proveedores }, { data: referencias }, { data: historial }] = await Promise.all([
    supabase
      .from("calidad_envases_proveedores")
      .select("id, nombre, tipos, contacto_nombre, contacto_tel, cuit, proveedor_id")
      .order("nombre"),
    supabase
      .from("calidad_envases_referencias")
      .select("id, color, proveedor_nombre")
      .order("orden"),
    supabase
      .from("calidad_envases_referencias_historial")
      .select("id, texto")
      .order("sheets_fila"),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 md:p-6">
      <section className="space-y-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Proveedores de envases</h1>
          <p className="text-sm text-slate-500">
            De la pestaña <code>PROVEEDORES</code> de la planilla.
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2">Qué provee</th>
                <th className="px-3 py-2">Contacto</th>
                <th className="px-3 py-2">CUIT</th>
              </tr>
            </thead>
            <tbody>
              {((proveedores ?? []) as Proveedor[]).map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-900">
                    {p.nombre}
                    {/* No está enganchado con el catálogo del núcleo. Se dice
                        porque tiene arreglo: cargarle el CUIT en `proveedores`.
                        Callarlo lo deja sin enganchar para siempre. */}
                    {!p.proveedor_id && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        sin enganchar
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{p.tipos}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {p.contacto_nombre} {p.contacto_tel}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.cuit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">De qué color es cada bolsón</h2>
          <p className="text-sm text-slate-500">
            La referencia es independiente del tamaño del bolsón.
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Color</th>
                <th className="px-3 py-2">Proveedor</th>
              </tr>
            </thead>
            <tbody>
              {((referencias ?? []) as { id: string; color: string; proveedor_nombre: string | null }[])
                .map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-900">{r.color}</td>
                    <td className="px-3 py-2 text-slate-500">{r.proveedor_nombre}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* El historial va debajo de la tabla y no escondido: la tabla sola
            miente sobre los bolsones viejos. Hoy el verde es de Bolsera, y hasta
            el 3/7/2026 era de Recuperadora del Sur. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm font-medium text-slate-700">Cambios</p>
          <p className="mt-1 text-xs text-slate-500">
            El color de hoy no es el de siempre: para saber de quién es un bolsón viejo
            hay que mirar acá.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {((historial ?? []) as { id: string; texto: string }[]).map((h) => (
              <li key={h.id}>{h.texto}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
