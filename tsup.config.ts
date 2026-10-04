import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "kysely/index": "src/kysely/index.ts",
  },
  format: ["esm", "cjs"],
  // tsup sets baseUrl for the dts build, which TypeScript 6 deprecates.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  clean: true,
  target: "es2022",
});
