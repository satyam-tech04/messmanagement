import { renderPoster } from "./_og/poster";

// Literals, not re-exports: Next reads these statically.
export const alt =
  "MealAdda — Hostel mess management: menus, meal plans, QR meal pass and live headcount";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return renderPoster();
}
