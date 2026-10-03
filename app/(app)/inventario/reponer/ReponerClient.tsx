"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DIAS_DE_CONSUMO, type Candidato, type ConPedido } from "@/lib/inventario/reponer";
import { COMPRA_LABELS } from "@/lib/compras/constants";
import NuevoRequerimientoModal, {
  type ValoresIniciales,
} from "@/app/(app)/compras/requerimientos/NuevoRequerimientoModal";

type Opcion = { id: string; nombre: string };

/**
 * Qué reponer, en dos grupos.
 *
 * La separación es el punto. Arriba lo que hay que pedir; abajo lo que ya tiene
 * un pedido, diciendo cuál y de cuándo. Ocultar lo segundo dejaría a quien busca
 * algo que sabe que falta sin saber si el sistema no lo vio o si ya está pedido,
 * y son dos problemas con dos arreglos distintos.
 */
export default function ReponerClient({
  paraPedir, yaPedidos, areas, empresas, ubicaciones,
}: {
  paraPedir: Candidato[];
  yaPedidos: ConPedido[];
  areas: Opcion[];
  empresas: Opcion[];
  ubicaciones: Opcion[];
}) {
  const router = useRouter();
  const [pidiendo, setPidiendo] = useState<ValoresIniciales | null>(null);
  const [pedido, setPedido] = useState("");

  /**
   * Qué se le propone al formulario.
   *
   * La cantidad es el **stock de seguridad** y no el faltante, que es lo que ya
   * hace el Apps Script de la planilla, y lo medido le da la razón: se compra
   * por lote y no por diferencia —falta 2 pidió 4, falta 15 pidió 30, falta 1
   * pidió 10—. Ninguno de los pedidos reales pidió el faltante exacto.
   *
   * Todo es editable antes de enviar: esto propone, no decide.
   */
  const alta = (c: Candidato): ValoresIniciales => ({
    descripcion: c.articulo.descripcion,
    codigo: c.articulo.codigo,
    cantidad: String(c.articulo.stock_seguridad),
    detalle: `Reposición de stock. Había ${c.articulo.stock_actual} de un mínimo de ${c.articulo.stock_seguridad}.`,
  });

  return (
    // `max-w-4xl` como `ListaClient`, la pantalla vecina con el mismo ritmo de
    // secciones: sin tope, en escritorio la lista se estira de lado a lado y el
    // botón queda lejos de los datos que le corresponden.
    <div className="mx-auto max-w-4xl space-y-6 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Para reponer</h1>
        <p className="text-sm text-slate-500">
          Artículos por debajo del stock de seguridad que además se usaron en los
          últimos {DIAS_DE_CONSUMO} días. El que no se mueve hace meses no entra
          acá: está en{" "}
          <Link href="/inventario/stock?faltantes=1" className="underline hover:text-slate-700">
            el stock con faltante
          </Link>.
        </p>
      </div>

      {/* Arriba y no al final de la lista: son 17 filas o más, y quien aprieta
          Pedir en una del medio, parado en el pañol y con el celular en la mano,
          no ve lo que pasa debajo de la última. Sin esto la fila se va y no
          queda dicho adónde. */}
      {pedido && (
        <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          {pedido} Lo vas a ver en{" "}
          <Link href="/mis-pedidos" className="underline">Mis pedidos</Link>.
        </p>
      )}

      <section className="space-y-2">
        <h2 className="section-title">
          Para pedir <span className="font-normal text-slate-400">· {paraPedir.length}</span>
        </h2>

        {paraPedir.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
            {/* Dos vacíos distintos. «No hay nada para reponer» con 17 artículos
                faltando debajo es mentira: lo que falta existe, sólo que ya
                tiene pedido. */}
            {yaPedidos.length > 0
              ? "Lo que falta ya está pedido. Mirá abajo cuál es cada pedido."
              : "No hay nada para reponer."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {paraPedir.map((c) => (
              // Sin `flex-wrap`: acá el botón no compite con nada que valga la
              // pena bajar de línea. `Detalle` tiene base 0 y se queda con lo que
              // sobra al lado del botón (~230px a 375px de ancho).
              <li key={c.articulo.id} className="flex items-center gap-3 px-4 py-3">
                <Detalle c={c} />
                {/* `min-h-10` (40px) y no el `py-1.5` de un botón de tabla: se
                    aprieta con el pulgar, de pie, a veces con guantes. */}
                <button
                  onClick={() => setPidiendo(alta(c))}
                  className="min-h-10 shrink-0 rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                >
                  Pedir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {yaPedidos.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">
            Ya pedidos <span className="font-normal text-slate-400">· {yaPedidos.length}</span>
          </h2>
          <p className="text-xs text-slate-500">
            Faltan y se usan, pero ya tienen un pedido en curso. No hace falta
            volver a pedirlos.
          </p>

          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {yaPedidos.map((c) => {
              // Una sola vez: era la misma búsqueda dos veces en la misma línea,
              // una para el color y otra para el texto.
              const compra = COMPRA_LABELS[c.ri.estado_compra as keyof typeof COMPRA_LABELS];
              return (
                // Apilado, no `flex-wrap`. Con `flex-wrap` el `Detalle` tiene base 0
                // y el navegador lo deja en la misma línea que el bloque del RI,
                // dándole lo que sobra. Medido con una maqueta a 375px: con «RI
                // 1941 · hace 29 días · Pedido» el `Detalle` queda en 152px, y con
                // «3 pedidos abiertos» —que es el caso real del 00666— queda en
                // 37px: la descripción se corta en una letra y la fila mide 282px
                // de alto. Y no alcanza con ponerlo al lado desde `sm`: con el
                // menú lateral abierto (240px) el contenido a 768px es poco más de
                // 500px, el mismo problema. Dos líneas siempre es más corto que una
                // descripción ilegible, y acá no hay botón que compita.
                <li key={c.articulo.id} className="flex flex-col gap-1 px-4 py-3">
                  <Detalle c={c} />
                  <span className="text-xs text-slate-500">
                    <Link href={`/compras/requerimientos/${c.ri.id}`} className="underline hover:text-slate-900">
                      RI {c.ri.nro_ri}
                    </Link>
                    {" · "}
                    {c.diasDelRi === 0 ? "hoy" : `hace ${c.diasDelRi} días`}
                    {c.cuantosAbiertos > 1 && ` · ${c.cuantosAbiertos} pedidos abiertos`}
                    {" "}
                    <span className={`rounded px-1.5 py-0.5 ${compra?.color ?? "bg-gray-100 text-gray-600"}`}>
                      {compra?.label ?? "Sin iniciar"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* El formulario de Compras, tal cual: uno solo para los dos lados, así un
          campo que se agregue allá aparece acá sin que nadie se acuerde. Se
          abre, no se envía — el paso de aprobación que hoy da una persona
          apretando GENERAR PEDIDO en la planilla se conserva igual. */}
      {pidiendo && (
        <NuevoRequerimientoModal
          areas={areas}
          empresas={empresas}
          ubicaciones={ubicaciones}
          inicial={pidiendo}
          onClose={() => setPidiendo(null)}
          onSaved={() => {
            setPedido(`Pedido cargado: ${pidiendo.descripcion}.`);
            setPidiendo(null);
            // Sin esto la fila se queda en «Para pedir» con su botón, y quien
            // acaba de pedir lo ve y lo vuelve a apretar: un segundo RI. El alta
            // escribe la fila en la base en el momento (nace con el código y
            // `SIN_INICIAR`), así que al recargar los datos del servidor el
            // artículo ya cuenta como pedido y pasa solo a «Ya pedidos». No hay
            // que esperar ninguna sincronización con la planilla. Es lo mismo que
            // hace Mis pedidos después de un alta.
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** Lo que se ve de un artículo, igual en los dos grupos. */
function Detalle({ c }: { c: Candidato }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-slate-900">{c.articulo.descripcion}</p>
      <p className="text-xs text-slate-500">
        <span className="font-mono">{c.articulo.codigo}</span>
        {" · "}
        <span className={c.articulo.stock_actual === 0 ? "font-semibold text-red-600" : ""}>
          {c.articulo.stock_actual}
        </span>
        {" de un mínimo de "}{c.articulo.stock_seguridad}
        {" · "}
        {c.salidas === 1 ? "1 salida" : `${c.salidas} salidas`} en {DIAS_DE_CONSUMO} días
        {", la última "}
        {c.diasDesdeLaUltima === 0 ? "hoy" : `hace ${c.diasDesdeLaUltima} días`}
      </p>
    </div>
  );
}
