/**
 * Apps Script de "PEDIDOS DE COMPRA": protege la celda de Estado al aprobar.
 *
 * **ESTO ES UNA COPIA.** El original vive en la planilla (Extensiones -> Apps
 * Script) y lo edita gente, así que puede quedar viejo. Si difieren, manda la
 * planilla — y actualizar esta copia es parte de tocarlo. Está acá porque no
 * estarlo costó tres días: el 06 y 07/10/2026 se diagnosticaron a ciegas dos
 * fallas cuyo origen era este archivo, pidiéndoselo al usuario cada vez.
 *
 * ── QUÉ HACE ────────────────────────────────────────────────────────────────
 *
 * Cuando alguien pone `APROBADA (NICO)` en la columna Estado del master, busca
 * ese N° de RI en las pestañas por área y **protege su celda de Estado** (la
 * `Q`), dejando que la editen sólo los de `MAILS_PERMITIDOS`. Si el estado deja
 * de ser `APROBADA (NICO)`, libera la celda.
 *
 * ── LAS DOS COSAS QUE ROMPIÓ, Y QUE ESTA VERSIÓN ARREGLA ─────────────────────
 *
 * **1. Le sacaba el permiso a la cuenta de servicio en cada edición.** El bloque
 * de permisos hacía `removeEditors(todos)` y después `addEditors(permitidos)`,
 * y la cuenta no estaba en esa lista. O sea que no era que las protecciones
 * nuevas nacieran sin el permiso: **este script lo revocaba**, una y otra vez.
 * Medido el 06/10/2026: de 1.117 protecciones, 117 habían quedado sin la
 * cuenta, creciendo a unas tres por día, y con eso la app no podía mover de
 * etapa las compras de esas filas. La cuenta va ahora **adentro de
 * `MAILS_PERMITIDOS`**, que es la lista que este script vuelve a aplicar
 * siempre; agregarla por afuera con un `addEditor` no sirve, porque la
 * siguiente edición se la lleva puesta.
 *
 * **2. Dejaba protecciones que no podía editar nadie.** `protect()` deja como
 * editor a quien está editando; si ése es el **dueño** de la planilla,
 * `removeEditors` sobre él falla —al dueño no se lo puede sacar de su propia
 * protección—, la función muere ahí y **nunca llega a `addEditors`**. La celda
 * queda protegida sin un solo editor: no la puede tocar ni Nico, ni la app,
 * sólo el dueño. Eran 4 el 07/10/2026, y explican también las "8 que no se
 * pudieron tocar" que figuraban sin explicación desde agosto en
 * `compras-permisos-apps-script.gs`.
 *
 * El arreglo no es sólo no tocar al dueño: es **invertir el orden**. Primero se
 * dan los permisos y después se saca lo que sobre, así una falla en el medio
 * deja la celda con permisos **de más** —molesto, visible, reparable— en vez de
 * con ninguno, que deja a todo el mundo afuera y sólo se nota cuando alguien
 * intenta mover esa compra.
 *
 * ── SI ALGUNA QUEDÓ HUÉRFANA ────────────────────────────────────────────────
 *
 * Una protección sin editores **sólo la puede arreglar el dueño de la
 * planilla**. Medido: la API contesta 400 tanto para agregarle editores como
 * para borrarla, aunque quien lo pida sea editor del archivo. Se corrige con
 * `darPermisoALaCuentaDeServicio` de `compras-permisos-apps-script.gs`, corrida
 * desde la sesión del dueño —hoy `nicolaslenzetti@polcecal.com`—. Correrla
 * desde otra cuenta arregla todas las demás y deja justamente éstas.
 *
 * ── INSTALACIÓN ─────────────────────────────────────────────────────────────
 *
 * Va en el proyecto de Apps Script de "PEDIDOS DE COMPRA", y necesita un
 * **activador instalable** de edición: un `onEdit` simple no puede tocar
 * protecciones, porque eso pide autorización.
 */

function onEdit(e) {
  const HOJA_ORIGEN = "Requerimientos internos";
  const COL_ID = 1;              // Columna A (N° de RI)
  const COL_ESTADO_ORIGEN = 14;  // Columna N del master (Estado)
  const COL_ESTADO_DESTINO = 17; // Columna Q de las pestañas por área (Estado)

  // La cuenta de servicio va ACÁ dentro, no en un addEditor aparte: más abajo
  // esta lista es la que manda, y lo que no esté en ella se pierde en la
  // siguiente edición aunque alguien lo haya agregado a mano un minuto antes.
  const MAILS_PERMITIDOS = [
    "nicolaslenzetti@polcecal.com",
    "procedimientos@polcecal.com",
    "sheets-reader@mantenimientopp.iam.gserviceaccount.com"
  ];

  const hojaEditada = e.range.getSheet();
  if (hojaEditada.getName() !== HOJA_ORIGEN) return;

  const fila = e.range.getRow();
  const columna = e.range.getColumn();
  if (fila < 2 || columna !== COL_ESTADO_ORIGEN) return;

  const ss = e.source;
  const id = hojaEditada.getRange(fila, COL_ID).getValue();
  const estado = hojaEditada.getRange(fila, COL_ESTADO_ORIGEN).getValue();
  if (!id) return;

  // Al dueño no se lo saca nunca: puede editar igual, y pedirle a Apps Script
  // que lo quite de su propia protección es un error que corta la función.
  const dueno = ss.getOwner() ? ss.getOwner().getEmail() : null;

  const hojas = ss.getSheets();

  for (const hoja of hojas) {
    if (hoja.getName() === HOJA_ORIGEN) continue;
    if (hoja.getLastRow() < 2) continue;
    if (hoja.getLastColumn() < COL_ESTADO_DESTINO) continue;

    const ids = hoja.getRange(2, COL_ID, hoja.getLastRow() - 1, 1).getValues();

    for (let i = 0; i < ids.length; i++) {
      const idHoja = ids[i][0];
      if (String(idHoja).trim() !== String(id).trim()) continue;

      const filaDestino = i + 2;
      const celdaQ = hoja.getRange(filaDestino, COL_ESTADO_DESTINO);

      const protecciones = hoja.getProtections(SpreadsheetApp.ProtectionType.RANGE);

      let proteccionExistente = null;
      for (const p of protecciones) {
        const r = p.getRange();
        if (
          r.getRow() === filaDestino &&
          r.getColumn() === COL_ESTADO_DESTINO &&
          r.getNumRows() === 1 &&
          r.getNumColumns() === 1
        ) {
          proteccionExistente = p;
          break;
        }
      }

      if (estado === "APROBADA (NICO)") {
        let proteccion = proteccionExistente;

        if (!proteccion) {
          proteccion = celdaQ.protect().setDescription(
            `Protección automática ${hoja.getName()}!Q${filaDestino}`
          );
        }

        // PRIMERO dar los permisos y DESPUÉS sacar lo que sobre. El orden es lo
        // que importa: si algo falla en el medio, la celda queda de más y no de
        // menos. Al revés —sacar a todos y después agregar— una falla deja la
        // protección sin ningún editor, y esa celda no la puede tocar nadie
        // salvo el dueño: ni Nico, ni el sistema.
        proteccion.addEditors(MAILS_PERMITIDOS);

        const sobran = proteccion.getEditors()
          .map(function (u) { return u.getEmail(); })
          .filter(function (correo) {
            return MAILS_PERMITIDOS.indexOf(correo) === -1 && correo !== dueno;
          });
        if (sobran.length) {
          proteccion.removeEditors(sobran);
        }

        if (proteccion.canDomainEdit()) {
          proteccion.setDomainEdit(false);
        }

      } else {
        // Si deja de ser APROBADA (NICO), se libera la celda.
        if (proteccionExistente) {
          proteccionExistente.remove();
        }
      }
    }
  }
}
