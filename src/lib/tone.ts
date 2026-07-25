/**
 * The shared colour vocabulary (DESIGN.md §3).
 *
 * Lives in `src/lib` rather than beside the badge component because both the
 * badge and non-visual modules (the scanner's outcome table) need to speak it,
 * and `lib` is a leaf — components may import it, never the reverse. Putting
 * the type in the component would force `lib` to depend on `components`, which
 * the ESLint boundary correctly refuses.
 */
export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";
