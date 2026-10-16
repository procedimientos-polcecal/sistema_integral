import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SdG — Polcecal / Polysan",
  description: "Sistema de Gestión unificado: RRHH, Mantenimiento y Remises",
  // Se declara y no se confía en la convención de Safari: sin este link iOS
  // pide /apple-touch-icon.png por respaldo histórico, y si alguien mueve el
  // archivo pone un recorte de la página como ícono sin avisar.
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A0F1C",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full bg-slate-50">{children}</body>
    </html>
  );
}
