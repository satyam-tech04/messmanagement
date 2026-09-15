import type { Metadata, Viewport } from "next";
import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { APP_NAME } from "@/lib/app-info";
import "./globals.css";

/**
 * Inter, not Geist.
 *
 * This is an operations tool: a mess admin scans tables of roll numbers, dates
 * and amounts, and counter staff read results at a glance with a queue waiting.
 * Inter was drawn for that job — tall x-height, open apertures, and letterforms
 * that stay distinct at 13-14px, which is where a data table actually lives.
 * Geist is a fine display face but its geometric shapes make 1/l/I and 0/O
 * harder to tell apart, and those are precisely the characters in a roll number.
 */
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

/**
 * JetBrains Mono for roll numbers, IDs and timestamps. The slashed zero means a
 * staff member reading a roll number aloud off the manual-fallback screen
 * cannot confuse 0 with O.
 */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Archivo for headings and display type — the Aurora Depth voice (DESIGN.md §0).
 *
 * Headings only. Body copy and every table stay in Inter for the reasons above;
 * Archivo's tight, wide caps read beautifully at 40px and poorly in a roll
 * number at 13px.
 */
const archivo = Archivo({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: "%s",
  },
  description:
    "MealAdda runs hostel mess operations — signed QR meal attendance, subscriptions, menus and a live headcount the kitchen can cook to.",
};

export const viewport: Viewport = {
  themeColor: [
    // The Aurora Depth grounds, so the browser chrome continues the page.
    { media: "(prefers-color-scheme: light)", color: "#eef1f6" },
    { media: "(prefers-color-scheme: dark)", color: "#05070a" },
  ],
  width: "device-width",
  initialScale: 1,
  // Deliberately NOT `maximumScale: 1`. Pinch-zoom is an accessibility
  // requirement, and the QR and scanner screens are exactly where someone may
  // need it.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${archivo.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <ThemeProvider>
          <TooltipProvider delay={200}>{children}</TooltipProvider>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
