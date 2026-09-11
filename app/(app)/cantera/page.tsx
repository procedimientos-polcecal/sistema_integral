import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";

/**
 * La página de inicio del módulo: no opera nada, sólo linkea a cada sección.
 *
 * Antes `/cantera` era directamente el tablero (ahora en `/cantera/registros`)
 * y el sidebar desplegaba sus sub-páginas en un menú propio. El usuario pidió
 * lo contrario: clickear "Cantera" en el sidebar entra acá, y desde acá se
 * llega a cada sección — por eso en `lib/core/nav.ts` el ítem ya no tiene
 * `children` (así el sidebar lo renderiza como un link directo y no como un
 * desplegable). Sin interactividad: no hace falta un componente de cliente.
 */
export default async function CanteraInicioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosCanteraDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const tarjetas = [
    {
      titulo: "Registros",
      descripcion: "Perforaciones, voladuras y bochones de todas las canteras: cargar, editar y conciliar facturas.",
      href: "/cantera/registros",
    },
    {
      titulo: "Informe mensual",
      descripcion: "Histórico con gráficos y exportación a Excel para armar el informe del mes.",
      href: "/cantera/informes",
    },
    ...(permisos.esAdmin
      ? [
          {
            titulo: "Canteras",
            descripcion: "El catálogo de yacimientos: código, material, densidad y malla de diseño.",
            href: "/cantera/yacimientos",
          },
          {
            titulo: "Insumos",
            descripcion: "El catálogo de insumos de voladura y su precio USD vigente.",
            href: "/cantera/insumos",
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold">Cantera</h1>
      <p className="mt-1 text-sm text-slate-500">Elegí una sección.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tarjetas.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="card group flex flex-col gap-1 p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">{t.titulo}</h2>
              <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400">→</span>
            </div>
            <p className="text-sm text-slate-500">{t.descripcion}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
