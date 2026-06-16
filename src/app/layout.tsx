import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "シフト管理",
  description: "希望休入力と月次シフト自動作成MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
