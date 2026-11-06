import InstalarClient from "./InstalarClient";

/**
 * Cómo instalar el SdG en el teléfono.
 *
 * No hay nada que traer del servidor: lo único que decide qué se muestra es el
 * navegador de quien mira. El acceso ya lo resolvió `app/(app)/layout.tsx`, que
 * manda al login a cualquiera sin sesión, y no hay permiso de módulo que pedir:
 * instalar la app lo puede hacer cualquiera que entre.
 */
export default function InstalarPage() {
  return <InstalarClient />;
}
