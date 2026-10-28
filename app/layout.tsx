import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plaude Agent — Workflow Spike",
  description:
    "Minimal Next.js and Workflow DevKit spike for the Plaude engineering challenge.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
