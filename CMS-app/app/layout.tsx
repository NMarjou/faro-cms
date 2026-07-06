import type { Metadata } from "next";
import {
  DM_Sans,
  DM_Mono,
  Bricolage_Grotesque,
  Lora,
  Source_Sans_3,
  Spectral,
} from "next/font/google";
import SidebarTree from "@/components/SidebarTree";
import SearchPanel from "@/components/SearchPanel";
import ThemeProvider from "@/components/ThemeProvider";
import { CurrentUserProvider } from "@/components/CurrentUserProvider";
import { CurrentProjectProvider } from "@/components/CurrentProjectProvider";
import AuthProvider from "@/components/AuthProvider";
import { isAuthConfigured } from "@/lib/auth-options";
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

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
});

// Editor body — user-selectable in User Settings.
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source",
});

const spectral = Spectral({
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-spectral",
});

export const metadata: Metadata = {
  title: "Faro CMS",
  description: "Faro — a lighthouse for your docs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable} ${bricolage.variable} ${lora.variable} ${sourceSans.variable} ${spectral.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("cms-theme");if(t)document.documentElement.setAttribute("data-theme",t);else if(window.matchMedia("(prefers-color-scheme:dark)").matches)document.documentElement.setAttribute("data-theme","dark")}catch(e){}})()`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var f=localStorage.getItem("cms-editor-font");if(f==="spectral")document.documentElement.style.setProperty("--font-editor","var(--font-editor-serif)");else if(f==="source-sans")document.documentElement.style.setProperty("--font-editor","var(--font-editor-sans)")}catch(e){}})()`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(!localStorage.getItem("cms-current-user"))localStorage.setItem("cms-current-user","nolwenn.marjou@beqom.com")}catch(e){}})()`,
          }}
        />
        {/* Phosphor Icons web font — provides ph, ph-bold, ph-fill, ph-duotone classes */}
        <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css" />
        <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css" />
        <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/duotone/style.css" />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <CurrentUserProvider authConfigured={isAuthConfigured()}>
              <CurrentProjectProvider>
                <div className="app-layout">
                  <SidebarTree />
                  <main className="main-content">{children}</main>
                  <SearchPanel />
                </div>
              </CurrentProjectProvider>
            </CurrentUserProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
