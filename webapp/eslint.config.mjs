import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import stylistic from "@stylistic/eslint-plugin";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    plugins: { "@stylistic": stylistic },
    rules: {
      curly: ["error", "all"],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "*" },
        { blankLine: "any", prev: ["const", "let"], next: ["const", "let"] },
        { blankLine: "any", prev: "import", next: "import" },
      ],
    },
  },
  globalIgnores([".next/**", "coverage/**", "next-env.d.ts"]),
]);
