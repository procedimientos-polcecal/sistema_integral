/**
 * Lo que una carga de marcaciones dejó para mirar, en dos cosas que **no se
 * mezclan**: errores y pendientes. La usan los dos bloques de la pantalla, el de
 * Lenox y el del Excel, así que se ven igual en los dos.
 *
 * - **Errores** (rojo): algo no se cargó. Un legajo que el SdG no tiene,
 *   marcaciones ilegibles, un día que no se tocó. Alguien tiene que mirarlos
 *   ahora, y por eso la lista va abierta.
 * - **Pendientes** (ámbar): trabajo heredado que alguien tiene que hacer a mano
 *   —fichadas abiertas de antes, bajas sin cargar, gente activa sin reloj—.
 *   **No son un fallo de esta carga**, la carga salió bien. Si se mostraran en
 *   rojo junto a los errores, toda corrida arrancaría con decenas de "errores" y
 *   en una semana nadie leería ninguno de los dos. Van cerrados y con el texto
 *   que lo dice.
 */
export default function AvisosDeCarga({ errores, pendientes }: { errores: string[]; pendientes: string[] }) {
  if (errores.length === 0 && pendientes.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 text-sm">
      {errores.length > 0 && (
        <details open className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <summary className="cursor-pointer font-medium text-red-700">
            {errores.length} {errores.length === 1 ? "error" : "errores"}: algo no se cargó
          </summary>
          <ul className="mt-1 max-h-60 list-disc overflow-auto pl-5 text-red-800">
            {errores.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </details>
      )}
      {pendientes.length > 0 && (
        <details className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <summary className="cursor-pointer font-medium text-amber-800">
            {pendientes.length} {pendientes.length === 1 ? "pendiente" : "pendientes"} para revisar a mano
          </summary>
          <p className="mt-1 text-xs text-amber-800">
            No son errores: la carga salió bien. Es trabajo que quedó de antes y que alguien tiene que cerrar o cargar a mano.
          </p>
          <ul className="mt-1 max-h-60 list-disc overflow-auto pl-5 text-amber-900">
            {pendientes.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
