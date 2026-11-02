// Resolves the `@/` alias used by the app so Node's test runner can load
// TypeScript modules without a bundler or a new dependency.
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    const target = relative.endsWith(".ts") ? relative : `${relative}.ts`;

    return {
      url: pathToFileURL(join(root, target)).href,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}
