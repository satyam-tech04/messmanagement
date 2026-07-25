import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";

/**
 * Layering rule (architecture doc §2.2, §3.1): dependencies point INWARD only.
 *
 *   src/core   -> may import: nothing outside src/core
 *   src/infra  -> may import: src/core, src/lib
 *   src/app    -> may import: src/core, src/infra, src/components, src/lib
 *   src/lib    -> may import: src/core only  (it is a leaf: config, env, utils)
 *
 * `src/lib` is deliberately a leaf that both infra and app may depend on. It
 * holds environment config and pure helpers, nothing that performs I/O. The
 * corollary — enforced below — is that lib must never import infra or app, or
 * it stops being a leaf and the graph gains a cycle.
 *
 * Note where the Supabase clients and generated `database.types.ts` live:
 * `src/infra/supabase`, not `src/lib`. Database access and its generated types
 * ARE infrastructure. Putting them in lib would have forced infra to depend on
 * lib for its own persistence types, inverting the relationship.
 *
 * These are enforced mechanically, not by convention. A violation is a lint
 * error that fails CI, because the doc is right: an unenforced boundary is
 * violated within two weeks.
 */
const layeringZones = [
  {
    target: "./src/core",
    from: "./src/infra",
    message:
      "core must not import infra. Define a port interface in core/ports and let infra implement it.",
  },
  {
    target: "./src/core",
    from: "./src/app",
    message: "core must not import app. Domain logic cannot depend on delivery.",
  },
  {
    target: "./src/core",
    from: "./src/components",
    message: "core must not import components. Domain logic is not UI-aware.",
  },
  {
    target: "./src/core",
    from: "./src/lib",
    message:
      "core must not import lib. lib holds framework glue; move shared pure helpers into core.",
  },
  {
    target: "./src/infra",
    from: "./src/app",
    message: "infra must not import app. Infrastructure cannot depend on delivery.",
  },
  {
    target: "./src/infra",
    from: "./src/components",
    message: "infra must not import components.",
  },
  // lib is a leaf. If it reaches into infra or app it stops being safely
  // importable from everywhere and introduces a cycle.
  {
    target: "./src/lib",
    from: "./src/infra",
    message:
      "lib must not import infra. lib is a leaf (config, env, pure helpers); move I/O-aware code into infra.",
  },
  {
    target: "./src/lib",
    from: "./src/app",
    message: "lib must not import app.",
  },
  {
    target: "./src/lib",
    from: "./src/components",
    message: "lib must not import components.",
  },
];

/**
 * src/core must stay pure TypeScript: no React, no Next, no Supabase, no
 * network, no clock-reading side effects pulled from a framework. This is what
 * makes the billing + policy layer unit-testable in milliseconds with no I/O.
 */
const forbiddenCoreImports = [
  {
    group: ["react", "react-dom", "react/*", "react-dom/*"],
    message: "core must be framework-free (no React).",
  },
  { group: ["next", "next/*"], message: "core must be framework-free (no Next.js)." },
  {
    group: ["@supabase/*"],
    message: "core must be persistence-free. Use a port interface from core/ports.",
  },
  { group: ["server-only", "client-only"], message: "core is environment-agnostic by design." },
  {
    group: ["@/app/*", "@/infra/*", "@/components/*", "@/lib/*"],
    message: "core may only import from core.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    plugins: { import: importPlugin },
    settings: {
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
    },
    rules: {
      "import/no-restricted-paths": ["error", { zones: layeringZones }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: forbiddenCoreImports }],
      // Money is integer paise. Floating point has no business in the domain.
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSTypeReference[typeName.name='Float']",
          message: "Money is integer paise (bigint/number of paise). Never floats.",
        },
      ],
    },
  },

  // Tests and scripts may reach anywhere; they exist to exercise the wiring.
  {
    files: ["tests/**/*.ts", "scripts/**/*.{ts,mts,mjs,js}", "*.config.{ts,mjs,js}"],
    rules: {
      "import/no-restricted-paths": "off",
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // The verification scripts use `condition ? pass(...) : fail(...)` as a
      // statement, which reads far better than an if/else for a long list of
      // assertions. The rule earns its keep in application code — where a bare
      // expression usually means a forgotten call — but here it produced six
      // warnings on every single commit, and warnings nobody can act on are how
      // people learn to ignore lint output entirely.
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },

  prettier,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/infra/supabase/database.types.ts",
  ]),
]);

export default eslintConfig;
