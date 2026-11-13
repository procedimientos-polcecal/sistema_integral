import { describe, expect, it } from "vitest";
import { EXCEPCIONES, revisarModales } from "./revisar-modales.mjs";

/** Un archivo armado a mano: los tests no miran el árbol real, que cambia. */
const archivo = (texto, ruta = "app/(app)/prueba/PruebaClient.tsx") => ({ ruta, texto });

const RUTA_SIDEBAR = "components/Sidebar.tsx";
const CAPA_CLASE = '<div className="fixed inset-0 z-50 bg-black/40">';
const CAPA_STYLE = '<div style={{\n  position: "fixed", inset: 0, zIndex: 60,\n}}>';

/** Todos los archivos declarados, cada uno con su única capa: el árbol «sano». */
const arbolSano = () => EXCEPCIONES.map((e) => archivo(CAPA_CLASE, e.ruta));
/** Y el Modal, que es la capa buena y tiene que seguir apareciendo. */
const elModal = archivo(CAPA_STYLE, "components/Modal.tsx");

const con = (...archivos) => revisarModales([elModal, ...arbolSano(), ...archivos]);

describe("revisarModales", () => {
  it("el árbol sano, con el Modal y las excepciones declaradas, no da nada", () => {
    expect(con()).toEqual([]);
  });

  it("un `fixed inset-0` en un className sin declarar sale como ROMPE", () => {
    const h = con(archivo(CAPA_CLASE));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ severidad: "ROMPE", linea: 1 });
  });

  it("un `position: \"fixed\", inset: 0` en un style sin declarar sale como ROMPE", () => {
    const h = con(archivo(CAPA_STYLE));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ severidad: "ROMPE", linea: 2 });
  });

  it("una excepción cuyo archivo ya no existe sale como MIRAR", () => {
    const sinSidebar = [elModal, ...arbolSano().filter((a) => a.ruta !== RUTA_SIDEBAR)];
    const h = revisarModales(sinSidebar);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ severidad: "MIRAR", ruta: RUTA_SIDEBAR });
  });

  it("una segunda capa en un archivo declarado con cantidad 1 sale como ROMPE", () => {
    const dos = archivo(`${CAPA_CLASE}\n${CAPA_CLASE}`, RUTA_SIDEBAR);
    const resto = arbolSano().filter((a) => a.ruta !== RUTA_SIDEBAR);
    const h = revisarModales([elModal, ...resto, dos]);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ severidad: "ROMPE", ruta: RUTA_SIDEBAR, linea: 2 });
  });

  it("un comentario que nombra la capa no cuenta", () => {
    expect(con(archivo("// fixed inset-0 va en el Modal"))).toEqual([]);
  });
});
