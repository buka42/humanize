import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Humanizator Prac Naukowych",
  description: "AI-powered humanizacja tekstów naukowych na poziomie pracy magisterskiej",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
