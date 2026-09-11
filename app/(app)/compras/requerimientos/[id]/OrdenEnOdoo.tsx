"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  explicacionDeSugerencia,
  type MotivoDeSugerencia,
  type ProductoDeOdoo,
} from "@/lib/compras/productoOdoo";

/**
 * La orden de compra de este requerimiento en Odoo.
 *
 * Vive en su propio archivo y no dentro de `RequerimientoDetalle`, que ya tiene
 * 550 líneas. Es una sección con su propio estado —crear, ensayar, mostrar el
 * pendiente— y no comparte nada con el resto de la ficha.
 *
 * Por qué existe: si la orden está en Odoo, contabilidad genera la factura
 * **desde** la orden, con ítems, precios e impuestos ya puestos, en vez de
 * tipearla de cero. Eso es lo que hace lenta la carga de facturas hoy.
 *
 * La orden se crea y **se confirma**, para que quede lista para imprimir y
 * mandarle al proveedor. Confirmar no es postear: no se escribe ningún asiento
 * desde acá — eso lo sigue haciendo contabilidad en Odoo. El SdG propone, Odoo
 * confirma.
 */

export interface OrdenDeOdoo {
  empresa: string;
  odooOrderId: number;
  odooNombre: string | null;
  porcentaje: number;
  /** A la orden, en la instancia a la que apunta el sistema. */
  enlace: string | null;
}

/**
 * La forma del ensayo que importa acá: qué producto propone y con qué
 * catálogo arma el selector. El resto de lo que trae el `GET` (precio,
 * contexto, `armado`...) se muestra tal cual con `JSON.stringify` y no
 * necesita tipo.
 */
interface EnsayoDeOrden {
  producto?: {
    sugerencia: {
      producto: ProductoDeOdoo | null;
      motivo: MotivoDeSugerencia;
      alternativas: ProductoDeOdoo[];
    };
    catalogo: ProductoDeOdoo[];
  };
  [clave: string]: unknown;
}

/** El ensayo tal como se muestra: sin los 378 productos del catálogo. */
function sinElCatalogo(ensayo: EnsayoDeOrden): unknown {
  if (!ensayo.producto) return ensayo;

  const { catalogo, ...resto } = ensayo.producto;
  return { ...ensayo, producto: { ...resto, catalogo: `${catalogo.length} productos comprables` } };
}

export default function OrdenEnOdoo({
  requerimientoId,
  ordenes,
  pendiente,
  puedeEditar,
  odoo,
}: {
  requerimientoId: string;
  ordenes: OrdenDeOdoo[];
  /** Por qué no se pudo crear la última vez. Null si no hay nada pendiente. */
  pendiente: string | null;
  puedeEditar: boolean;
  /** A qué instancia se le escribe: producción y staging difieren en dos variables. */
  odoo?: { base: string; esStaging: boolean };
}) {
  const router = useRouter();
  const [trabajando, setTrabajando] = useState(false);
  const [motivos, setMotivos] = useState<string[]>([]);
  const [ensayo, setEnsayo] = useState<EnsayoDeOrden | null>(null);
  /** Lo que hay que decirle a quien apretó, cuando no es un fallo. */
  const [advertencia, setAdvertencia] = useState<string | null>(null);
  /** Qué orden está generando su PDF en Odoo, si hay alguna. */
  const [bajando, setBajando] = useState<number | null>(null);
  // El producto elegido en el selector, como string porque así lo maneja un
  // <select>. Vacío es el genérico: lo mismo que no mandar nada en el POST.
  const [productoId, setProductoId] = useState("");

  const yaEstan = ordenes.length > 0;

  async function crear() {
    setTrabajando(true);
    setMotivos([]);
    setAdvertencia(null);
    /*
     * El ensayo **no** se borra acá. Borrarlo hacía desaparecer el selector
     * apenas se apretaba, así que después de un fallo —que es justo cuando hay
     * que reintentar— la elección de producto se perdía y el reintento salía
     * con el genérico sin que nada lo dijera.
     */

    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/odoo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Sin producto elegido va vacío y la ruta busca lo aprendido para esta
      // descripción; si tampoco hay, usa el genérico.
      body: JSON.stringify(productoId ? { producto_id: Number(productoId) } : {}),
    });
    const body = await res.json().catch(() => ({}));
    setTrabajando(false);

    if (!res.ok) {
      // Los motivos vienen de la ruta y ya están escritos para leerse: dicen qué
      // hacer —"hay que dar de alta el proveedor en POLYSAN"— y no "error 422".
      setMotivos(body.motivos ?? [body.error ?? "No se pudo crear la orden en Odoo."]);
      // Igual se refresca: el pendiente quedó guardado en el requerimiento.
      router.refresh();
      return;
    }

    /*
     * Salió bien no siempre quiere decir que pasó lo que se pidió.
     *
     * Cuando la orden ya existía en Odoo, el push la reconoce y **no toca la
     * línea**: el producto que se acaba de elegir no se aplicó. Sin este aviso
     * la pantalla se quedaba en silencio y daba a entender lo contrario, que es
     * exactamente la forma de las trampas que este módulo ya pagó —el dato
     * aparece en el lugar que no es y se descubre meses después—.
     */
    const intactas: { odooNombre: string | null; odooOrderId: number }[] = (body.ordenes ?? [])
      .filter((o: { yaExistia?: boolean }) => o.yaExistia);

    const partes: string[] = [];

    if (productoId && intactas.length > 0) {
      const cuales = intactas.map((o) => o.odooNombre ?? `#${o.odooOrderId}`).join(" y ");
      partes.push(
        `La orden ${cuales} ya estaba en Odoo y no se modificó: el producto que elegiste ` +
          `no se aplicó. Si hay que cambiarlo, se cambia en Odoo, sobre la orden.`
      );
    }

    // Lo que quedó a medias del lado de Odoo —típicamente una orden que se
    // creó pero no se pudo confirmar—. Ya quedó en `odoo_pendiente`, pero el
    // que apretó tiene que enterarse ahora.
    partes.push(...((body.avisos ?? []) as string[]));

    if (partes.length) setAdvertencia(partes.join(" "));

    router.refresh();
  }

  /**
   * Bajar el PDF oficial de una orden.
   *
   * Va por `fetch` y no por un `<a href>` a secas porque la ruta contesta JSON
   * cuando algo falla: con un enlace común, un fallo de Odoo abriría una
   * pestaña con `{"error":…}` en vez de decirlo en la pantalla donde se apretó.
   * Y el nombre del archivo lo pone Odoo —`Orden de compra - P02420.pdf`—, así
   * que se saca de la cabecera en vez de inventarlo acá.
   */
  async function bajarPdf(odooOrderId: number, odooNombre: string | null) {
    setBajando(odooOrderId);
    setMotivos([]);

    try {
      const res = await fetch(
        `/api/compras/requerimientos/${requerimientoId}/odoo/pdf?orden=${odooOrderId}`
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMotivos([body.error ?? "No se pudo bajar el PDF de la orden."]);
        return;
      }

      const nombre =
        /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "";

      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre ? decodeURIComponent(nombre) : `${odooNombre ?? odooOrderId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMotivos([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBajando(null);
    }
  }

  async function ensayar() {
    setTrabajando(true);
    setMotivos([]);
    setAdvertencia(null);
    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/odoo`);
    const body: EnsayoDeOrden = await res.json().catch(() => ({ error: "No se pudo leer el ensayo." }));
    setEnsayo(body);
    // Arranca en lo que sugiere el emparejador; Compras lo puede cambiar antes
    // de crear. Sin sugerencia queda vacío, que es el genérico.
    setProductoId(String(body.producto?.sugerencia.producto?.id ?? ""));
    setTrabajando(false);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Orden de compra en Odoo
      </h2>

      {/*
        A cuál Odoo se le va a escribir, **siempre**.
        
        La primera versión sólo avisaba en staging, con el argumento de que un
        cartel permanente se vuelve invisible. El 09/09/2026 quedó claro que el
        argumento era malo: se crearon dos órdenes en la contabilidad real
        creyendo que iban a la de prueba, porque la ausencia de cartel no dice
        nada. Es la producción la que hay que poder ver antes de apretar.
      */}
      {odoo && (
        <p
          className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
            odoo.esStaging
              ? "border-violet-200 bg-violet-50 text-violet-900"
              : "border-slate-300 bg-slate-100 text-slate-800"
          }`}
        >
          {odoo.esStaging ? (
            <>
              <strong>Apuntando a STAGING</strong> — lo que se cree acá no llega a la
              contabilidad real.
            </>
          ) : (
            <>
              <strong>Apuntando a PRODUCCIÓN</strong> — lo que se cree acá es la
              contabilidad real del grupo.
            </>
          )}{" "}
          <span className="font-mono">{odoo.base}</span>
        </p>
      )}

      {yaEstan ? (
        <ul className="space-y-2">
          {ordenes.map((o) => (
            <li key={o.odooOrderId} className="flex items-baseline justify-between gap-2 text-sm">
              {/*
                El número va enlazado porque solo no identifica nada: staging es
                una copia y su secuencia quedó atrás, así que P02428 existe en
                las dos bases y son órdenes distintas. El enlace lleva a la que
                de verdad creó el sistema.
              */}
              {o.enlace ? (
                <a
                  href={o.enlace}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono font-semibold text-[var(--primary)] hover:underline"
                >
                  {o.odooNombre ?? `#${o.odooOrderId}`}
                </a>
              ) : (
                <span className="font-mono font-semibold text-slate-900">
                  {o.odooNombre ?? `#${o.odooOrderId}`}
                </span>
              )}
              <span className="flex items-baseline gap-3 text-xs text-slate-500">
                <span>
                  {o.empresa}
                  {o.porcentaje !== 100 && ` · ${o.porcentaje}%`}
                </span>
                {/*
                  El PDF es el de Odoo, generado en el momento: el mismo que
                  sale de Imprimir → Orden de compra. Si la orden todavía está
                  en borrador, Odoo lo titula "Solicitud de cotización" — es su
                  regla, no un error nuestro.
                */}
                <button
                  onClick={() => bajarPdf(o.odooOrderId, o.odooNombre)}
                  disabled={bajando !== null}
                  className="font-semibold text-[var(--primary)] hover:underline disabled:opacity-50"
                >
                  {bajando === o.odooOrderId ? "Generando…" : "Bajar el PDF"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">
          Todavía no está en Odoo. Crearla deja que contabilidad genere la factura desde la
          orden en vez de cargarla de cero.
        </p>
      )}

      {pendiente && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong className="block">Quedó pendiente:</strong>
          {pendiente}
        </div>
      )}

      {motivos.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {motivos.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      {advertencia && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {advertencia}
        </div>
      )}

      {/*
        El selector va junto al botón de crear, no en otra pantalla: se elige
        el producto y se manda en el mismo gesto. Sólo aparece después de
        ensayar, porque hasta entonces no hay catálogo con qué armarlo.
      */}
      {puedeEditar && ensayo?.producto && (
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Producto de Odoo para la línea
          </label>
          <select
            value={productoId}
            onChange={(e) => setProductoId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          >
            <option value="">ART. VARIOS (genérico)</option>
            {[...ensayo.producto.catalogo]
              .sort((a, b) => a.nombre.localeCompare(b.nombre))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {explicacionDeSugerencia(ensayo.producto.sugerencia)}
          </p>
          {/*
            Y lo que de verdad va, que después de tocar el selector deja de ser
            lo sugerido. Son dos hechos distintos y antes se contaban con una
            sola frase.
          */}
          {String(ensayo.producto.sugerencia.producto?.id ?? "") !== productoId && (
            <p className="mt-1 text-xs font-medium text-slate-700">
              Cambiado a mano: va{" "}
              {ensayo.producto.catalogo.find((p) => String(p.id) === productoId)?.nombre ??
                "ART. VARIOS"}
              .
            </p>
          )}
        </div>
      )}

      {puedeEditar && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={crear}
            disabled={trabajando}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {trabajando ? "Trabajando…" : yaEstan ? "Reintentar lo que falte" : "Crear la orden en Odoo"}
          </button>

          {/*
            El ensayo muestra exactamente lo que se le mandaría a Odoo, sin
            mandarlo. Está a la vista y no escondido en un menú: esto escribe en
            la contabilidad del grupo, y mirar antes es más barato que corregir
            una orden mal creada.
          */}
          <button
            onClick={ensayar}
            disabled={trabajando}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Ver qué se mandaría
          </button>
        </div>
      )}

      {/*
        El volcado es para leerlo antes de apretar, así que el catálogo no va:
        son 378 objetos que empujan los `vals` —lo único que de verdad hay que
        mirar— fuera de la pantalla. Lo sustituye la cuenta, que es lo que
        importa saber de él: si vino vacío, Odoo no contestó.
      */}
      {ensayo !== null && (
        <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
          {JSON.stringify(sinElCatalogo(ensayo), null, 2)}
        </pre>
      )}
    </section>
  );
}
