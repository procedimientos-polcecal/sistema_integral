import { describe, it, expect } from "vitest";
import { fotosDelAviso } from "./fotoDelAviso";

describe("fotosDelAviso", () => {
  it("sin fotos no hay nada que mostrar", () => {
    expect(fotosDelAviso(null)).toEqual([]);
    expect(fotosDelAviso(undefined)).toEqual([]);
    expect(fotosDelAviso([])).toEqual([]);
  });

  it("descarta lo vacío y lo que no es un link", () => {
    expect(fotosDelAviso(["", "   ", null, "sin foto", "C:\\fotos\\a.jpg"])).toEqual([]);
  });

  it("descarta un `javascript:` aunque termine en .jpg", () => {
    // La columna K de la planilla es texto que tipea una persona y entra sin
    // validar (`avisos.ts`): sin este filtro iría derecho a un `href`.
    expect(fotosDelAviso(["javascript:alert(1)//a.jpg"])).toEqual([]);
    expect(fotosDelAviso(["data:text/html;base64,PHNjcmlwdD4="])).toEqual([]);
  });

  it("una foto del bucket se muestra como imagen", () => {
    const url =
      "https://abcd.supabase.co/storage/v1/object/public/execution-photos/avisos/A245/1763500000000.jpg";
    expect(fotosDelAviso([url])).toEqual([{ tipo: "imagen", url }]);
  });

  it("un link firmado también, aunque lleve el token en la query", () => {
    const url =
      "https://abcd.supabase.co/storage/v1/object/sign/execution-photos/avisos/A245/1.png?token=xx.yy.zz";
    expect(fotosDelAviso([url])).toEqual([{ tipo: "imagen", url }]);
  });

  it("la extensión se reconoce en mayúsculas", () => {
    const url = "https://ejemplo.com/foto.JPEG";
    expect(fotosDelAviso([url])[0].tipo).toBe("imagen");
  });

  it("un link de Drive es un enlace y no una imagen", () => {
    // Medido el 19/11/2026 contra la foto del OA A244: `thumbnail?id=`,
    // `uc?export=view` y `lh3.googleusercontent.com/d/` devuelven los tres el
    // login de Google, así que un `<img>` ahí no muestra nunca la foto.
    const url = "https://drive.google.com/open?id=1IZS7xcwoEgR4hX9colEC4J_uPPbR6v6z";
    const [foto] = fotosDelAviso([url]);
    expect(foto).toMatchObject({ tipo: "enlace", url });
    expect(foto.tipo === "enlace" && foto.porQue).toMatch(/Drive/);
  });

  it("las otras formas del link de Drive también", () => {
    const fotos = fotosDelAviso([
      "https://drive.google.com/file/d/1IZS7x/view?usp=drivesdk",
      "https://docs.google.com/document/d/1IZS7x/edit",
      "https://lh3.googleusercontent.com/d/1IZS7x",
    ]);
    expect(fotos.map((f) => f.tipo)).toEqual(["enlace", "enlace", "enlace"]);
  });

  it("un link que no se sabe qué es queda como enlace, no se adivina", () => {
    const url = "https://ejemplo.com/una/pagina";
    expect(fotosDelAviso([url])).toEqual([
      { tipo: "enlace", url, porQue: "No se sabe si este link es una foto; se abre aparte." },
    ]);
  });

  it("conserva el orden y limpia los espacios de los costados", () => {
    const fotos = fotosDelAviso([
      "  https://ejemplo.com/a.jpg  ",
      "https://drive.google.com/open?id=x",
    ]);
    expect(fotos).toEqual([
      { tipo: "imagen", url: "https://ejemplo.com/a.jpg" },
      {
        tipo: "enlace",
        url: "https://drive.google.com/open?id=x",
        porQue: "Está en Drive: la abre quien tenga permiso sobre esa carpeta.",
      },
    ]);
  });
});
