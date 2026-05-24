import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "2026년 아이폰 캘린더",
  description: "2026년 5월~12월 아이폰 캘린더 일기장",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
