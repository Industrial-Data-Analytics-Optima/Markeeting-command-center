import { headers } from "next/headers";
import type { Metadata } from "next";
import "./workspace.css";
export const metadata: Metadata = {
  title: "Marketing Command Center",
  description: "Plan, publish and manage your brands in one place.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: "/apple-icon.svg",
  },
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await headers(); // Request rendering allows Next to nonce its hydration scripts.
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
