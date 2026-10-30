"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmProvider, useConfirm } from "@/components/ConfirmProvider";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { haceCuanto } from "@/lib/core/haceCuanto";
import { useCargar } from "@/lib/core/useCargar";
import { pedirVaciadoAhora, pedirVaciadoEnSegundoPlano } from "@/lib/core/vaciarLaCola";
import {
  comoSeLlama,
  concordado,
  conSuArticulo,
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
import FormularioCondicionOffline from "./FormularioCondicionOffline";
import { formularioQueSeVe, tiposQueSeOfrecen } from "@/lib/seguridadHigiene/glosarioOffline";
import FormularioOTOffline from "./FormularioOTOffline";

/** En qué estado quedó la lectura del teléfono al abrir la pantalla. */
type Arranque = "leyendo" | "listo" | "sin-almacenamiento";

/**
 * La pantalla que anda sin señal: los formularios y lo que está esperando. Son
 * dos —aviso y orden de trabajo— y un tercero, la condición insegura de
 * Seguridad e Higiene, que sólo aparece si el teléfono tiene anotado que la
 * persona puede cargarla.
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
 * De la cola se sale por tres caminos, y los tres existen. A mano, con el botón
 * «Mandar ahora» de cada carga, que es el único que hay en un iPhone con la app
 * cerrada. Corrigiéndola, cuando lo que falló fue definitivo y hay algo que
 * arreglar —la vieja sale recién cuando la corregida está guardada—. Y solo,
 * cuando el service worker se despierta, que esta pantalla le
 * pide dos veces: al guardar una carga (`pedirVaciadoEnSegundoPlano`, que en
 * Android lo despierta cuando vuelva la señal aunque nadie abra nada) y, si
 * quedó algo esperando, al abrir esta pantalla y cada vez que vuelve la señal
 * con ella abierta (`pedirVaciadoAhora`, que es el único de los dos que
 * funciona en un iPhone).
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
  // La carga parada que se está editando, y un contador que es la `key` de los
  // formularios. **Son dos cosas y no una**: el contador sube sólo al empezar a
  // editar, así que al guardar se puede soltar el borrador sin remontar el
  // formulario — remontarlo borraría el cartel que acaba de decir con qué
  // número entró, que es lo único que esa persona está esperando leer.
  const [borrador, setBorrador] = useState<CargaEnCola | null>(null);
  const [generacion, setGeneracion] = useState(0);

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

    // NO PUEDE QUEDAR AFUERA DE UN `try`, Y ESO ES EL ARREGLO DEL 19/10/2026.
    // `recordarLaSesion` anota quién sos en IndexedDB, y esa escritura rechaza
    // cuando el almacenamiento está lleno o bloqueado. Ese rechazo lo descartaba
    // el `void` de `useCargar`, así que `sesionResuelta` se quedaba en false
    // para siempre: formularios apagados y el cartel «Viendo quién tiene la
    // sesión abierta…» fijo, sin una palabra de diagnóstico — justo el modo de
    // falla que esta pantalla existe para contar.
    let ahora: SesionRecordada | null = null;
    try {
      ahora = await recordarLaSesion();
    } catch (e) {
      if (!vigente()) return;
      setProblemaDeAlmacenamiento(loQueDijo(e));
      setArranque("sin-almacenamiento");
      return;
    }
    if (!vigente()) return;
    const quienEs = ahora;
    if (quienEs) {
      setSesion(quienEs);
      setGente((previa) => ({ ...previa, [quienEs.id]: quienEs.nombre }));
    }
    setSesionResuelta(true);

    // EL PEDIDO DE VACIADO VA ACÁ, DESPUÉS DE ANOTAR QUIÉN SOS, y el orden es
    // la mitad del asunto: el service worker decide a nombre de quién manda por
    // lo que encuentre anotado en IndexedDB —no puede leer la cookie—, así que
    // pedirlo antes dejaría salir la carga de la persona anterior con la cookie
    // de ésta. Si no se pudo averiguar quién sos, no se pide: la cola espera.
    //
    // **SIN CONDICIÓN SOBRE LA COLA, y eso cambió el 19/10/2026.** Antes se
    // pedía sólo si había algo en estado `esperando`, igual que la barra del
    // layout. Lo que esa condición no miraba es que el disparo no vacía sólo la
    // cola: también **repara el precache** de esta misma pantalla
    // (`guardarLaPantallaSiFalta`). `install` corre una sola vez por versión de
    // `sw.js`, así que el teléfono donde esa única corrida pasó sin señal se
    // quedó con `/cargar` a medias —o sin guardar—, y el único camino de
    // reparación eran el `sync`, el `push` y este mensaje. Con la condición
    // vieja **el teléfono que nunca encoló nada no reparaba nunca**, ni
    // abriendo esta pantalla con señal, que es justo lo que alguien haría para
    // dejarla lista antes de ir a la planta. Y ésos son casi todos: la cola
    // vacía es el estado normal.
    //
    // Lo que cuesta pedirlo siempre es un `postMessage` a un worker que esta
    // pestaña ya mantiene vivo; la bajada del precache ocurre sólo si falta.
    //
    // POR QUÉ ACÁ Y NO EN EL HANDLER DE `online`: esto corre al abrir la
    // pantalla **y** cada vez que ese handler llama a `volverALeer`, así que
    // cubre los dos momentos con una sola regla.
    //
    // Y POR QUÉ IMPORTA QUE SEA `pedirVaciadoAhora`: lo que pide `encolar` es
    // `pedirVaciadoEnSegundoPlano`, o sea Background Sync, que Safari no
    // implementa. Para medio equipo éste es el único pedido que hace algo.
    //
    // **Esta pantalla sigue sin mandar nada por su cuenta**: le pide al service
    // worker que corra **su** vaciado. Un segundo lugar que decidiera cuándo
    // sale una carga sería las mismas reglas escritas dos veces.
    if (quienEs) void pedirVaciadoAhora();

    // Refrescar los catálogos es una mejora y no una operación de la persona,
    // así que un fallo acá deja los de ayer, que sirven. El `catch` es por lo
    // mismo que el `try` de arriba y no por la red —de eso ya se ocupa
    // `refrescarCatalogos`—: guardar lo bajado también puede rechazar, y una
    // promesa rechazada en este punto sería otra vez un error que nadie
    // observa, con la pantalla ya dibujada y usable.
    const frescos = await refrescarCatalogos(guardados).catch(() => guardados);
    if (!vigente()) return;
    setCatalogos(frescos);
  }, []);

  useEffect(() => {
    const alCambiarLaConexion = () => {
      const hay = navigator.onLine;
      setEnLinea(hay);
      // Con la señal de vuelta se vuelve a leer todo: los catálogos quedaron
      // viejos, la sesión puede haberse renovado y la cola puede haber cambiado
      // en otra pestaña o la puede haber vaciado el service worker. Y de paso
      // se pide el vaciado si hace falta: eso lo decide `volverALeer` con la
      // cola recién leída, arriba, para no tener la misma condición escrita en
      // dos lados diciendo cosas parecidas.
      if (hay) volverALeer();
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
    async (
      tipo: TipoDeCarga,
      cuerpo: Record<string, unknown>,
      /** La clave de la carga parada que esto viene a reemplazar, si es una corrección. */
      reemplaza: string | null = null,
    ): Promise<Resultado> => {
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

      /**
       * La carga parada que se estaba corrigiendo sale de la cola **recién
       * ahora**, y nunca antes: si se borrara al empezar a editar, cerrar la
       * pantalla a mitad de camino perdería lo que alguien escribió en la
       * planta. Y no sale si la corrección también se rechazó —ahí lo viejo
       * sigue siendo lo único que hay—.
       *
       * No se reutiliza su `clave`: ésta es otra carga, con otro cuerpo, y la
       * vieja puede haber quedado reservada del lado del servidor. Una clave
       * reusada chocaría contra esa reserva y recibiría un 409 «en duda» que no
       * es cierto.
       */
      async function soltarLaQueSeEditaba() {
        if (!reemplaza) return;
        try {
          await borrarCarga(reemplaza);
        } catch {
          // Lo nuevo ya está guardado o mandado. Que la vieja siga en la lista
          // es visible y lo arregla el botón de borrar; perderla no.
        }
        // Sin tocar `generacion`: el formulario no se remonta, así que el
        // cartel que dice con qué número entró se queda en pantalla.
        setBorrador(null);
      }

      if (queHacer.accion === "listo") {
        await soltarLaQueSeEditaba();
        await releerLaCola();
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
      const salida = await encolar(
        {
          ...carga,
          intentos: queHacer.intentos,
          ultimoError: queHacer.ultimoError,
          // Si la ruta dijo que la fila ya quedó escrita pese al fallo —hoy
          // sólo la condición cuya foto no se pudo guardar—, la carga nace
          // sabiéndolo: es lo que después le saca el botón de corregir, que
          // sobre una de éstas crearía una segunda fila.
          ...(queHacer.yaEntro ? { yaEntro: queHacer.yaEntro } : {}),
        },
        queHacer.ultimoError,
        !laPusoUnaPersona,
      );
      if (salida.estado === "encolada") {
        await soltarLaQueSeEditaba();
        await releerLaCola();
      }
      return salida;
    },
    [sesion, encolar, releerLaCola],
  );

  /**
   * Una carga que ya no está en la cola tampoco puede seguir siendo la que el
   * formulario dice estar corrigiendo: el cartel de arriba quedaría prometiendo
   * sacar de la lista algo que ya no está. Lo escrito **no se toca** — que la
   * vieja se haya ido no es motivo para tirar la corrección en curso.
   */
  const seFue = useCallback((clave: string) => {
    setBorrador((previo) => (previo?.clave === clave ? null : previo));
  }, []);

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
          seFue(carga.clave);
          setAvisoDeLaCola(`Se mandó: ${comoSeLlama(carga.tipo)} ${queHacer.numero}.`);
        } else if (queHacer.accion === "borrar-y-avisar") {
          await borrarCarga(carga.clave);
          seFue(carga.clave);
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
    [sesion, releerLaCola, seFue],
  );

  /**
   * Corregir una carga parada: vuelve al formulario con lo que se había
   * escrito, y la vieja sale de la cola recién cuando la nueva está guardada.
   *
   * ES LO QUE EL SPEC PROMETÍA Y EL CÓDIGO NO CUMPLÍA: «se avisa y la carga
   * queda parada, **visible y editable**, no borrada». Lo que había era
   * «Reintentar igual» —mandar de nuevo exactamente lo que ya fue rechazado,
   * que va a fallar otra vez— y «Borrar», que pierde lo escrito. Para una OT
   * son dieciocho campos cargados parado en la cantera.
   */
  const editar = useCallback((carga: CargaEnCola) => {
    setAvisoDeLaCola("");
    setQueFormulario(carga.tipo);
    setBorrador(carga);
    // El contador sube sólo acá: es lo que remonta el formulario con los
    // valores de esta carga, sin arrastrar lo que hubiera escrito antes.
    setGeneracion((n) => n + 1);
    // El formulario está arriba de la lista, y en un teléfono eso es fuera de
    // la pantalla: sin esto el botón parecería no hacer nada.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const borrar = useCallback(
    async (carga: CargaEnCola) => {
      setAvisoDeLaCola("");
      try {
        await borrarCarga(carga.clave);
        seFue(carga.clave);
      } catch (e) {
        setAvisoDeLaCola(`No se pudo borrar la carga: ${loQueDijo(e)}`);
      }
      await releerLaCola();
    },
    [releerLaCola, seFue],
  );

  const sinDondeGuardar = arranque === "sin-almacenamiento";
  // El cartel sólo cuando ya se terminó de preguntar: antes, lo único cierto es
  // que todavía no se sabe, y decir «no sabe quién sos» en el medio asusta sin
  // motivo.
  const sinSesion = arranque === "listo" && sesionResuelta && !sesion;
  const averiguandoQuienSos = arranque === "listo" && !sesionResuelta && !sesion;
  const deshabilitado = arranque !== "listo" || !sesion;
  // Qué pestañas hay y cuál se ve. Se calcula acá y no se guarda en el estado:
  // si el permiso se retira mientras la pantalla está abierta, la pestaña de
  // condición desaparece y el formulario vuelve solo a uno que se pueda cargar.
  const ofrecidos = tiposQueSeOfrecen(catalogos.puedeCargarCondiciones);
  const formulario = formularioQueSeVe(queFormulario, ofrecidos);

  return (
    <main className="mx-auto w-full max-w-xl space-y-4 p-4">
      <header>
        <h1 className="text-lg font-bold text-slate-900">Cargar sin señal</h1>
        <p className="mt-1 text-sm text-slate-600">
          {catalogos.puedeCargarCondiciones
            ? "Un aviso o una orden de trabajo de Mantenimiento, o una condición insegura. "
            : "Un aviso o una orden de trabajo de Mantenimiento. "}
          Si no hay señal, queda esperando acá abajo hasta que vuelva.
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
            {/* La condición insegura sólo se ofrece si este teléfono tiene
                anotado que la persona puede cargarla: `/cargar` no filtra por
                módulo, y sin esto alguien sin Seguridad e Higiene sacaría la
                carga y se comería un 403 cuando vuelva la señal. Sin la
                anotación no se muestra: es lo seguro cuando no se sabe. */}
            {ofrecidos.map((tipo) => (
              <button
                key={tipo}
                onClick={() => setQueFormulario(tipo)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
                  formulario === tipo
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white text-slate-700"
                }`}
              >
                {comoSeLlama(tipo)}
              </button>
            ))}
          </div>

          {/* Se dice que se está corrigiendo algo, porque si no el formulario
              aparece lleno sin motivo visible y quien lo mira puede creer que
              está cargando una segunda cosa — que es el duplicado que todo
              esto existe para evitar. */}
          {/* Sólo si el formulario de abajo es el de esa carga: con el permiso de
              condiciones retirado, un borrador de condición no tiene formulario
              y el cartel diría que se corrige algo que no se está corrigiendo. */}
          {borrador && borrador.tipo === formulario && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="min-w-0 flex-1">
                Estás corrigiendo {conSuArticulo(borrador.tipo)} que quedó {concordado(borrador.tipo, "parad")}.
                La vieja sale de la lista recién cuando ésta se guarde.
              </span>
              <button
                type="button"
                onClick={() => {
                  setBorrador(null);
                  setGeneracion((n) => n + 1);
                }}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Dejar de corregirla
              </button>
            </div>
          )}

          {/* La `key` es lo que vuelve a dibujar el formulario con los valores
              de la carga que se eligió corregir. Sube **sólo** al empezar o
              dejar una corrección: al guardar no, porque remontar ahí borraría
              el cartel que acaba de decir con qué número entró. */}
          {formulario === "aviso" ? (
            <FormularioAvisoOffline
              key={generacion}
              equipos={catalogos.equipos}
              sectores={catalogos.sectores}
              deshabilitado={deshabilitado}
              borrador={borrador?.tipo === "aviso" ? borrador.cuerpo : null}
              onMandar={(cuerpo) =>
                mandar("aviso", cuerpo, borrador?.tipo === "aviso" ? borrador.clave : null)
              }
            />
          ) : formulario === "orden" ? (
            <FormularioOTOffline
              key={generacion}
              equipos={catalogos.equipos}
              sectores={catalogos.sectores}
              operarios={catalogos.operarios}
              deshabilitado={deshabilitado}
              borrador={borrador?.tipo === "orden" ? borrador.cuerpo : null}
              onMandar={(cuerpo) =>
                mandar("orden", cuerpo, borrador?.tipo === "orden" ? borrador.clave : null)
              }
            />
          ) : (
            <FormularioCondicionOffline
              key={generacion}
              catalogos={catalogos}
              deshabilitado={deshabilitado}
              borrador={borrador?.tipo === "condicion" ? borrador.cuerpo : null}
              onMandar={(cuerpo) =>
                mandar("condicion", cuerpo, borrador?.tipo === "condicion" ? borrador.clave : null)
              }
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
          editando={borrador?.clave ?? null}
          onReintentar={reintentar}
          onEditar={editar}
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
 * tiene prendido (medido el 19/10/2026: una suscripción, trece usuarios
 * activos). Por eso están las cuatro cosas: cuántas esperan, de cuándo es cada
 * una, qué dijo el servidor de la que falló —sin traducir— y de quién es cuando
 * no es de quien está mirando.
 *
 * Y por eso una parada se puede **corregir**, no sólo reintentar o borrar: el
 * texto del servidor dice qué le falta, y sin un camino para arreglarlo ese
 * texto no sirve para nada.
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
  editando,
  onReintentar,
  onEditar,
  onBorrar,
}: {
  cargas: CargaEnCola[];
  sesion: SesionRecordada | null;
  gente: GenteConocida;
  aviso: string;
  /** La clave de la que se está corrigiendo arriba, para no ofrecerlo dos veces. */
  editando: string | null;
  onReintentar: (carga: CargaEnCola) => Promise<void>;
  onEditar: (carga: CargaEnCola) => void;
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

              {/* UNA CARGA QUE YA TIENE SU FILA ESCRITA, Y ES LA PRIMERA DE
                  ESTE SISTEMA QUE PUEDE ESTARLO MIENTRAS SIGUE EN LA COLA.
                  Pasa con la condición insegura cuya foto no se pudo guardar:
                  se contesta un error a propósito, porque el `Blob` vive acá
                  y sacar la carga de la cola lo pierde para siempre. Hay que
                  decirlo con todas las letras, porque la lista entera está
                  escrita sobre el supuesto contrario —«todavía no tiene
                  número»— y alguien que lea eso va a cargarla de nuevo. */}
              {carga.yaEntro && (
                <p className="mt-1 text-xs text-amber-800">
                  Esto ya entró con el número {carga.yaEntro}: <b>no lo cargues
                  de nuevo</b>. Lo que falta es la foto, y para eso está
                  «Mandar ahora».
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

                {/* CORREGIR, QUE ES LO QUE EL SPEC PEDÍA: una parada quedaba
                    «visible» pero no editable, así que ante un 400 —que es
                    definitivo— las dos salidas eran mandar otra vez lo mismo o
                    tirar lo escrito. Se ofrece sólo sobre las paradas propias:
                    una que **espera** va a salir sola y tocarla sería cambiarle
                    el cuerpo a algo que puede estar saliendo en este momento, y
                    una ajena no se puede corregir en nombre de otro.

                    **Y NO SE OFRECE SOBRE UNA QUE YA ENTRÓ.** Corregir le da a
                    la carga una clave nueva a propósito —es otra carga, y la
                    vieja puede haber quedado reservada del lado del
                    servidor—, lo cual es correcto para todas menos para ésta:
                    su fila **ya existe**, así que una clave nueva no cae en la
                    rama de idempotencia y crea una segunda condición con la
                    misma descripción y la misma foto. «Mandar ahora» sí reusa
                    la clave, y es el camino que termina de subir la foto. */}
                {!ajena && carga.estado === "parada" && !carga.yaEntro && editando !== carga.clave && (
                  <button
                    onClick={() => onEditar(carga)}
                    disabled={ocupada !== null}
                    className="rounded-lg border border-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-900 disabled:opacity-50"
                  >
                    Corregir y volver a mandar
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
