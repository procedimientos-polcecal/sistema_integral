import { avisoDeCuit } from "@/lib/compras/avisoDeCuit";
import { normalizarCuit } from "@/lib/core/cuit";

/**
 * La marca de «a este proveedor le falta el CUIT», al lado de su nombre.
 *
 * Va en los tres lugares donde se mira la comparativa —la tabla, la matriz de
 * decisión y las tarjetas del teléfono— porque el momento de elegir el
 * ganador es el último en el que la elección todavía se puede cambiar sin
 * costo: después viene la aprobación y recién ahí la generación de la orden,
 * que es la que hoy frena con «sin cuit» cuando ya está todo hecho.
 *
 * Es una marca y no un cartel: en la matriz hay una columna por proveedor y
 * un párrafo por columna rompería la comparación, que es la única razón por la
 * que esa pantalla existe. El texto entero va en el `title`.
 */
export default function MarcaSinCuit({ proveedor }: { proveedor: { cuit?: string | null } | null | undefined }) {
  const aviso = avisoDeCuit(proveedor);
  if (!aviso) return null;

  // Falta y está mal no son lo mismo, y la marca tiene que decir cuál de los
  // dos: ir a cargar un dato que ya está cargado manda a buscar al lugar
  // equivocado.
  const etiqueta = normalizarCuit(proveedor?.cuit ?? null) ? "· CUIT inválido" : "· sin CUIT";

  return (
    <span className="ml-1.5 text-xs font-normal text-amber-700" title={aviso}>
      {etiqueta}
    </span>
  );
}
