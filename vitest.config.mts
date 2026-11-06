import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // Every node_modules, not just the one at the root. A git worktree under
    // .claude/ has its own, and the tsconfig-paths package ships its own test
    // files — so a worktree existing turned `pnpm test` into 1,747 files and
    // three failures out of somebody else's suite.
    exclude: ["**/node_modules/**", "**/.next/**", ".claude/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
