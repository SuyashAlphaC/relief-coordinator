import type { Metadata } from "next";
import "./globals.css";
import "./reference-theme.css";

export const metadata: Metadata = {
  title: "Relief Desk · Emergency coordination",
  description: "Incident response, relief logistics, and team coordination.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
