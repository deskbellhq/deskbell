import { defineConfig } from "vitest/config";

// Two projects: the parser, geometry and stylesheet tests run in node; the
// `*.dom.test.tsx` files render the real panel and need a DOM.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.dom.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          include: ["src/**/*.dom.test.tsx"],
          environment: "happy-dom",
        },
      },
    ],
  },
});
