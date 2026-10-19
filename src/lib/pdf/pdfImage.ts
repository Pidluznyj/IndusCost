/**
 * Imagens (logo) para os PDFs escritos à mão — sem biblioteca nova.
 *
 * - JPEG: embutido como está (/DCTDecode), dimensões lidas do marcador SOF.
 * - PNG (8 bits, não entrelaçado; cinza, RGB, cinza+alfa, RGBA ou paleta): descompactado com
 *   zlib nativo, filtros de linha desfeitos, canal alfa separado em /SMask e recompactado
 *   (/FlateDecode).
 * Formato não suportado → null (o documento sai sem logo, nunca quebra).
 */
import { deflateSync, inflateSync } from "node:zlib";

export type PdfImageObject = {
  width: number;
  height: number;
  /** Dicionário sem /Length (o montador acrescenta). */
  dict: string;
  data: Buffer;
  smask?: { dict: string; data: Buffer };
};

export function parseImageDataUrl(dataUrl: string | null | undefined): { mime: string; bytes: Buffer } | null {
  if (!dataUrl) return null;
  const m = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[2].replace(/\s+/g, ""), "base64") };
}

function jpegImage(bytes: Buffer): PdfImageObject | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const len = bytes.readUInt16BE(i + 2);
    // SOF0..SOF15, exceto DHT(C4), JPG(C8), DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = bytes.readUInt16BE(i + 5);
      const width = bytes.readUInt16BE(i + 7);
      const components = bytes[i + 9];
      const space = components === 1 ? "/DeviceGray" : components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
      const decode = components === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : "";
      return {
        width,
        height,
        dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode${decode}`,
        data: bytes,
      };
    }
    i += 2 + len;
  }
  return null;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function pngImage(bytes: Buffer): PdfImageObject | null {
  const SIG = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== SIG) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(pos);
    const type = bytes.subarray(pos + 4, pos + 8).toString("latin1");
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0) return null;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels || (colorType === 3 && !palette)) return null;

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      const v = src[x];
      out[x] =
        filter === 0 ? v
        : filter === 1 ? (v + a) & 255
        : filter === 2 ? (v + b) & 255
        : filter === 3 ? (v + ((a + b) >> 1)) & 255
        : filter === 4 ? (v + paeth(a, b, c)) & 255
        : v;
    }
  }

  const n = width * height;
  const isGray = colorType === 0 || colorType === 4;
  const color = Buffer.alloc(n * (isGray ? 1 : 3));
  let alpha: Buffer | null = null;
  if (colorType === 4 || colorType === 6 || (colorType === 3 && trns)) alpha = Buffer.alloc(n);
  for (let i = 0; i < n; i += 1) {
    if (colorType === 0) color[i] = pixels[i];
    else if (colorType === 4) {
      color[i] = pixels[i * 2];
      alpha![i] = pixels[i * 2 + 1];
    } else if (colorType === 2) pixels.copy(color, i * 3, i * 3, i * 3 + 3);
    else if (colorType === 6) {
      pixels.copy(color, i * 3, i * 4, i * 4 + 3);
      alpha![i] = pixels[i * 4 + 3];
    } else {
      const idx = pixels[i];
      palette!.copy(color, i * 3, idx * 3, idx * 3 + 3);
      if (alpha) alpha[i] = idx < trns!.length ? trns![idx] : 255;
    }
  }
  const space = isGray ? "/DeviceGray" : "/DeviceRGB";
  const img: PdfImageObject = {
    width,
    height,
    dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /FlateDecode`,
    data: deflateSync(color),
  };
  if (alpha && alpha.some((v) => v !== 255)) {
    img.smask = {
      dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
      data: deflateSync(alpha),
    };
  }
  return img;
}

/** Logo (data URL) → imagem PDF, ou null se o formato não for suportado. */
export function pdfImageFromDataUrl(dataUrl: string | null | undefined): PdfImageObject | null {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) return null;
  try {
    if (parsed.mime === "image/jpeg" || parsed.mime === "image/jpg") return jpegImage(parsed.bytes);
    if (parsed.mime === "image/png") return pngImage(parsed.bytes);
  } catch {
    return null;
  }
  return null;
}
