# UI Standard

**The bar: premium and complete.** Every surface is finished — real empty states,
loading states, error states, and dense, scannable data tables. Not a wireframe with
"TODO" in it. The client is handing this to 300–1000 students and a mess owner who will
judge the product in the first thirty seconds.

Stack: **Tailwind 4 + shadcn/ui** (`src/components/ui`), design tokens in
`src/app/globals.css`. Components are copied into the repo, so they are ours to modify —
edit them rather than wrapping them in ever-deeper layers.

---

## Non-negotiables

### 1. Every list is a real table

Not a stack of divs. Tables get: sortable column headers where it helps, a sticky header
on long lists, zebra-free but clearly separated rows, right-aligned numerics, tabular
figures (`font-variant-numeric: tabular-nums`) so digits line up, and a row count.

Every table must handle **four** states, not one:

| State         | Requirement                                                                              |
| ------------- | ---------------------------------------------------------------------------------------- |
| **Loading**   | Skeleton rows matching the real row height — never a spinner that collapses layout       |
| **Empty**     | An explanation and the action that fixes it ("No students yet — Add your first student") |
| **Error**     | What failed and a retry, never a bare "Something went wrong"                             |
| **Populated** | Dense, aligned, scannable                                                                |

An empty state that just says "No data" is unfinished work.

### 2. Money and dates are formatted, always

Money renders through the paise formatter — `₹4,000.00`, Indian digit grouping
(`₹1,00,000`, never `₹100,000`). Dates render in the **tenant's** timezone. Never print a
raw ISO string or a paise integer to a user.

### 3. Status is a badge, and colour is never the only signal

Every status enum gets a consistent badge with a fixed colour **and** a text label.
Colour alone fails for the ~8% of men with colour vision deficiency, and the scanner
screens are used at speed under bad lighting.

Fixed vocabulary — the same colour means the same thing everywhere:

- **ACTIVE / PAID / success** → emerald
- **GRACE / PENDING / warning** → amber
- **BLOCKED / OVERDUE / error** → red
- **INACTIVE / EXPIRED / CANCELLED / neutral** → slate

### 4. Three surfaces, three different designs

They are used by different people, on different devices, under different pressure:

- **Student (mobile PWA)** — one-handed. Large tap targets, bottom navigation, the QR
  code is the hero element and must be legible at arm's length in a queue.
- **Staff scanner (tablet)** — used at speed with a queue waiting. Enormous result
  feedback, distinct colour **and** sound per outcome, minimum text. A staff member must
  read the result from a metre away without leaning in.
- **Admin (desktop)** — dense and information-rich. Sidebar navigation, data tables,
  filters. This user wants more on screen, not less.

### 5. Accessibility is part of "premium"

WCAG AA contrast minimum. Every interactive element is keyboard reachable with a visible
focus ring. Forms use real `<label>` elements tied to inputs. Errors are announced with
`role="alert"`. Touch targets on the scanner and student app are at least 44×44px.

### 6. Dark mode works everywhere

Both themes are first-class. Never ship a screen that was only checked in one.

### 7. Loading is never a blank screen

Route-level `loading.tsx` with skeletons that match the eventual layout. Buttons that
trigger work show a pending state and disable to prevent double submission — which
matters doubly here, where a double-submit could mean a duplicate write.

---

## Layout conventions

- Admin content max width `1600px`, generous padding, 8px spacing grid.
- Page header on every screen: title, one-line description, primary action top-right.
- Destructive actions (block a student, void an invoice) require confirmation naming the
  specific record.
- Toasts (`sonner`) for action outcomes; inline errors for validation.

## Before calling a screen done

- [ ] Loading, empty, error and populated states all designed
- [ ] Works at 375px wide and at 1920px
- [ ] Light and dark both checked
- [ ] Keyboard-navigable, visible focus rings
- [ ] Money and dates formatted, never raw
- [ ] Destructive actions confirm first
