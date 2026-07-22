import Link from "next/link";
import { NAV, type NavItem } from "@/lib/core/nav";
import type { Modulo, Rol } from "@/lib/core/types";
import { logout } from "@/app/login/actions";

function visible(item: NavItem, modulos: Set<Modulo>, esAdmin: boolean): boolean {
  if (item.href === "/administracion") return esAdmin;
  if (!item.modulo) return true;
  return modulos.has(item.modulo);
}

export function Sidebar({
  modulos,
  rol,
  usuarioNombre,
}: {
  modulos: Modulo[];
  rol: Rol;
  usuarioNombre: string;
}) {
  const set = new Set(modulos);
  const esAdmin = rol === "admin_sistema" || rol === "admin";

  return (
    <aside className="flex w-64 flex-col bg-[#0A0F1C] text-gray-200">
      <div className="px-5 py-4 text-lg font-bold text-white">SdG</div>
      <nav className="flex-1 space-y-1 px-3">
        {NAV.filter((i) => visible(i, set, esAdmin)).map((item) => (
          <div key={item.href}>
            <Link
              href={item.href}
              className="block rounded px-3 py-2 text-sm hover:bg-white/10"
            >
              {item.label}
            </Link>
            {item.children && (
              <div className="ml-3 space-y-1">
                {item.children
                  .filter((c) => visible(c, set, esAdmin))
                  .map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      className="block rounded px-3 py-1.5 text-sm text-gray-400 hover:bg-white/10 hover:text-gray-200"
                    >
                      {c.label}
                    </Link>
                  ))}
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-5 py-4 text-sm">
        <div className="truncate text-gray-300">{usuarioNombre}</div>
        <form action={logout}>
          <button className="mt-2 text-xs text-gray-400 hover:text-white">
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}
