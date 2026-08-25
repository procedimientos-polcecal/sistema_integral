import Link from "next/link";

/**
 * Una cifra que se puede tocar.
 *
 * Es la ficha del dashboard de compras, sacada acá porque el tablero pasó a
 * estar hecho enteramente de estas: dos copias parecidas se separan con el
 * tiempo y terminan siendo dos cosas distintas en la misma pantalla.
 *
 * El pie es opcional y sirve para el dato de segundo orden —el monto
 * comprometido, en el tablero—, que acompaña a la cifra sin competirle.
 */
export default function Indicador({
  titulo, valor, href, acento, pie,
}: {
  titulo: string;
  valor: number;
  href: string;
  /** Clase de color para la cifra. Sin ella queda en el gris del texto. */
  acento?: string;
  pie?: React.ReactNode;
}) {
  return (
    <Link href={href} className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className={`mt-1 text-2xl font-bold ${acento ?? "text-slate-900"}`}>
        {valor.toLocaleString("es-AR")}
      </div>
      {pie && <div className="mt-0.5 font-mono text-xs text-slate-500">{pie}</div>}
    </Link>
  );
}
