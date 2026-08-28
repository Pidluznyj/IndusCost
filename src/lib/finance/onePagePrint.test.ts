/**
 * One Page — paginação A4 e PDF (puro).
 *
 * Provas: quebra SEMPRE entre seções (nunca no meio de um card), seção maior
 * que a folha é fatiada sem perder conteúdo, uma página só gera um arquivo
 * sem sufixo, e o PDF montado é estruturalmente válido (uma página A4 por
 * imagem JPEG, xref coerente).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ONE_PAGE_A4_HEIGHT_PX,
  ONE_PAGE_A4_WIDTH_PX,
  buildOnePageA4PdfBytes,
  buildOnePagePrintFileName,
  computeOnePagePrintSlices,
} from "./onePagePrint.js";

const PAGE = ONE_PAGE_A4_HEIGHT_PX; // 1123

describe("computeOnePagePrintSlices — quebra entre seções", () => {
  it("conteúdo que cabe numa folha vira UMA página inteira", () => {
    const slices = computeOnePagePrintSlices(
      [
        { top: 0, height: 300 },
        { top: 320, height: 400 },
      ],
      760
    );
    assert.deepEqual(slices, [{ startY: 0, endY: 760 }]);
  });

  it("seção que não cabe no restante desce INTEIRA para a próxima página", () => {
    const slices = computeOnePagePrintSlices(
      [
        { top: 0, height: 700 },
        { top: 720, height: 600 }, // 720+600=1320 > 1123 → quebra em 720
        { top: 1340, height: 200 },
      ],
      1560
    );
    assert.equal(slices.length, 2);
    assert.deepEqual(slices[0], { startY: 0, endY: 720 });
    assert.deepEqual(slices[1], { startY: 720, endY: 1560 });
    // Nenhuma página excede a altura A4.
    for (const s of slices) assert.ok(s.endY - s.startY <= PAGE);
  });

  it("seção MAIOR que a folha é fatiada em alturas de página (nada se perde)", () => {
    const slices = computeOnePagePrintSlices(
      [
        { top: 0, height: 200 },
        { top: 220, height: 2600 }, // ~2.4 folhas
      ],
      2820
    );
    assert.equal(slices[0]!.startY, 0);
    assert.equal(slices[0]!.endY, 220, "quebra antes da seção gigante");
    const covered = slices.reduce((sum, s) => sum + (s.endY - s.startY), 0);
    assert.equal(covered, 2820, "cobertura total — nenhum pixel descartado");
    for (const s of slices) assert.ok(s.endY - s.startY <= PAGE);
    // Fatias contíguas, sem sobreposição.
    for (let i = 1; i < slices.length; i += 1) {
      assert.equal(slices[i]!.startY, slices[i - 1]!.endY);
    }
  });

  it("sem blocos marcados: fatia dura por altura de página (fallback)", () => {
    const slices = computeOnePagePrintSlices([], 2500);
    assert.equal(slices.length, 3);
    assert.deepEqual(slices[2], { startY: 2246, endY: 2500 });
  });

  it("conteúdo vazio não gera página", () => {
    assert.deepEqual(computeOnePagePrintSlices([], 0), []);
  });
});

describe("buildOnePagePrintFileName", () => {
  const now = new Date(2026, 7, 28);

  it("uma página só = arquivo sem sufixo; várias = pagina-N-de-M", () => {
    assert.equal(
      buildOnePagePrintFileName("one-page-financeiro", "jpg", {
        page: 1,
        totalPages: 1,
        now,
      }),
      "one-page-financeiro-2026-08-28.jpg"
    );
    assert.equal(
      buildOnePagePrintFileName("one-page-financeiro", "jpg", {
        page: 2,
        totalPages: 3,
        now,
      }),
      "one-page-financeiro-2026-08-28-pagina-2-de-3.jpg"
    );
    assert.equal(
      buildOnePagePrintFileName("one-page-financeiro", "pdf", { now }),
      "one-page-financeiro-2026-08-28.pdf"
    );
  });
});

describe("buildOnePageA4PdfBytes — PDF mínimo estruturalmente válido", () => {
  // JPEG fake: bytes marcadores (o PDF só embute — não decodifica).
  const fakeJpeg = (fill: number) => new Uint8Array([0xff, 0xd8, fill, 0xff, 0xd9]);
  const pageDims = { widthPx: ONE_PAGE_A4_WIDTH_PX * 3, heightPx: ONE_PAGE_A4_HEIGHT_PX * 3 };

  it("duas páginas → duas /Page A4, duas imagens DCTDecode, xref e EOF corretos", () => {
    const bytes = buildOnePageA4PdfBytes([
      { jpeg: fakeJpeg(0x01), ...pageDims },
      { jpeg: fakeJpeg(0x02), ...pageDims },
    ]);
    const text = new TextDecoder("latin1").decode(bytes);
    assert.ok(text.startsWith("%PDF-1.4"));
    assert.equal((text.match(/\/Type \/Page /g) ?? []).length, 2);
    assert.equal((text.match(/\/Filter \/DCTDecode/g) ?? []).length, 2);
    assert.match(text, /\/Count 2/);
    assert.match(text, /MediaBox \[0 0 595\.28 841\.89\]/);
    assert.ok(text.trimEnd().endsWith("%%EOF"));
    // startxref aponta EXATAMENTE para a tabela xref.
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
    assert.equal(text.slice(startxref, startxref + 4), "xref");
    // Offsets da xref apontam para os "N 0 obj" reais.
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    assert.equal(offsets.length, 8, "1 catálogo + 1 pages + 3 objetos × 2 páginas");
    offsets.forEach((off, idx) => {
      assert.match(
        text.slice(off, off + 12),
        new RegExp(`^${idx + 1} 0 obj`),
        `offset do objeto ${idx + 1}`
      );
    });
    // Os bytes do JPEG entram intactos no stream.
    const raw = Array.from(bytes);
    const findSeq = (seq: number[]) =>
      raw.some((_, i) => seq.every((b, j) => raw[i + j] === b));
    assert.ok(findSeq([0xff, 0xd8, 0x01, 0xff, 0xd9]));
    assert.ok(findSeq([0xff, 0xd8, 0x02, 0xff, 0xd9]));
  });

  it("página com proporção A4 preenche a folha inteira (imagem ancorada no topo)", () => {
    const bytes = buildOnePageA4PdfBytes([{ jpeg: fakeJpeg(0x03), ...pageDims }]);
    const text = new TextDecoder("latin1").decode(bytes);
    // Altura desenhada ≈ altura da folha → y de ancoragem ≈ 0.
    const cm = /q\n595\.28 0 0 (\d+\.?\d*) 0 (-?\d+\.?\d*) cm/.exec(text);
    assert.ok(cm, "matriz de desenho presente");
    const drawHeight = Number(cm![1]);
    const drawY = Number(cm![2]);
    assert.ok(Math.abs(drawHeight - 841.89) < 1.5, "imagem cobre a altura da folha");
    assert.ok(Math.abs(drawY) < 1.5, "sem faixa vazia no rodapé");
  });

  it("sem páginas → erro claro", () => {
    assert.throws(() => buildOnePageA4PdfBytes([]), /sem páginas/);
  });
});
