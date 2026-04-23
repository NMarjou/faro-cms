import type { Metadata } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import { Cormorant_Garamond, Lora } from "next/font/google";
import SidebarTree from "@/components/SidebarTree";
import { TabProvider } from "@/components/TabContext";
import ThemeProvider from "@/components/ThemeProvider";
import Workspace from "@/components/Workspace";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

const dmMono = DM_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-dm-mono",
});

const cormorant = Cormorant_Garamond({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-cormorant",
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
});

export const metadata: Metadata = {
  title: "Faro",
  description: "Faro — a lighthouse for your docs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable} ${cormorant.variable} ${lora.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("cms-theme");if(t)document.documentElement.setAttribute("data-theme",t);else if(window.matchMedia("(prefers-color-scheme:dark)").matches)document.documentElement.setAttribute("data-theme","dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <TabProvider>
            <div className="app-layout">
              <SidebarTree />
              <main className="main-content">
                <Workspace>{children}</Workspace>
              </main>
            </div>
          </TabProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
