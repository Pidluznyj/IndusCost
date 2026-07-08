/**
 * Armazenamento local de arquivos binários (uploads persistentes).
 * Padrão: diretório `data/uploads/` na raiz do projeto (gitignored).
 * Override via `APP_UPLOADS_DIR`.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export function getAppUploadsRoot(): string {
  return process.env.APP_UPLOADS_DIR?.trim() || path.join(process.cwd(), "data", "uploads");
}

export function resolveAppUploadAbsolutePath(storageKey: string): string {
  const uploadsRoot = getAppUploadsRoot();
  const normalized = storageKey.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) {
    throw new Error("Chave de armazenamento inválida.");
  }
  const absolute = path.resolve(uploadsRoot, normalized);
  const rootResolved = path.resolve(uploadsRoot);
  if (!absolute.startsWith(rootResolved + path.sep) && absolute !== rootResolved) {
    throw new Error("Chave de armazenamento inválida.");
  }
  return absolute;
}

function sanitizeFileName(originalName: string): string {
  const base = path.basename(originalName).trim() || "arquivo";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
  return cleaned || "arquivo";
}

export type SaveAppLocalFileInput = {
  namespace: string;
  entityId: string;
  originalFileName: string;
  buffer: Buffer;
};

export type SaveAppLocalFileResult = {
  storageKey: string;
  fileName: string;
  fileSize: number;
};

export async function saveAppLocalFile(input: SaveAppLocalFileInput): Promise<SaveAppLocalFileResult> {
  const namespace = input.namespace.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "files";
  const entityId = input.entityId.replace(/[^a-z0-9-]/gi, "").toLowerCase();
  const safeName = sanitizeFileName(input.originalFileName);
  const unique = randomUUID().slice(0, 8);
  const storageKey = path.posix.join(namespace, entityId, `${unique}-${safeName}`);
  const uploadsRoot = getAppUploadsRoot();
  const absolute = resolveAppUploadAbsolutePath(storageKey);

  if (!existsSync(uploadsRoot)) {
    mkdirSync(uploadsRoot, { recursive: true });
  }
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, input.buffer);

  return {
    storageKey: storageKey.replace(/\\/g, "/"),
    fileName: path.basename(storageKey),
    fileSize: input.buffer.byteLength,
  };
}

export async function readAppLocalFile(storageKey: string): Promise<Buffer> {
  return readFile(resolveAppUploadAbsolutePath(storageKey));
}

export async function deleteAppLocalFile(storageKey: string): Promise<void> {
  try {
    await unlink(resolveAppUploadAbsolutePath(storageKey));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw error;
  }
}

export function fingerprintAppLocalFile(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
