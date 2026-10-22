import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Layer boundaries: frontend and backend only meet through src/shared and the HTTP API.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/frontend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/backend/*", "**/backend/**"], message: "Frontend must call the API via apiClient, not import backend code." },
            { group: ["@supabase/*"], message: "Frontend never talks to Supabase directly; use /api/v1." },
          ],
        },
      ],
    },
  },
  {
    // The one exception: the browser's Realtime socket (live import progress). Data still flows
    // through /api/v1; this file only listens for change notifications, authorised by RLS.
    files: ["src/frontend/lib/realtime.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/backend/*", "**/backend/**"], message: "Frontend must call the API via apiClient, not import backend code." }] },
      ],
    },
  },
  {
    files: ["src/backend/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/frontend/*", "**/frontend/**"], message: "Backend must not import frontend code." }] },
      ],
    },
  },
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/frontend/*", "@/backend/*"], message: "Shared code must stay dependency-free of either side." },
            { group: ["server-only", "next/*", "react"], message: "Shared code must run on both client and server." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/**/page.tsx", "src/app/**/layout.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/backend/*"], message: "Pages are routing shells; render from @/frontend." }] },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "report/**", "next-env.d.ts", "src/backend/supabase/database.types.ts"]),
]);

export default eslintConfig;
