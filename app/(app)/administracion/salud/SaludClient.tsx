import {
  REGISTRO,
  haceCuantoCorto,
  type CorridaLeida,
  type EntradaDelRegistro,
  type EstadoDeRecurso,
  type FamiliaDeExcepcion,
  type SaludDelSistema,
} from "@/lib/core/saludDeLasSincronizaciones";

/**
 * La pantalla de la salud de las sincronizaciones: **adonde aterrizan** la
 * campana y el resumen diario, así que tiene que contestar, sin que nadie
 * tenga que ir a otro lado, las tres cosas por las que alguien llega acá:
 * cuándo corrió por última vez cada recurso, si está caído y **qué dijo al
 * fallar, sin traducir**. Un diagnóstico que no se distingue de otro no es un
 * diagnóstico, y eso ya costó una tarde entera en este sistema.
 *
 * **No lleva `"use client"` a pesar del nombre**: no tiene estado ni eventos, y
 * dibujada en el servidor la hora de «hace 5 h» y la de la lectura salen de la
 * misma `ahora`. El nombre es el de la tarea.
 *
 * Dos listas que no son decoración:
 *
 *  - **Los exceptuados**, con su familia y su porqué. Son lo primero que hay que
 *    mirar cuando un dato no llega —el mismo papel que las `pantalla` en
 *    `revisar-exportaciones`—: lo que acá no suena no es lo mismo que lo que está
 *    bien.
 *  - **Lo que la vista trae y el registro no nombra.** Es la defensa de que el
 *    registro no se quede atrás, y por eso se ve y no se traga: un recurso
 *    nuevo que nadie declaró no se vigila.
 *
 * **Cuando la comprobación misma falló no se dibuja ninguna fila vigilada.** Con
 * `corridas` vacío, cada recurso saldría «nunca corrió»: 29 mentiras en rojo en
 * vez de un «no se pudo mirar». Los exceptuados sí salen, porque su porqué no
 * depende de la lectura. **Y «sin declarar» sale como «no se sabe»**: la lista
 * llega vacía porque no se pudo armar, y una sección que desaparece se lee
 * «no hay ninguno». Ojo: esto sólo cubre una lectura que **falla**; una RLS que
 * tape la vista devuelve datos vacíos sin error y no se distingue desde acá —ver
 * `leerLaSalud`—.
 */

const ZONA = "America/Argentina/Buenos_Aires";

const claveDe = (modulo: string, recurso: string) => `${modulo}/${recurso}`;

/** «05/11/2026 08:00», en hora de Argentina. Una fecha ilegible se dice, no se inventa. */
function fechaCompleta(iso: string): string {
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) return `fecha ilegible («${iso}»)`;
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(cuando);
}

/** 36 → «36 h», 336 → «14 días». Sólo pasa a días cuando son días justos. */
function toleranciaLegible(horas: number): string {
  return horas >= 48 && horas % 24 === 0 ? `${horas / 24} días` : `${horas} h`;
}

const ETIQUETA_DE_ESTADO: Record<EstadoDeRecurso, string> = {
  fallo: "Falló",
  nunca: "Nunca corrió",
  vieja: "No corre",
  sana: "Al día",
};

const COLOR_DE_ESTADO: Record<EstadoDeRecurso, string> = {
  fallo: "bg-red-100 text-red-800",
  nunca: "bg-amber-100 text-amber-800",
  vieja: "bg-amber-100 text-amber-800",
  sana: "bg-emerald-100 text-emerald-800",
};

/** De peor a mejor, para que lo caído quede arriba. */
const ORDEN_DE_ESTADO: Record<EstadoDeRecurso, number> = { fallo: 0, nunca: 1, vieja: 2, sana: 3 };

const ETIQUETA_DE_FAMILIA: Record<FamiliaDeExcepcion, string> = {
  "solo-escribe-si-hay-algo": "Sólo escribe si hay algo que decir",
  "se-ve-en-otro-lado": "Se ve en otro lado",
  "apagado-a-proposito": "Apagado a propósito",
};

function Insignia({ estado }: { estado: EstadoDeRecurso }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_DE_ESTADO[estado]}`}>
      {ETIQUETA_DE_ESTADO[estado]}
    </span>
  );
}

/**
 * Una línea por recurso: su clave, cuándo corrió por última vez y, si falló,
 * **el texto exacto que quedó anotado**. `whitespace-pre-wrap` porque los
 * errores de Google traen saltos de línea, y `break-words` porque traen
 * identificadores sin un espacio donde cortar: en un teléfono de 343 px, uno
 * solo empujaría la pantalla entera hacia un costado.
 */
function LineaDeRecurso({
  modulo,
  recurso,
  corrida,
  ahora,
  racha,
}: {
  modulo: string;
  recurso: string;
  corrida: CorridaLeida | undefined;
  ahora: Date;
  /** Corridas fallidas seguidas, sólo si es más de una. */
  racha?: number;
}) {
  return (
    <div className="min-w-0 text-sm">
      <p className="break-words text-slate-600">
        <code className="text-xs text-slate-500">{claveDe(modulo, recurso)}</code>
        {" · "}
        {corrida ? (
          <>
            última corrida {fechaCompleta(corrida.created_at)}{" "}
            {/* Con la fecha ilegible, «fecha ilegible» ya está dicho arriba. */}
            {!Number.isNaN(new Date(corrida.created_at).getTime()) && (
              <span className="text-slate-500">({haceCuantoCorto(corrida.created_at, ahora)})</span>
            )}
          </>
        ) : (
          <span>no hay ninguna corrida suya en la vista</span>
        )}
        {racha && racha > 1 ? <strong className="text-red-800"> · {racha} corridas fallidas seguidas</strong> : null}
      </p>
      {corrida && !corrida.ok && (
        <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-800">
          {corrida.error ?? "falló sin dejar el motivo"}
        </pre>
      )}
    </div>
  );
}

export default function SaludClient({ salud, ahora: ahoraISO }: { salud: SaludDelSistema; ahora: string }) {
  const ahora = new Date(ahoraISO);
  const porClave = new Map(salud.corridas.map((c) => [claveDe(c.modulo, c.recurso), c]));
  const caidaDe = new Map(salud.caidas.map((c) => [c.clave, c]));

  const vigiladas = REGISTRO.filter(
    (e): e is Extract<EntradaDelRegistro, { toleranciaHoras: number }> => e.toleranciaHoras !== null
  );
  const exceptuadas = REGISTRO.filter((e) => e.toleranciaHoras === null);

  // El estado de una entrada es el de su peor recurso, y eso ya lo decidió
  // `entradasCaidas`: acá se lee y no se vuelve a calcular.
  const filas = vigiladas
    .map((entrada) => {
      const caida = caidaDe.get(claveDe(entrada.modulo, entrada.recursos[0]));
      return { entrada, caida, estado: (caida?.estado ?? "sana") as EstadoDeRecurso };
    })
    .sort((a, b) => ORDEN_DE_ESTADO[a.estado] - ORDEN_DE_ESTADO[b.estado]);

  const hayCaidas = salud.caidas.length > 0;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">Salud de las sincronizaciones</h1>
        <p className="text-sm text-slate-600">
          Cuándo corrió por última vez cada recurso y lo que dijo al fallar, tal cual quedó anotado. Sólo lo ven los
          administradores del sistema. Leído el {fechaCompleta(ahoraISO)} (hora de Argentina).
        </p>
      </header>

      {salud.sinComprobar ? (
        /*
         * **Es el único cartel que reemplaza a 29 filas que no se dibujan**, así
         * que no puede pesar lo mismo que el de «N de 29 con problemas»: borde
         * grueso, ícono y letra más grande. Y tiene que decir que **tampoco se
         * sabe lo que no está declarado**: `leerLaSalud` devuelve `sinDeclarar`
         * vacío cuando no pudo leer, y una lista que no aparece se lee «no hay
         * ninguno» cuando la verdad es «no se sabe».
         */
        <div
          className="flex gap-3 rounded-lg border-2 border-red-600 bg-red-50 px-4 py-4 text-red-900"
          role="alert"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="mt-0.5 h-6 w-6 shrink-0 text-red-600"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="min-w-0 space-y-1 text-base">
            <p className="text-lg font-bold">No se pudo comprobar la salud del sistema</p>
            <p>
              Falló la lectura de las corridas, y el detalle está en el log del servidor.{" "}
              <strong>No quiere decir que esté todo caído ni que esté todo bien: no se sabe.</strong>
            </p>
            <p>
              Por eso más abajo no se muestra el estado de ningún recurso, y <strong>tampoco se sabe si hay
              recursos sin declarar</strong>: esa lista no está vacía, está sin leer.
            </p>
          </div>
        </div>
      ) : (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${hayCaidas ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}
          role={hayCaidas ? "alert" : undefined}
        >
          {hayCaidas ? (
            <>
              <strong>
                {salud.caidas.length} de {vigiladas.length}
              </strong>{" "}
              entradas vigiladas con problemas. Arriba de todo están las que fallaron.
            </>
          ) : (
            <>
              <strong>Todo lo vigilado corrió dentro de su tolerancia.</strong> Los exceptuados y lo que no está
              declarado, abajo, no cuentan en esa frase.
            </>
          )}
        </div>
      )}

      {salud.sinComprobar && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Sin declarar</h2>
          <p className="rounded-lg border border-dashed border-red-300 px-4 py-3 text-sm text-red-900">
            <strong>No se sabe.</strong> Esta lista dice qué recursos trae la vista sin que nadie los vigile, y sin
            poder leer la vista no hay manera de armarla. Que acá no aparezca ninguno no quiere decir que no haya.
          </p>
        </section>
      )}

      {salud.sinDeclarar.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Sin declarar ({salud.sinDeclarar.length})</h2>
          <p className="text-sm text-slate-600">
            La vista trae estos recursos y <code>REGISTRO</code> no los nombra, ni vigilados ni exceptuados:{" "}
            <strong>nadie los está mirando</strong>. Declararlos es agregar una entrada en{" "}
            <code>lib/core/saludDeLasSincronizaciones.ts</code> diciendo cuánto silencio tolera cada uno, o por qué no
            se vigila.
          </p>
          <ul className="space-y-2">
            {salud.sinDeclarar.map((clave) => {
              const corrida = porClave.get(clave);
              const [modulo, ...resto] = clave.split("/");
              return (
                <li key={clave} className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                  <LineaDeRecurso
                    modulo={modulo}
                    recurso={resto.join("/")}
                    corrida={corrida}
                    ahora={ahora}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!salud.sinComprobar && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Lo que se vigila ({vigiladas.length})</h2>
          <ul className="space-y-2">
            {filas.map(({ entrada, caida, estado }) => (
              <li
                key={claveDe(entrada.modulo, entrada.recursos[0])}
                className={`space-y-2 rounded-lg border px-4 py-3 ${
                  estado === "sana" ? "border-slate-200 bg-white" : "border-red-200 bg-red-50/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{entrada.titulo}</p>
                    <p className="text-xs text-slate-500">
                      tolera hasta {toleranciaLegible(entrada.toleranciaHoras)} sin correr
                    </p>
                  </div>
                  <Insignia estado={estado} />
                </div>
                {entrada.recursos.map((recurso) => {
                  const esElQueFallo =
                    caida?.estado === "fallo" &&
                    caida.recursoQueFallo?.modulo === entrada.modulo &&
                    caida.recursoQueFallo.recurso === recurso;
                  return (
                    <LineaDeRecurso
                      key={recurso}
                      modulo={entrada.modulo}
                      recurso={recurso}
                      corrida={porClave.get(claveDe(entrada.modulo, recurso))}
                      ahora={ahora}
                      racha={esElQueFallo ? caida?.cuantoLlevaMal : undefined}
                    />
                  );
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">Exceptuados ({exceptuadas.length})</h2>
        <p className="text-sm text-slate-600">
          No se vigilan, y no por descuido: en cada uno la regla «una corrida vieja o fallida es un problema» daría
          una alarma falsa. <strong>Que acá no suenen no quiere decir que estén bien</strong>, así que son lo primero
          que hay que mirar cuando un dato no llega.
        </p>
        <ul className="space-y-2">
          {exceptuadas.map((entrada) => (
            <li key={claveDe(entrada.modulo, entrada.recursos[0])} className="space-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
              <Exceptuada entrada={entrada} porClave={porClave} ahora={ahora} sinComprobar={salud.sinComprobar} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Exceptuada({
  entrada,
  porClave,
  ahora,
  sinComprobar,
}: {
  entrada: EntradaDelRegistro;
  porClave: Map<string, CorridaLeida>;
  ahora: Date;
  sinComprobar: boolean;
}) {
  if (!entrada.excepcion) return null;
  const { familia, porque, quienLoLevanta } = entrada.excepcion;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="font-medium text-slate-900">{entrada.titulo}</p>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {ETIQUETA_DE_FAMILIA[familia]}
        </span>
      </div>
      <p className="text-sm text-slate-700">{porque}</p>
      {quienLoLevanta && (
        <p className="text-sm text-slate-700">
          <strong>Lo levanta:</strong> {quienLoLevanta}
        </p>
      )}
      {/* La última corrida y su error, aunque no se juzguen: es lo que hay que
          mirar cuando un dato de este recurso no llega. Si la lectura falló no
          hay nada que mostrar, y decir «no hay corrida» sería mentir. */}
      {!sinComprobar &&
        entrada.recursos.map((recurso) => (
          <LineaDeRecurso
            key={recurso}
            modulo={entrada.modulo}
            recurso={recurso}
            corrida={porClave.get(claveDe(entrada.modulo, recurso))}
            ahora={ahora}
          />
        ))}
    </>
  );
}
