"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmProvider, useConfirm } from "@/components/ConfirmProvider";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { haceCuanto } from "@/lib/core/haceCuanto";
import { useCargar } from "@/lib/core/useCargar";
import { pedirVaciadoAhora, pedirVaciadoEnSegundoPlano } from "@/lib/core/vaciarLaCola";
import {
  comoSeLlama,
  despuesDelIntento,
  paradas,
  puedeEmpujarla,
  queHacerConLaNueva,
  tomarLaCarga,
} from "@/public/cola/colaOffline.js";
import type { CargaEnCola, TipoDeCarga } from "@/public/cola/colaOffline.js";
import {
  actualizarCarga,
  borrarCarga,
  guardarCarga,
  leerCola,
} from "@/public/cola/idb.js";
import {
  SIN_CATALOGOS,
  catalogosGuardados,
  genteConocida,
  recordarLaSesion,
  refrescarCatalogos,
  sesionRecordada,
  type Catalogos,
  type GenteConocida,
  type SesionRecordada,
} from "./catalogos";
import { loQueDijo, mandarALaRuta, type Resultado } from "./envio";
import FormularioAvisoOffline from "./FormularioAvisoOffline";
import FormularioOTOffline from "./FormularioOTOffline";

/** En qué estado quedó la lectura del teléfono al abrir la pantalla. */
type Arranque = "leyendo" | "listo" | "sin-almacenamiento";

/**
 * La pantalla que anda sin señal: dos formularios y lo que está esperando.
 *
 * TODO SALE DEL TELÉFONO. Los desplegables son los que quedaron guardados en
 * IndexedDB, quién es la sesión también, y la cola es lo que todavía no pudo
 * salir. Con señal se refresca todo y las cargas van derecho a las rutas de
 * siempre; sin señal quedan acá abajo, a la vista.
 *
 * LO QUE NO PUEDE PASAR es que una carga parezca hecha cuando no lo está. De
 * ahí salen las dos reglas que gobiernan este archivo:
 *
 * - **Sin dónde guardar no se acepta nada.** Si IndexedDB no abre —Safari en
 *   modo privado, almacenamiento lleno— los dos formularios quedan
 *   deshabilitados y la pantalla dice por qué. Ninguna función de `idb.js` se
 *   traga su error, a propósito, justamente para que esto se pueda hacer.
 * - **Sin saber de quién sería la carga tampoco.** Una carga se manda sólo bajo
 *   la sesión que la escribió —la planilla queda firmada con esa persona—, así
 *   que una carga sin dueño no podría salir nunca. Aceptarla sería guardarla
 *   para siempre.
 *
 * De la cola se sale por dos caminos, y los dos existen. A mano, con el botón
 * «Mandar ahora» de cada carga, que es el único que hay en un iPhone con la app
 * cerrada. Y solo, cuando el service worker se despierta, que esta pantalla le
 * pide dos veces: al guardar una carga (`pedirVaciadoEnSegundoPlano`, que en
 * Android lo despierta cuando vuelva la señal aunque nadie abra nada) y cuando
 * la señal vuelve con la pantalla abierta (`pedirVaciadoAhora`, que es el único
 * de los dos que funciona en un iPhone).
 */
export default function CargarClient() {
  const [arranque, setArranque] = useState<Arranque>("leyendo");
  const [problemaDeAlmacenamiento, setProblemaDeAlmacenamiento] = useState("");
  const [sesion, setSesion] = useState<SesionRecordada | null>(null);
  // Si ya se terminó de averiguar quién es. Sin esto, el cartel de «este
  // teléfono no sabe quién sos» aparecía unos segundos con señal mala y después
  // se iba solo: un susto injustificado, en la pantalla que menos lo aguanta.
  const [sesionResuelta, setSesionResuelta] = useState(false);
  const [gente, setGente] = useState<GenteConocida>({});
  const [catalogos, setCatalogos] = useState<Catalogos>(SIN_CATALOGOS);
  const [cola, setCola] = useState<CargaEnCola[]>([]);
  const [enLinea, setEnLinea] = useState(true);
  const [queFormulario, setQueFormulario] = useState<TipoDeCarga>("aviso");
  const [avisoDeLaCola, setAvisoDeLaCola] = useState("");

  const releerLaCola = useCallback(async () => {
    try {
      setCola(await leerCola());
    } catch (e) {
      // La base andaba y dejó de andar: el almacenamiento se llenó entre una
      // carga y la siguiente. Se apaga la pantalla igual que al arrancar.
      setProblemaDeAlmacenamiento(loQueDijo(e));
      setArranque("sin-almacenamiento");
    }
  }, []);

  const volverALeer = useCargar(async (vigente) => {
    setEnLinea(navigator.onLine);

    // La cola primero, y no por orden de importancia: es la lectura que prueba
    // que la base abre. Si rechaza no hay dónde guardar una carga, y aceptar
    // una sería perderla sin que nadie se entere.
    let guardadas: CargaEnCola[];
    try {
      guardadas = await leerCola();
    } catch (e) {
      if (!vigente()) return;
      setProblemaDeAlmacenamiento(loQueDijo(e));
      setArranque("sin-almacenamiento");
      return;
    }
    if (!vigente()) return;
    setCola(guardadas);

    // Acá un fallo ya no apaga la pantalla: la cola se leyó, o sea que la base
    // abre. Lo que falte queda vacío, que se ve, y se vuelve a bajar con señal.
    const [guardados, recordada, conocida] = await Promise.all([
      catalogosGuardados().catch(() => SIN_CATALOGOS),
      sesionRecordada().catch(() => null),
      genteConocida().catch(() => ({}) as GenteConocida),
    ]);
    if (!vigente()) return;
    setCatalogos(guardados);
    setSesion(recordada);
    setGente(conocida);
    setArranque("listo");

    // Con señal se refresca. Sin señal, lo guardado es lo que hay — y es
    // exactamente para esto que se guardó.
    if (!navigator.onLine) {
      setSesionResuelta(true);
      return;
    }

    const ahora = await recordarLaSesion();
    if (!vigente()) return;
    if (ahora) {
      setSesion(ahora);
      setGente((previa) => ({ ...previa, [ahora.id]: ahora.nombre }));
    }
    setSesionResuelta(true);

    const frescos = await refrescarCatalogos(guardados);
    if (!vigente()) return;
    setCatalogos(frescos);
  }, []);

  useEffect(() => {
    const alCambiarLaConexion = () => {
      const hay = navigator.onLine;
      setEnLinea(hay);
      // Con la señal de vuelta se vuelve a leer todo: los catálogos quedaron
      // viejos, la sesión puede haberse renovado y la cola puede haber cambiado
      // en otra pestaña o la puede haber vaciado el service worker.
      //
      // Y SE PIDE EL VACIADO, QUE EN UN IPHONE ES LA ÚNICA VEZ QUE SE PUEDE.
      // El pedido de `encolar` es `pedirVaciadoEnSegundoPlano`, o sea Background
      // Sync, que Safari no implementa: para medio equipo ahí no quedó pedido
      // nada. Acá están las dos condiciones que `pedirVaciadoAhora` necesita y
      // que casi nunca se dan juntas —la pantalla abierta y la señal de
      // vuelta—, así que desaprovecharlas sería dejar la cola quieta con la
      // persona mirándola.
      //
      // **Esta pantalla sigue sin mandar nada por su cuenta**: le pide al
      // service worker que corra **su** vaciado. Un segundo lugar que decidiera
      // cuándo sale una carga sería las mismas reglas escritas dos veces.
      if (hay) {
        void pedirVaciadoAhora();
        volverALeer();
      }
    };
    window.addEventListener("online", alCambiarLaConexion);
    window.addEventListener("offline", alCambiarLaConexion);
    return () => {
      window.removeEventListener("online", alCambiarLaConexion);
      window.removeEventListener("offline", alCambiarLaConexion);
    };
  }, [volverALeer]);

  const encolar = useCallback(
    async (
      carga: CargaEnCola,
      motivo: string | null,
      fechaDelReloj: boolean,
    ): Promise<Resultado> => {
      try {
        await guardarCarga(carga);
      } catch (e) {
        return {
          estado: "rechazada",
          error:
            `No se pudo guardar la carga en el teléfono: ${loQueDijo(e)}. ` +
            `No quedó anotada en ningún lado, así que no se cargó nada.`,
          fechaDelReloj,
        };
      }
      // Recién con la carga guardada: pedirlo antes dejaría registrado un
      // vaciado para una cola a la que no entró nada. Y acá y no sólo en la
      // barra del layout, porque esa barra **no se monta en esta pantalla** —
      // `/cargar` vive fuera del grupo `(app)`, justamente para poder dibujarse
      // sin servidor—, así que éste es el único lugar del camino que importa
      // desde donde se puede pedir. En Android es lo que hace que la carga
      // salga sola cuando vuelva la señal, con la app cerrada; en iPhone no
      // hace nada y falla callado, porque no es algo que la persona pueda
      // arreglar.
      void pedirVaciadoEnSegundoPlano();
      await releerLaCola();
      return { estado: "encolada", motivo };
    },
    [releerLaCola],
  );

  const mandar = useCallback(
    async (tipo: TipoDeCarga, cuerpo: Record<string, unknown>): Promise<Resultado> => {
      // UNA CLAVE POR CARGA, generada acá y **nunca derivada del contenido**:
      // dos avisos iguales el mismo día son dos avisos y no un duplicado. Es la
      // misma clave en cada reintento, y es lo que hace que el servidor
      // reconozca al reintento en vez de escribir una segunda fila con un
      // segundo número.
      const clave = crypto.randomUUID();
      const laPusoUnaPersona = typeof cuerpo.fecha === "string" && cuerpo.fecha !== "";
      const cuerpoCompleto = {
        ...cuerpo,
        clave,
        // La fecha que viaja es la del día en que se cargó, no la del día en
        // que entra: un aviso del viernes que recién llega el lunes dice
        // viernes, porque de esa fecha salen el historial del equipo y el MTBF.
        // El formulario de OT la pregunta («Fecha creación») y el de aviso no,
        // así que acá se completa con hoy cuando no vino. Las dos rutas
        // rechazan con 400 una fecha futura o ilegible, y para la cola un 400
        // es definitivo: esa carga queda parada y a la vista.
        fecha: laPusoUnaPersona ? cuerpo.fecha : hoyEnArgentina(),
      };

      const carga: CargaEnCola = {
        clave,
        tipo,
        cuerpo: cuerpoCompleto,
        usuarioId: sesion?.id ?? "",
        creadaEn: new Date().toISOString(),
        tomadaEn: null,
        intentos: 0,
        ultimoError: null,
        estado: "esperando",
      };

      // `null` es "ni se intentó": sin señal va derecho a la cola. Qué hacer
      // con lo que haya contestado el servidor lo decide `queHacerConLaNueva`,
      // que es pura y está probada; acá sólo se ejecuta lo que dijo.
      const respuesta = navigator.onLine ? await mandarALaRuta(tipo, cuerpoCompleto) : null;
      const queHacer = queHacerConLaNueva(respuesta);

      if (queHacer.accion === "listo") {
        return {
          estado: "mandada",
          numero: queHacer.numero,
          advertencia: queHacer.advertencia,
        };
      }
      if (queHacer.accion === "rechazar") {
        // El texto de la ruta, sin traducir.
        return {
          estado: "rechazada",
          error: queHacer.error,
          fechaDelReloj: !laPusoUnaPersona,
        };
      }
      return await encolar(
        { ...carga, intentos: queHacer.intentos, ultimoError: queHacer.ultimoError },
        queHacer.ultimoError,
        !laPusoUnaPersona,
      );
    },
    [sesion, encolar],
  );

  const reintentar = useCallback(
    async (carga: CargaEnCola) => {
      setAvisoDeLaCola("");

      // La regla entera la contesta `puedeEmpujarla`, y eso es el arreglo: acá
      // se copiaba a mano sólo la primera de sus tres condiciones —"es mía"— y
      // se perdían las otras dos. Una carga `parada` se mandaba igual sin que
      // nadie lo hubiera decidido, y la marca de tomada no se miraba nunca, así
      // que dos pestañas podían mandar lo mismo.
      if (!puedeEmpujarla(carga, sesion?.id ?? null, new Date())) {
        setAvisoDeLaCola(
          sesion && carga.usuarioId === sesion.id
            ? "Esa carga la está mandando otra pestaña o el service worker. Esperá un rato y fijate de nuevo."
            : "Esa carga no es de esta sesión: se manda cuando vuelva a entrar quien la hizo.",
        );
        return;
      }

      try {
        // Queda tomada mientras sale, que es lo que evita que dos disparos
        // manden lo mismo. `puedeEmpujarla` lee esa marca, y
        // `MINUTOS_PARA_SOLTAR` la suelta si esto muere a mitad de camino.
        await actualizarCarga(carga.clave, tomarLaCarga(carga, new Date()));
        await releerLaCola();

        // Todo lo que hay que hacer sale de `despuesDelIntento`: acá no se
        // vuelve a mirar la respuesta, porque volver a mirarla es volver a
        // decidir. `borrar-y-avisar` es un veredicto aparte justamente para que
        // no se pueda borrar la carga sin decir lo que quedó a medias.
        const queHacer = despuesDelIntento(await mandarALaRuta(carga.tipo, carga.cuerpo));

        if (queHacer.accion === "borrar") {
          await borrarCarga(carga.clave);
          setAvisoDeLaCola(`Se mandó: ${comoSeLlama(carga.tipo)} ${queHacer.numero}.`);
        } else if (queHacer.accion === "borrar-y-avisar") {
          await borrarCarga(carga.clave);
          setAvisoDeLaCola(
            `Se mandó: ${comoSeLlama(carga.tipo)} ${queHacer.numero}. ${queHacer.advertencia}`,
          );
        } else {
          await actualizarCarga(carga.clave, queHacer.cambios);
        }
      } catch (e) {
        setAvisoDeLaCola(`No se pudo tocar la cola del teléfono: ${loQueDijo(e)}`);
        // La marca de tomada no puede quedar puesta por un error de acá: la
        // carga quedaría trabada `MINUTOS_PARA_SOLTAR` minutos por algo que ya
        // terminó. Si esto también falla, la suelta ese plazo.
        await actualizarCarga(carga.clave, { tomadaEn: null }).catch(() => {});
      }
      await releerLaCola();
    },
    [sesion, releerLaCola],
  );

  const borrar = useCallback(
    async (carga: CargaEnCola) => {
      setAvisoDeLaCola("");
      try {
        await borrarCarga(carga.clave);
      } catch (e) {
        setAvisoDeLaCola(`No se pudo borrar la carga: ${loQueDijo(e)}`);
      }
      await releerLaCola();
    },
    [releerLaCola],
  );

  const sinDondeGuardar = arranque === "sin-almacenamiento";
  // El cartel sólo cuando ya se terminó de preguntar: antes, lo único cierto es
  // que todavía no se sabe, y decir «no sabe quién sos» en el medio asusta sin
  // motivo.
  const sinSesion = arranque === "listo" && sesionResuelta && !sesion;
  const averiguandoQuienSos = arranque === "listo" && !sesionResuelta && !sesion;
  const deshabilitado = arranque !== "listo" || !sesion;

  return (
    <main className="mx-auto w-full max-w-xl space-y-4 p-4">
      <header>
        <h1 className="text-lg font-bold text-slate-900">Cargar sin señal</h1>
        <p className="mt-1 text-sm text-slate-600">
          Un aviso o una orden de trabajo de Mantenimiento. Si no hay señal,
          queda esperando acá abajo hasta que vuelva.
        </p>
      </header>

      {/* Dice lo que es y no más. Con señal, lo que se cargue **ahora** sale
          derecho. Lo que ya estaba esperando **puede** salir solo —el service
          worker vacía la cola cuando lo despiertan— pero eso no se promete acá:
          en un iPhone el único disparo es abrir la app, y decir «sale al toque»
          con cinco cargas en la lista sería prometer lo que no se controla. El
          botón de cada una sí es cierto siempre. */}
      <div
        className={`rounded-lg px-3 py-2 text-sm font-medium ${
          enLinea ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-700"
        }`}
      >
        <p>
          {enLinea
            ? "Con señal: lo que cargues ahora sale derecho."
            : "Sin señal: lo que cargues queda esperando acá abajo."}
        </p>
        {enLinea && cola.length > 0 && (
          <p className="mt-0.5 text-xs font-normal">
            Lo que ya estaba esperando sale con el botón de cada una.
          </p>
        )}
      </div>

      {sinDondeGuardar && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p className="font-semibold">
            Este navegador no deja guardar nada en el teléfono, así que no se
            puede cargar.
          </p>
          <p className="mt-1">
            Pasa con la ventana privada de Safari y con el almacenamiento lleno.
            Probá desde una ventana normal, o hacé lugar y volvé a entrar.
          </p>
          <p className="mt-1 text-xs">El navegador dijo: {problemaDeAlmacenamiento}</p>
        </div>
      )}

      {sinSesion && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-semibold">
            Este teléfono no sabe quién sos, así que no se puede cargar.
          </p>
          <p className="mt-1">
            Cada carga sale firmada por quien la hizo, y sin eso no podría
            mandarse nunca. Entrá al SdG con señal una vez y volvé.
          </p>
        </div>
      )}

      {averiguandoQuienSos && (
        <p className="text-sm text-slate-500">
          Viendo quién tiene la sesión abierta en este teléfono…
        </p>
      )}

      {arranque === "leyendo" ? (
        <p className="text-sm text-slate-500">Leyendo lo que hay guardado en el teléfono…</p>
      ) : (
        <>
          <div className="flex gap-2">
            {(["aviso", "orden"] as const).map((tipo) => (
              <button
                key={tipo}
                onClick={() => setQueFormulario(tipo)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
                  queFormulario === tipo
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white text-slate-700"
                }`}
              >
                {tipo === "aviso" ? "Aviso" : "Orden de trabajo"}
              </button>
            ))}
          </div>

          {queFormulario === "aviso" ? (
            <FormularioAvisoOffline
              equipos={catalogos.equipos}
              sectores={catalogos.sectores}
              deshabilitado={deshabilitado}
              onMandar={(cuerpo) => mandar("aviso", cuerpo)}
            />
          ) : (
            <FormularioOTOffline
              equipos={catalogos.equipos}
              sectores={catalogos.sectores}
              operarios={catalogos.operarios}
              deshabilitado={deshabilitado}
              onMandar={(cuerpo) => mandar("orden", cuerpo)}
            />
          )}
        </>
      )}

      <ConfirmProvider>
        <LaCola
          cargas={cola}
          sesion={sesion}
          gente={gente}
          aviso={avisoDeLaCola}
          onReintentar={reintentar}
          onBorrar={borrar}
        />
      </ConfirmProvider>
    </main>
  );
}

/**
 * Lo que está esperando, a la vista.
 *
 * Mientras no haya correo, **ésta es la única forma que tienen doce de trece
 * personas de enterarse de que algo salió mal**: la única que recibe el push lo
 * tiene prendido. Por eso están las cuatro cosas: cuántas esperan, de cuándo es
 * cada una, qué dijo el servidor de la que falló —sin traducir— y de quién es
 * cuando no es de quien está mirando.
 *
 * Va adentro de `<ConfirmProvider>` y no al revés porque `useConfirm()` rompe
 * sin proveedor arriba, que es lo que se quiere: borrar una carga la pierde
 * para siempre, y no hay nada atrás de dónde volver a sacarla.
 */
function LaCola({
  cargas,
  sesion,
  gente,
  aviso,
  onReintentar,
  onBorrar,
}: {
  cargas: CargaEnCola[];
  sesion: SesionRecordada | null;
  gente: GenteConocida;
  aviso: string;
  onReintentar: (carga: CargaEnCola) => Promise<void>;
  onBorrar: (carga: CargaEnCola) => Promise<void>;
}) {
  const confirm = useConfirm();
  const [ocupada, setOcupada] = useState<string | null>(null);

  const esperando = cargas.filter((c) => c.estado === "esperando").length;
  const detenidas = paradas(cargas).length;

  async function correr(clave: string, accion: () => Promise<void>) {
    setOcupada(clave);
    try {
      await accion();
    } finally {
      setOcupada(null);
    }
  }

  async function pedirBorrar(carga: CargaEnCola) {
    const seguro = await confirm({
      title: "¿Borrar la carga?",
      message:
        `Se pierde lo que se escribió y no queda en ningún lado: ` +
        `${comoSeLlama(carga.tipo)} de ${haceCuanto(carga.creadaEn)}, ` +
        `sin número todavía.`,
      confirmText: "Borrar",
      danger: true,
    });
    if (seguro) await correr(carga.clave, () => onBorrar(carga));
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold text-slate-900">
        {cargas.length === 0
          ? "No hay nada esperando."
          : `Esperando: ${esperando}${detenidas > 0 ? ` · paradas: ${detenidas}` : ""}`}
      </h2>

      {/* Las dos clases de parada, porque **no todas fallaron**: desde que el
          service worker vacía la cola, una carga que entró y cuya advertencia
          no se pudo mostrar también queda parada, y decir de ésa que «el
          servidor contestó algo que volvería a contestar igual» es falso —
          contestó su número. Lo que tienen en común, y es lo que hay que decir,
          es que ninguna sale sola y que el texto de cada una dice cuál es. */}
      {detenidas > 0 && (
        <p className="text-xs text-amber-800">
          Una carga parada no se reintenta sola: o el servidor contestó algo que
          volvería a contestar igual, o ya entró y quedó algo para mirar. Lo que
          dice cada una está abajo.
        </p>
      )}

      {aviso && (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          {aviso}
        </p>
      )}

      <ul className="space-y-2">
        {cargas.map((carga) => {
          const ajena = !sesion || carga.usuarioId !== sesion.id;
          const duenio = gente[carga.usuarioId];
          return (
            <li
              key={carga.clave}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {comoSeLlama(carga.tipo)}
                </span>
                {carga.estado === "parada" && (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                    Parada
                  </span>
                )}
                {/* La fecha exacta no se pierde: va en el `title`. */}
                <span className="text-xs text-slate-500" title={carga.creadaEn}>
                  cargada {haceCuanto(carga.creadaEn)}
                </span>
                {carga.intentos > 0 && (
                  <span className="text-xs text-slate-400">
                    {carga.intentos} {carga.intentos === 1 ? "intento" : "intentos"}
                  </span>
                )}
              </div>

              <p className="mt-1 text-sm text-slate-800">{resumen(carga)}</p>

              {/* El rótulo es neutro a propósito. Decía «Lo que contestó el
                  servidor», y desde que el service worker vacía la cola este
                  campo también puede llevar el texto de `siNoSePudoAvisar`
                  —«Entró: se cargó el aviso OA-77…»—, que el servidor no dijo.
                  Era el rótulo pegado al texto, o sea el que se lee. */}
              {carga.ultimoError && (
                <p className="mt-1 text-xs text-red-700">
                  Lo último que pasó con esta carga: {carga.ultimoError}
                </p>
              )}

              {ajena && (
                <p className="mt-1 text-xs text-amber-800">
                  Es de {duenio ?? "otra sesión"}. Se manda cuando esa persona
                  vuelva a entrar en este teléfono.
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                {/* El botón se ofrece sobre las propias, incluidas las
                    paradas: que una parada no se reintente **sola** no quiere
                    decir que una persona no pueda decidirlo, y es justamente lo
                    que esta pantalla le da. Si en ese momento no se puede
                    —otra pestaña la tiene tomada—, `onReintentar` lo dice en
                    vez de hacerlo en silencio: un botón que desaparece confunde
                    más que uno que explica. */}
                {!ajena && (
                  <button
                    onClick={() => correr(carga.clave, () => onReintentar(carga))}
                    disabled={ocupada !== null}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {ocupada === carga.clave
                      ? "Mandando…"
                      : carga.estado === "parada"
                        ? "Reintentar igual"
                        : "Mandar ahora"}
                  </button>
                )}
                <button
                  onClick={() => pedirBorrar(carga)}
                  disabled={ocupada !== null}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                >
                  Borrar
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Con qué se reconoce una carga en la lista. Es lo que se escribió, no un id:
 * quien mira tiene que poder decir «ésta es la del reductor» sin abrir nada.
 */
function resumen(carga: CargaEnCola): string {
  const descripcion = String(carga.cuerpo.descripcion ?? "").trim();
  const equipo = String(carga.cuerpo.equipo_raw ?? "").trim();
  if (!descripcion) return equipo || "Sin descripción.";
  return equipo ? `${equipo} — ${descripcion}` : descripcion;
}
