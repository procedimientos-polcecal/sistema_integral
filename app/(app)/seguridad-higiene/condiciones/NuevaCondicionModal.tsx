"use client";

/*
 * Cargar una condición insegura desde la computadora.
 *
 * POR QUÉ EXISTE, QUE NO ES OBVIO: hasta el 02/11/2026 **el único lugar del
 * sistema desde donde se podía cargar una condición era `/cargar`**, la
 * pantalla sin señal, cuyo link vivía en el menú de Mantenimiento. O sea que
 * alguien con Seguridad e Higiene y sin Mantenimiento no tenía ningún camino,
 * y el módulo que reemplaza una planilla donde cualquiera anotaba lo que veía
 * se quedaba sin forma de anotar nada. El diseño había supuesto que el alta
 * siempre venía del teléfono.
 *
 * **ES EL MISMO FORMULARIO QUE EL DEL TELÉFONO**, a propósito: los seis campos
 * de `FormularioCondicionOffline`, con su foto y sus reglas. Dos formularios
 * para la misma alta son dos validaciones que se separan, y el de allá ya está
 * escrito contra el esquema de la ruta.
 *
 * Y manda por el mismo camino que todo lo demás: si el envío se cae por
 * conexión, la condición queda en la cola y sale sola. Eso no se decide acá
 * —lo decide `mandarOEncolar`— y por eso este archivo no tiene un `try`.
 */

import FormularioCondicionOffline from "@/app/cargar/FormularioCondicionOffline";
import { Modal } from "@/components/Modal";
import { mandarOEncolar } from "@/lib/core/mandarOEncolar";
import type { Catalogos } from "./FichaDeCondicion";

export default function NuevaCondicionModal({
  sectores,
  equipos,
  peligros,
  onCerrar,
  onCargada,
}: Pick<Catalogos, "sectores" | "equipos" | "peligros"> & {
  onCerrar: () => void;
  /** Se llama cuando la condición **entró**: lo que quedó en la cola todavía no es una fila. */
  onCargada: () => void;
}) {
  return (
    // El formulario no tiene botón «Cancelar» propio: sale por la X, el fondo o
    // Escape, y ninguna de las tres destruye nada que no se perdiera igual.
    <Modal titulo="Nueva condición insegura" alSalir={onCerrar}>
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          El número se lo pone el sistema. La evaluación del riesgo y el responsable
          se completan después, desde la ficha.
        </p>

        <FormularioCondicionOffline
          /*
           * Los catálogos de esta pantalla y los del teléfono tienen la misma
           * información con otros nombres —acá el equipo es `nombre`, allá es
           * `name` y trae `code`—, así que se traducen en vez de cambiarle la
           * forma a uno de los dos: el del teléfono la hereda de la ruta de
           * Mantenimiento que la bajó, y el de acá del `select` de este módulo.
           * Sólo los activos: un sector de baja no es un lugar donde cargar algo.
           */
          catalogos={{
            sectores: sectores
              .filter((s) => s.activo)
              .map((s) => ({ id: s.id, nombre: s.nombre, codigo: null })),
            equipos: equipos
              .filter((e) => e.activo)
              .map((e) => ({ id: e.id, code: null, name: e.nombre, sector_id: e.sector_id })),
            peligros: peligros.filter((p) => p.activo).map((p) => ({ id: p.id, nombre: p.nombre })),
          }}
          deshabilitado={false}
          onMandar={async (cuerpo) => {
            const salida = await mandarOEncolar("condicion", cuerpo);
            // Sólo lo que **entró** refresca la lista. Lo que quedó esperando
            // no es una fila todavía, y el formulario ya lo dice con el mismo
            // cartel que la pantalla sin señal.
            if (salida.estado === "mandada") onCargada();
            return salida;
          }}
        />
      </div>
    </Modal>
  );
}
