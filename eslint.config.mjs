import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"
import prettier from "eslint-config-prettier/flat"

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Turns off every stylistic rule so ESLint never fights Prettier.
  prettier,
  {
    rules: {
      // Every if/else/for/while body gets braces; Prettier then puts it on its own line.
      curly: ["error", "all"],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "old/**"]),
])
