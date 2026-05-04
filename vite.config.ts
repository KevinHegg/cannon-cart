import { defineConfig } from "vitest/config";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/cannon-cart/" : "/",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
}));
