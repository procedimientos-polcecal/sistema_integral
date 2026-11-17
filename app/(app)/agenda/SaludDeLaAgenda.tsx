import type { LineaDeSalud } from "@/lib/agenda/avisosDeLaAgenda";

/**
 * La línea de estado de la conexión con Google, **sólo para `admin_sistema`**.
 *
 * Nació porque los dos avisos de salud de la Agenda —`agenda-pasos-caidos` y
 * `agenda-salud-sin-comprobar`— llevaban acá: un aviso que aterriza donde no hay
 * rastro del problema es el bug de las notificaciones que no llevaban a ningún
 * lado. Esos dos se retiraron el 05/11/2026 y ahora `canales` y `barrido` avisan
 * desde `avisosDeSalud` (`lib/home/avisos.ts`), que lleva a
 * `/administracion/salud` con los 29 recursos.
 *
 * **Esto se queda igual**: es el detalle de la Agenda, en la pantalla de la
 * Agenda, para `admin_sistema` que ya está acá y no viene de ningún aviso.
 *
 * Es un Server Component sin estado: lo que dibuja es lo que `lineasDeSalud`
 * decidió. Tres casos: la comprobación falló (rojo, y **dice que no se pudo
 * mirar**, no que esté caído ni sano), algún paso caído (rojo) y todo al día
 * (una línea gris, para que quien llegó por el aviso vea que ya pasó).
 */
export default function SaludDeLaAgenda({
  lineas,
  sinComprobar,
}: {
  lineas: LineaDeSalud[];
  sinComprobar: boolean;
}) {
  if (sinComprobar) {
    return (
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
        <strong>No se pudo comprobar</strong> si la Agenda sigue mirando Google: falló la lectura de las corridas del
        cron (el detalle está en el log del servidor). No quiere decir que esté caída ni que esté bien.
      </div>
    );
  }

  const hayCaidos = lineas.some((l) => l.estado !== "sana");
  return (
    <div
      className={`rounded-lg px-4 py-3 text-sm ${hayCaidos ? "bg-red-50 text-red-800" : "bg-gray-50 text-gray-600"}`}
      role={hayCaidos ? "alert" : undefined}
    >
      <p className="font-medium">
        Conexión con Google {hayCaidos ? "— hay pasos caídos" : "— al día"}{" "}
        <span className="font-normal opacity-70">(sólo lo ven los administradores del sistema)</span>
      </p>
      <ul className="mt-1 space-y-0.5">
        {lineas.map((l) => (
          <li key={l.paso}>
            <span className="font-medium">{l.etiqueta}:</span> {l.texto}
          </li>
        ))}
      </ul>
      {hayCaidos && (
        <p className="mt-1 text-xs opacity-80">
          El detalle completo, por casilla, está en la tabla <code>sincronizaciones</code> (módulo{" "}
          <code>agenda</code>).
        </p>
      )}
    </div>
  );
}
