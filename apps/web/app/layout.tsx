import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "../components/layout/Sidebar";
import { TopBar } from "../components/layout/TopBar";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "0ptimo Prim3 | Command Dashboard",
  description: "3D live interactive analytics HUD.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased h-screen w-screen overflow-hidden bg-background flex`}>
        <Sidebar />
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          <TopBar />
          <main className="flex-1 overflow-auto p-6 relative">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}