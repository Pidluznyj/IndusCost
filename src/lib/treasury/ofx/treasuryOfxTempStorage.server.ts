/**
 * Armazenamento temporário seguro para arquivos OFX (server-only).
 * Diretório exclusivo, permissões restritas quando o SO permitir, descarte explícito.
 */

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { TREASURY_OFX_TEMP_DIR_PREFIX } from "./treasuryOfxConstants.js";
import { hashTreasuryOfxBuffer } from "./treasuryOfxIntakeRules.js";

export type TreasuryOfxStagedFile = {
  rootDir: string;
  filePath: string;
  sha256: string;
  byteLength: number;
  originalName: string;
  stagedAtIso: string;
};

export type TreasuryOfxTempStorage = {
  /** Cria diretório exclusivo e grava o buffer (não reutiliza paths previsíveis). */
  stage(input: {
    buffer: Buffer;
    originalName: string;
    sha256?: string;
  }): TreasuryOfxStagedFile;
  read(filePath: string): Buffer;
  /** Remove arquivo e diretório pai temporário. Idempotente. */
  discard(staged: Pick<TreasuryOfxStagedFile, "rootDir" | "filePath">): void;
};

function safeBaseName(originalName: string): string {
  const base = originalName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  return base || "upload.ofx";
}

export function createTreasuryOfxTempStorage(options?: {
  baseTempDir?: string;
}): TreasuryOfxTempStorage {
  const baseTempDir = options?.baseTempDir ?? tmpdir();

  return {
    stage(input) {
      const rootDir = mkdtempSync(join(baseTempDir, TREASURY_OFX_TEMP_DIR_PREFIX));
      try {
        chmodSync(rootDir, 0o700);
      } catch {
        // Windows pode ignorar chmod — diretório ainda é exclusivo via mkdtemp.
      }

      const token = randomBytes(8).toString("hex");
      const filePath = join(rootDir, `${token}-${safeBaseName(input.originalName)}`);
      const sha256 = input.sha256 ?? hashTreasuryOfxBuffer(input.buffer);

      // flag wx: falha se existir (não sobrescreve).
      writeFileSync(filePath, input.buffer, { flag: "wx", mode: 0o600 });

      return {
        rootDir,
        filePath,
        sha256,
        byteLength: input.buffer.byteLength,
        originalName: input.originalName,
        stagedAtIso: new Date().toISOString(),
      };
    },

    read(filePath) {
      if (!existsSync(filePath)) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Arquivo OFX temporário não encontrado.",
          "file"
        );
      }
      return readFileSync(filePath);
    },

    discard(staged) {
      try {
        if (staged.filePath && existsSync(staged.filePath)) {
          rmSync(staged.filePath, { force: true });
        }
      } catch {
        /* ignore */
      }
      try {
        if (staged.rootDir && existsSync(staged.rootDir)) {
          rmSync(staged.rootDir, { recursive: true, force: true });
        }
      } catch {
        /* ignore */
      }
    },
  };
}

/** Helper de teste: garante diretório base isolado. */
export function ensureTreasuryOfxTempBase(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
