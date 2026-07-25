import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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

export const metadata: Metadata = {
  title: {
    default: "Mess OS",
    template: "%s",
  },
  description:
    "Mess management for hostels — QR attendance, meal plans, menus and headcount projection.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
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
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <TooltipProvider delay={200}>{children}</TooltipProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
