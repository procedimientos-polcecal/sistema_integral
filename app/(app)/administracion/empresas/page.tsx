import { createClient } from "@/lib/supabase/server";

export default async function EmpresasPage() {
  const supabase = await createClient();
  const { data: empresas } = await supabase
    .from("empresas")
    .select("id, nombre, sectores(nombre)")
    .order("nombre");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Empresas y sectores</h1>
      {(empresas ?? []).map((e) => (
        <div key={e.id}>
          <h2 className="font-semibold text-gray-800">{e.nombre}</h2>
          <ul className="ml-4 list-disc text-sm text-gray-600">
            {((e.sectores ?? []) as { nombre: string }[]).map((s) => (
              <li key={s.nombre}>{s.nombre}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
