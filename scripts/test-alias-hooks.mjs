// Resolves the `@/` alias used by the app so Node's test runner can load
// TypeScript modules without a bundler or a new dependency.
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  const resolved = specifier.startsWith("@/")
    ? {
        url: pathToFileURL(
          join(
            root,
            specifier.slice(2).endsWith(".ts")
              ? specifier.slice(2)
              : `${specifier.slice(2)}.ts`
          )
        ).href,
        shortCircuit: true,
      }
    : await nextResolve(specifier, context);

  if (resolved.url.endsWith(".json")) {
    return {
      ...resolved,
      importAttributes: { ...resolved.importAttributes, type: "json" },
    };
  }

  return resolved;
}
