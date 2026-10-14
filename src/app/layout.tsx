import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "web-admin", template: "%s · web-admin" },
  description: "Administración privada de clientes, sitios y cobranzas.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { colorScheme: "dark", themeColor: "#101113" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es-AR" className="dark"><body>{children}</body></html>;
}
