import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CelesteOS · LinkedIn",
  description: "CLAWEDBOT01 dashboard — strategy, posts, captures, analytics.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
