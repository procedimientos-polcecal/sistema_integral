import { createClient } from "@/lib/supabase/server";

export default async function UsuariosPage() {
  const supabase = await createClient();
  const { data: usuarios } = await supabase
    .from("usuarios")
    .select("id, email, nombre, apellido, rol, activo")
    .order("email");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
      <table className="w-full text-left text-sm">
        <thead className="border-b text-gray-500">
          <tr>
            <th className="py-2">Email</th>
            <th className="py-2">Nombre</th>
            <th className="py-2">Rol</th>
            <th className="py-2">Activo</th>
          </tr>
        </thead>
        <tbody>
          {(usuarios ?? []).map((u) => (
            <tr key={u.id} className="border-b">
              <td className="py-2">{u.email}</td>
              <td className="py-2">{u.nombre} {u.apellido}</td>
              <td className="py-2">{u.rol}</td>
              <td className="py-2">{u.activo ? "Sí" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
