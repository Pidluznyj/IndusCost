/**
 * Runner de testes unitários — evita estourar o limite de linha do cmd.exe no Windows.
 * Lista canônica em scripts/unit-test-files.txt
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const listPath = join(root, "scripts/unit-test-files.txt");
const files = readFileSync(listPath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));

if (files.length === 0) {
  console.error("scripts/unit-test-files.txt está vazio");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: false,
  }
);

process.exit(result.status ?? 1);
