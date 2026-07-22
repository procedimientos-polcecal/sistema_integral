import Link from "next/link";

export default function AdministracionPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Administración</h1>
      <ul className="space-y-2">
        <li>
          <Link className="text-blue-700 hover:underline" href="/administracion/usuarios">
            Usuarios y permisos
          </Link>
        </li>
        <li>
          <Link className="text-blue-700 hover:underline" href="/administracion/empresas">
            Empresas y sectores
          </Link>
        </li>
      </ul>
    </div>
  );
}
