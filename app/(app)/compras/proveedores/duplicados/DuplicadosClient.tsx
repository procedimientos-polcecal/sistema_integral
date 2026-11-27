"use client";

import { useState } from "react";
import Link from "next/link";
import { useConfirm } from "@/components/ConfirmProvider";
import { useCargar } from "@/lib/core/useCargar";

/**
 * Fusionar los proveedores que están cargados dos veces.
 *
 * ── LO QUE LA PANTALLA TIENE QUE HACER ENTENDER ─────────────
 *
 * Que **cuál fila queda no se decide por la actividad sino por el nombre que
 * escribe la planilla de Compras**. `asegurarProveedores()` crea la fila que no
 * encuentra por nombre, así que borrar la que la planilla nombra sólo consigue
 * que vuelva vacía y sin CUIT, con los pedidos nuevos cayendo otra vez ahí.
 *
 * Por eso cada fila muestra tres cosas y no una: cuánto cuelga de ella, si está
 * enlazada a Odoo, y **si la planilla la nombra**. Mostrar sólo la primera
 * —que es la que uno miraría— lleva a elegir mal en los casos que importan:
 * «CANDIA» tiene 258 filas y no tiene CUIT, «Candia Rubén Horacio» tiene 1 y sí.
 *
 * ── LA SUGERENCIA ───────────────────────────────────────────
 *
 * Viene marcada la que la planilla nombra más veces, y si la planilla no
 * nombra a ninguna, la que más filas tiene. Está marcada y no decidida: el
 * botón dice el nombre de la que va a quedar, y el cartel de confirmación
 * repite qué se borra y cuánto se mueve. Es irreversible y se audita.
 */

interface Fila {
  id: string;
  nombre: string;
  cuit: string | null;
  razon_social: string | null;
  activo: boolean;
  cuelgan: Record<string, number>;
  total: number;
  enlazadoAOdoo: boolean;
  planilla: { laNombra: boolean; veces: number; ultimoRi: number } | null;
}

interface Grupo {
  motivo: "mismo cuit" | "nombre parecido";
  clave: string;
  nombresEnLaPlanilla: number | null;
  filas: Fila[];
}

/** Una ficha que no es un proveedor sino una celda con varios adentro. */
interface CeldaConVarios {
  id: string;
  nombre: string;
  partes: string[];
  cuelgan: Record<string, number>;
  total: number;
}

interface Respuesta {
  grupos: Grupo[];
  celdasConVarios: CeldaConVarios[];
  padron: number;
  planillaLeida: boolean;
  porQueNoSeLeyoLaPlanilla: string | null;
}

/** La que viene marcada: ver el docstring de arriba. */
function sugerida(filas: Fila[]): string {
  const ordenadas = [...filas].sort(
    (a, b) => (b.planilla?.veces ?? 0) - (a.planilla?.veces ?? 0) || b.total - a.total
  );
  return ordenadas[0]?.id ?? "";
}

export default function DuplicadosClient() {
  const confirm = useConfirm();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [elegida, setElegida] = useState<Record<string, string>>({});
  const [fusionando, setFusionando] = useState<string | null>(null);
  const [hechos, setHechos] = useState<string[]>([]);
  const [soloListos, setSoloListos] = useState(false);

  const recargar = useCargar(async (vigente) => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/compras/proveedores/duplicados");
      const body = await res.json();
      if (!vigente()) return;
      if (!res.ok) throw new Error(body.error ?? "No se pudieron traer los duplicados.");
      setDatos(body as Respuesta);
      const marcadas: Record<string, string> = {};
      for (const g of (body as Respuesta).grupos) marcadas[g.clave] = sugerida(g.filas);
      setElegida(marcadas);
    } catch (e) {
      if (vigente()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (vigente()) setCargando(false);
    }
  }, []);

  async function fusionar(grupo: Grupo) {
    const queda = elegida[grupo.clave];
    const laQueQueda = grupo.filas.find((f) => f.id === queda);
    const seVan = grupo.filas.filter((f) => f.id !== queda);
    if (!laQueQueda || !seVan.length) return;

    const mueve = seVan.reduce((a, f) => a + f.total, 0);
    const ok = await confirm({
      title: "Fusionar y borrar",
      message:
        `Queda «${laQueQueda.nombre}». Se borran ${seVan.map((f) => `«${f.nombre}»`).join(", ")} ` +
        `y sus ${mueve} ${mueve === 1 ? "fila pasa" : "filas pasan"} a la que queda.\n\n` +
        "Borrar un proveedor no se deshace. Queda registrado quién lo hizo.",
      confirmText: "Fusionar",
      danger: true,
    });
    if (!ok) return;

    setFusionando(grupo.clave);
    setError("");
    try {
      const res = await fetch("/api/compras/proveedores/fusionar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queda, seVan: seVan.map((f) => f.id) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo fusionar.");
      setHechos((previos) => [
        ...previos,
        `«${laQueQueda.nombre}» se quedó con ${seVan.length === 1 ? "la fila de" : "las filas de"} ` +
          `${seVan.map((f) => `«${f.nombre}»`).join(", ")}` +
          (body.camposMudados?.length ? ` y con su ${body.camposMudados.join(", ")}` : ""),
      ]);
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFusionando(null);
    }
  }

  const grupos = datos?.grupos ?? [];
  const listos = grupos.filter((g) => (g.nombresEnLaPlanilla ?? 0) <= 1);
  const aMostrar = soloListos ? listos : grupos;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/compras/proveedores" className="text-sm text-slate-500 hover:underline">
          ← Proveedores
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Proveedores cargados dos veces</h1>
        <p className="mt-1 text-sm text-slate-600">
          Mientras la misma empresa esté en dos filas, el cruce con Odoo no enlaza a ninguna de las
          dos y los pedidos se reparten entre las dos. Fusionarlas junta todo en una.
        </p>
      </div>

      <div className="card space-y-2 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">Cuál conviene dejar</p>
        <p>
          <strong>La que nombra la planilla de Compras</strong>, no la que tiene más datos. La
          sincronización crea la fila que no encuentra por nombre: si borrás la que la planilla
          nombra, vuelve vacía y sin CUIT en la corrida siguiente, y los pedidos nuevos caen otra
          vez ahí. Lo que le falte —el CUIT, la razón social— se lo lleva de la otra al fusionar.
        </p>
        {datos && !datos.planillaLeida && (
          <p className="text-amber-700">
            No se pudo leer la planilla, así que la columna que dice quién la nombra está vacía:{" "}
            {datos.porQueNoSeLeyoLaPlanilla}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {hechos.map((h, i) => (
        <div key={i} className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {h}
        </div>
      ))}

      {cargando && <p className="text-sm text-slate-500">Buscando duplicados…</p>}

      {datos && !cargando && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span>
            <strong>{grupos.length}</strong> {grupos.length === 1 ? "grupo" : "grupos"} en {datos.padron}{" "}
            proveedores
          </span>
          {datos.planillaLeida && (
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={soloListos}
                onChange={(e) => setSoloListos(e.target.checked)}
              />
              Sólo los {listos.length} que se pueden fusionar sin tocar la planilla
            </label>
          )}
        </div>
      )}

      {datos && !cargando && datos.celdasConVarios?.length > 0 && (
        <div className="card space-y-2">
          <p className="font-semibold text-slate-900">
            {datos.celdasConVarios.length} fichas que no son un proveedor
          </p>
          <p className="text-sm text-slate-600">
            Son celdas de la planilla con <strong>varios proveedores adentro</strong>, porque a ese
            pedido se le compró a más de uno y la columna PROVEEDOR los nombra a todos. La
            sincronización no sabe leer eso y toma la celda entera como un proveedor nuevo.{" "}
            <strong>No se arreglan desde acá</strong>: fusionarlas no las saca, porque mientras la
            celda diga lo mismo la próxima corrida las vuelve a crear. Lo que hay que decidir es a
            qué proveedor queda apuntando cada uno de esos pedidos.
          </p>
          <ul className="space-y-1 text-sm">
            {datos.celdasConVarios.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-slate-900">{c.nombre}</span>
                <span className="text-slate-500">
                  {c.partes.length} proveedores ·{" "}
                  <span title={detalleDeLoQueCuelga(c.cuelgan)}>
                    {c.total} {c.total === 1 ? "fila cuelga" : "filas cuelgan"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {datos && !cargando && grupos.length === 0 && (
        <p className="text-sm text-slate-600">No quedó ningún duplicado.</p>
      )}

      {aMostrar.map((grupo) => {
        const queda = elegida[grupo.clave];
        const dosNombres = (grupo.nombresEnLaPlanilla ?? 0) > 1;
        const laQueQueda = grupo.filas.find((f) => f.id === queda);

        return (
          <div key={grupo.clave} className="card space-y-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                  grupo.motivo === "mismo cuit"
                    ? "bg-slate-200 text-slate-700"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {grupo.motivo === "mismo cuit" ? "mismo CUIT" : "nombre parecido"}
              </span>
              <span className="font-mono text-sm text-slate-600">{grupo.clave}</span>
            </div>

            {dosNombres && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                La planilla escribe <strong>{grupo.nombresEnLaPlanilla} nombres distintos</strong> de
                esta empresa, así que la fila que borres va a volver a crearse. Unificá primero la
                columna PROVEEDOR allá y después fusioná acá.
              </p>
            )}

            <div className="space-y-2">
              {grupo.filas.map((fila) => (
                <label
                  key={fila.id}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${
                    fila.id === queda ? "border-[var(--primary)] bg-slate-50" : "border-slate-200"
                  }`}
                >
                  <input
                    type="radio"
                    name={grupo.clave}
                    checked={fila.id === queda}
                    onChange={() => setElegida((previo) => ({ ...previo, [grupo.clave]: fila.id }))}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold text-slate-900">{fila.nombre}</span>
                      {!fila.activo && <span className="text-xs text-slate-500">inactivo</span>}
                      {fila.id === queda && (
                        <span className="text-xs font-semibold text-[var(--primary)]">queda</span>
                      )}
                    </div>
                    <div className="text-sm text-slate-600">
                      {fila.cuit ? (
                        <span className="font-mono">{fila.cuit}</span>
                      ) : (
                        <span className="text-amber-700">sin CUIT</span>
                      )}
                      {fila.razon_social && <span className="ml-1.5">· {fila.razon_social}</span>}
                      {fila.enlazadoAOdoo && <span className="ml-1.5 text-green-700">· enlazado a Odoo</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      <span title={detalleDeLoQueCuelga(fila.cuelgan)}>
                        {fila.total} {fila.total === 1 ? "fila cuelga" : "filas cuelgan"} de esta ficha
                      </span>
                      {fila.planilla?.laNombra && (
                        <span className="ml-1.5 text-slate-700">
                          · <strong>la planilla la nombra</strong> {fila.planilla.veces}{" "}
                          {fila.planilla.veces === 1 ? "vez" : "veces"}
                          {fila.planilla.ultimoRi > 0 && `, hasta el RI ${fila.planilla.ultimoRi}`}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => fusionar(grupo)}
                disabled={fusionando !== null || !laQueQueda}
                className="btn-danger"
              >
                {fusionando === grupo.clave
                  ? "Fusionando…"
                  : `Dejar «${laQueQueda?.nombre ?? ""}» y borrar ${grupo.filas.length - 1}`}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** El desglose por tabla, para el `title`: en pantalla alcanza con el total. */
function detalleDeLoQueCuelga(cuelgan: Record<string, number>): string {
  const partes = Object.entries(cuelgan).map(([tabla, n]) => `${tabla}: ${n}`);
  return partes.length ? partes.join("\n") : "Nada: esta ficha no se usa en ninguna parte.";
}
