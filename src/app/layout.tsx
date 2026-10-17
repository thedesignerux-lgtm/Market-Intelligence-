import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";

const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Market Intelligence", template: "%s | Market Intelligence" },
  description: "Comercios, clubes y asociaciones de Galicia con su procedencia y seguimiento comercial.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={hanken.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
