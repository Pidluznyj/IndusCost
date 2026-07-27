/**
 * Pipeline seguro de inspeção OFX: intake → temp → parse → descarte.
 * Não persiste transações no banco.
 */

import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { assertTreasuryOfxIntake } from "./treasuryOfxIntakeRules.js";
import {
  parseTreasuryOfxBuffer,
  type TreasuryOfxParseResult,
} from "./treasuryOfxParser.js";
import {
  createTreasuryOfxTempStorage,
  type TreasuryOfxTempStorage,
} from "./treasuryOfxTempStorage.server.js";

export type TreasuryOfxInspectionInput = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
};

export type TreasuryOfxInspectionResult = TreasuryOfxParseResult & {
  discarded: boolean;
  stagedPathWasUsed: boolean;
};

/**
 * Valida, stageia em temp seguro, parseia e sempre descarta o arquivo temporário.
 * Não grava transações.
 */
export function inspectTreasuryOfxUpload(
  input: TreasuryOfxInspectionInput,
  deps?: {
    tempStorage?: TreasuryOfxTempStorage;
    quarantineInvalid?: boolean;
  }
): TreasuryOfxInspectionResult {
  const intake = assertTreasuryOfxIntake(input.buffer, {
    originalName: input.originalName,
    mimeType: input.mimeType,
    byteLength: input.buffer.byteLength,
  });

  const temp = deps?.tempStorage ?? createTreasuryOfxTempStorage();
  const staged = temp.stage({
    buffer: input.buffer,
    originalName: input.originalName,
    sha256: intake.sha256,
  });

  try {
    const fromDisk = temp.read(staged.filePath);
    if (fromDisk.byteLength !== input.buffer.byteLength) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        "Arquivo temporário OFX corrompido na leitura.",
        "file"
      );
    }
    const parsed = parseTreasuryOfxBuffer(fromDisk, {
      fileSha256: staged.sha256,
      quarantineInvalid: deps?.quarantineInvalid === true,
    });
    return {
      ...parsed,
      discarded: true,
      stagedPathWasUsed: true,
    };
  } finally {
    temp.discard(staged);
  }
}
