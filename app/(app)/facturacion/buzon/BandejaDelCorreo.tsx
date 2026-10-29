"use client";

import { useRef, useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { POR_TANDA } from "@/lib/facturacion/sePuedeGuardarSola";

/**
 * Lo que llegó por mail y todavía nadie cargó.
 *
 * ## Por qué existe
 *
 * El lector del buzón lee solo el 98% de las facturas, y aun así el buzón tenía
 * **una sola factura cargada en tres semanas**. El cuello no era el lector: las
 * facturas llegan por mail y alguien tenía que bajar el PDF y arrastrarlo.
 *
 * Esta lista la llena un Apps Script desde la casilla de facturas. Acá cada
 * entrada tiene un botón que **baja el adjunto y lo mete en la misma cola** que
 * si lo hubieran arrastrado: el QR lo lee el navegador, igual que siempre. Esto
 * no cambia el lector, le acerca el archivo.
 *
 * ## Y un botón para descartar
 *
 * Porque no todo lo que llega adjunto es una factura. El filtro del webhook
 * saca los logos de las firmas por tamaño, pero un remito o un presupuesto
 * pasan — y tienen que poder sacarse de la lista sin borrarlos, o el script los
 * volvería a traer en la próxima corrida.
 */

interface Pendiente {
  id: string;
  adjunto: string;
  remitente: string | null;
  asunto: string | null;
  recibido_en: string | null;
  tamano_bytes: number | null;
  tipo: string | null;
  /** Link firmado y corto: el bucket es privado. `null` si el archivo no está. */
  url: string | null;
  /**
   * Null cuando se confirmó que es una factura. Con texto, entró igual sin
   * poder confirmarlo —casi siempre un PDF escaneado— y el texto dice por qué.
   */
  sin_confirmar: string | null;
}

export default function BandejaDelCorreo({
  onCargar,
}: {
  /** Mete el archivo en la cola del buzón, como si lo hubieran arrastrado. */
  onCargar: (
    archivos: File[],
    correoId?: string,
    opciones?: { correoIdPorArchivo?: (string | undefined)[]; guardarLasLimpias?: boolean }
  ) => void | Promise<void>;
}) {
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tanda, setTanda] = useState<{ bajados: number; total: number } | null>(null);
  /*
   * Un ref y no un estado: lo lee el bucle mientras corre, y un estado le
   * llegaría con el valor que tenía cuando arrancó.
   */
  const parar = useRef(false);

  // `useCargar` y no un efecto que llama y listo: descarta la respuesta que
  // llega tarde. Ver `lib/core/useCargar.ts`.
  const mirar = useCargar(async (vigente) => {
    try {
      const res = await fetch("/api/facturacion/correo");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "No se pudo leer la bandeja del correo.");
        return;
      }
      if (!vigente()) return;
      setPendientes(body.pendientes ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  /**
   * Baja el adjunto y lo manda a la cola.
   *
   * La entrada **no se saca de la lista acá**: se saca cuando la factura se
   * guardó de verdad. Sacarla al apretar la haría desaparecer aunque la carga
   * fallara, y esa factura quedaría sin cargar y sin que nadie lo supiera.
   */
  async function cargar(p: Pendiente) {
    if (!p.url) {
      setError(`El archivo de ${p.adjunto} no está en el bucket. Se puede descartar.`);
      return;
    }
    setOcupado(p.id);
    setError(null);
    try {
      const res = await fetch(p.url);
      if (!res.ok) throw new Error(`No se pudo bajar el adjunto (${res.status}).`);
      const blob = await res.blob();
      const archivo = new File([blob], p.adjunto, { type: p.tipo ?? blob.type });
      await onCargar([archivo], p.id);
      // Y se refresca: si la carga anduvo, esta entrada ya no está pendiente.
      setTimeout(() => mirar(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  /**
   * Baja las próximas `POR_TANDA` y las manda a la cola **para que se guarden
   * solas** las que el QR resolvió enteras.
   *
   * Es lo que vacía el buzón. Hasta el 29/10/2026 cada pendiente eran dos
   * clics en serie —uno acá, que baja y lee, y otro en la fila, que guarda— y
   * la bandeja deshabilitaba todo mientras una estaba en curso: con 398
   * pendientes eran 796 clics, y el sistema tenía 3 facturas cargadas.
   *
   * **De a 25 y no las 398**: leer un QR rasteriza la página a 3600 px y ocupa
   * el hilo del navegador. Todas de una dejarían la pestaña congelada varios
   * minutos sin poder parar, que es peor que el problema que esto resuelve.
   *
   * Qué se guarda solo y qué no lo decide `sePuedeGuardarSola`, que es pura y
   * está testeada. Acá va sólo bajar los archivos y llevar la cuenta.
   */
  async function cargarLaTanda() {
    const proximos = pendientes.filter((p) => p.url).slice(0, POR_TANDA);
    if (!proximos.length) return;

    parar.current = false;
    setError(null);
    setTanda({ bajados: 0, total: proximos.length });

    const archivos: File[] = [];
    const ids: (string | undefined)[] = [];
    const fallaron: string[] = [];

    for (const p of proximos) {
      if (parar.current) break;
      try {
        const res = await fetch(p.url!);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        archivos.push(new File([blob], p.adjunto, { type: p.tipo ?? blob.type }));
        ids.push(p.id);
      } catch (e) {
        /*
         * Un archivo que no baja no corta la tanda: se anota y sigue. Cortar
         * dejaría veinticuatro sin cargar por uno, que es la forma de fallar
         * que este botón viene a sacar.
         */
        fallaron.push(`${p.adjunto} (${e instanceof Error ? e.message : String(e)})`);
      }
      setTanda((t) => (t ? { ...t, bajados: t.bajados + 1 } : t));
    }

    if (fallaron.length) {
      setError(`No se pudieron bajar ${fallaron.length}: ${fallaron.join(" · ")}`);
    }

    if (archivos.length) {
      await onCargar(archivos, undefined, {
        correoIdPorArchivo: ids,
        guardarLasLimpias: true,
      });
    }

    setTanda(null);
    // La lista se vuelve a pedir una vez al final: las que se guardaron solas
    // ya no están pendientes.
    setTimeout(() => mirar(), 1500);
  }

  async function descartar(p: Pendiente) {
    const motivo = window.prompt(`¿Por qué no es una factura?\n\n${p.adjunto}`, "No es una factura");
    if (motivo === null) return;

    setOcupado(p.id);
    try {
      await fetch("/api/facturacion/correo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, estado: "descartada", motivo }),
      });
      setPendientes((antes) => antes.filter((x) => x.id !== p.id));
    } finally {
      setOcupado(null);
    }
  }

  if (cargando) return null;

  // Sin nada pendiente no se muestra un cartel vacío: el buzón ya tiene su
  // zona de arrastrar archivos y eso sigue siendo el camino normal.
  if (!pendientes.length && !error) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Llegaron por mail y falta cargarlas
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        {pendientes.length === 1
          ? "Hay 1 adjunto esperando."
          : `Hay ${pendientes.length} adjuntos esperando.`}{" "}
        Cargar baja el archivo y lo lee acá mismo, igual que si lo arrastraras.
      </p>

      {/*
        * El botón de la tanda, arriba y no al final de la lista: con 398
        * pendientes, al final no lo ve nadie.
        */}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
        {tanda ? (
          <>
            <span className="text-sm text-slate-700">
              Bajando {tanda.bajados} de {tanda.total}…
            </span>
            <button
              onClick={() => {
                parar.current = true;
              }}
              className="text-xs font-medium text-slate-600 underline"
            >
              Parar
            </button>
            <span className="text-xs text-slate-400">
              termina la que está en curso y no arranca la siguiente
            </span>
          </>
        ) : (
          <>
            <button
              onClick={() => void cargarLaTanda()}
              disabled={ocupado !== null || !pendientes.some((p) => p.url)}
              className="btn-primary text-sm disabled:opacity-40"
            >
              Cargar {pendientes.length > POR_TANDA ? `las próximas ${POR_TANDA}` : "todas"}
            </button>
            <span className="text-xs text-slate-500">
              Las que el QR resuelve enteras se guardan solas; las demás quedan abajo para que
              las mires, con el motivo.
            </span>
          </>
        )}
      </div>

      <ul className="space-y-2">
        {pendientes.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-slate-200 p-3"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800">{p.adjunto}</div>
              <div className="text-xs text-slate-500">
                {p.remitente ?? "sin remitente"}
                {p.recibido_en && ` · ${new Date(p.recibido_en).toLocaleDateString("es-AR")}`}
                {p.tamano_bytes !== null && ` · ${Math.round(p.tamano_bytes / 1024)} KB`}
              </div>
              {p.asunto && <div className="truncate text-xs text-slate-400">{p.asunto}</div>}
              {/*
                Los que no se pudieron confirmar entran igual —descartarlos
                sería perder veinte facturas por mes sin que nadie se entere—
                pero se ven distintos: no es lo mismo "esto es una factura" que
                "esto podría serlo".
              */}
              {p.sin_confirmar && (
                <div className="mt-1 text-xs text-amber-700">{p.sin_confirmar}</div>
              )}
            </div>

            <span className="flex shrink-0 items-baseline gap-3 text-xs">
              <button
                onClick={() => void cargar(p)}
                disabled={ocupado !== null || tanda !== null || !p.url}
                className="font-semibold text-[var(--primary)] hover:underline disabled:opacity-40"
              >
                {ocupado === p.id ? "Bajando…" : "Cargar"}
              </button>
              <button
                onClick={() => void descartar(p)}
                disabled={ocupado !== null || tanda !== null}
                className="text-slate-500 hover:underline disabled:opacity-40"
              >
                No es una factura
              </button>
            </span>
          </li>
        ))}
      </ul>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
