import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Моя полка игр",
  description: "Рейтинг настольных игр с оценками друзей",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
