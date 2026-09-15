/**
 * The share poster: what WhatsApp, Slack, LinkedIn and X show for a MealAdda link.
 *
 * Composition rules, because platforms crop:
 *  - The **logo and wordmark sit in the centre**. WhatsApp's small preview is
 *    a square centre crop of this 1200×630 image; anything important at the
 *    left edge disappears there.
 *  - Dark Teal ground. Previews sit inside both light and dark chat themes, and
 *    a dark poster with a bright logo reads in both.
 *  - The thalis are the same illustration the landing page uses, rendered to
 *    SVG with the dark palette baked in (CSS variables don't exist inside an
 *    image).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { thaliSvgDocument } from "@/components/thali-svg";
import { APP_NAME } from "@/lib/app-info";
import { SITE_TAGLINE } from "@/lib/site";

export const POSTER_SIZE = { width: 1200, height: 630 };
export const POSTER_ALT = `${APP_NAME} — ${SITE_TAGLINE}: menus, meal plans, QR meal pass and live headcount`;

/** Obsidian Teal values for the illustration's theme tokens. */
const DARK_TOKENS: Record<string, string> = {
  "--plate-face": "#26303a",
  "--plate-rim": "#44505c",
  "--plate-shadow": "rgba(0,0,0,0.55)",
  "--food-turmeric": "#f2b233",
  "--food-leaf": "#5cbf6d",
  "--food-chilli": "#ef6a45",
  "--food-cream": "#f6ead0",
  "--food-roti": "#d9a864",
};

function thaliDataUri(): string {
  return `data:image/svg+xml;base64,${Buffer.from(thaliSvgDocument(DARK_TOKENS)).toString("base64")}`;
}

const MEALS = ["Breakfast", "Lunch", "Snacks & chai", "Dinner"];

export async function renderPoster(): Promise<ImageResponse> {
  const dir = join(process.cwd(), "assets/og");
  const [archivo, interSemi, interRegular, logo] = await Promise.all([
    readFile(join(dir, "Archivo-Black.ttf")),
    readFile(join(dir, "Inter-SemiBold.ttf")),
    readFile(join(dir, "Inter-Regular.ttf")),
    readFile(join(dir, "logo.png")),
  ]);
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  const thali = thaliDataUri();

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: "#05070a",
        backgroundImage:
          "radial-gradient(circle at 12% 10%, rgba(47,143,214,0.40), transparent 45%), radial-gradient(circle at 88% 85%, rgba(95,208,196,0.32), transparent 45%), radial-gradient(circle at 55% 110%, rgba(124,92,255,0.22), transparent 40%)",
        fontFamily: "Inter",
        color: "#edf2f4",
      }}
    >
      {/* Thalis at the edges — atmosphere, never under the text */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thali}
        width={420}
        height={420}
        alt=""
        style={{ position: "absolute", left: -150, bottom: -150, opacity: 0.95 }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thali}
        width={380}
        height={380}
        alt=""
        style={{ position: "absolute", right: -130, top: -140, opacity: 0.9 }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          padding: "0 150px",
        }}
      >
        {/* Logo + wordmark, centred for square crops */}
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 118,
              height: 118,
              borderRadius: 30,
              background: "#ffffff",
              boxShadow: "0 18px 50px rgba(95,208,196,0.35)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} width={100} height={100} alt="" />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "Archivo", fontSize: 76, letterSpacing: -2, lineHeight: 1 }}>
              {APP_NAME}
            </div>
            <div style={{ fontSize: 26, color: "#9ff3e4", fontWeight: 600, marginTop: 6 }}>
              {SITE_TAGLINE}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontFamily: "Archivo",
            fontSize: 54,
            letterSpacing: -1.5,
            marginTop: 44,
            textAlign: "center",
          }}
        >
          <span>Good food, on time,&nbsp;</span>
          <span style={{ color: "#5fd0c4" }}>for every student.</span>
        </div>

        <div style={{ display: "flex", fontSize: 26, color: "#a9b6bf", marginTop: 18 }}>
          Menus · Meal plans · QR meal pass · Live kitchen count
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 36 }}>
          {MEALS.map((meal) => (
            <div
              key={meal}
              style={{
                display: "flex",
                padding: "10px 22px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(255,255,255,0.06)",
                fontSize: 22,
                fontWeight: 600,
              }}
            >
              {meal}
            </div>
          ))}
        </div>
      </div>
    </div>,
    {
      ...POSTER_SIZE,
      fonts: [
        { name: "Archivo", data: archivo, weight: 900, style: "normal" },
        { name: "Inter", data: interSemi, weight: 600, style: "normal" },
        { name: "Inter", data: interRegular, weight: 400, style: "normal" },
      ],
    },
  );
}
