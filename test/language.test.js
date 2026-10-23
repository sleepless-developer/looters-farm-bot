import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const textExtension = /\.(?:js|md|json|ya?ml)$/i;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && textExtension.test(entry.name) ? [path] : [];
  }));
  return groups.flat();
}

test("repository text contains no Cyrillic text or private Windows user paths", async () => {
  const files = ["README.md", "AGENTS.md", "package.json", "package-lock.json"].map((name) => join(root, name));
  for (const directory of ["src", "test", "wiki", ".github"]) {
    files.push(...await sourceFiles(join(root, directory)));
  }
  for (const path of files) {
    const content = await readFile(path, "utf8");
    const name = relative(root, path);
    assert.doesNotMatch(content, /\p{Script=Cyrillic}/u, `${name} must be maintained in English`);
    assert.doesNotMatch(content, /[A-Z]:[\\/]Users[\\/][^\\/\s]+/i, `${name} contains a private machine path`);
  }
});
