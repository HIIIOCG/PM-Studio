import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const fontDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../web/dist/fonts');
const fonts = Object.freeze([
  { url: '/fonts/Inter.woff2', file: 'Inter.woff2', license: 'Inter-OFL.txt', sha256: '13b4cddc57045d40b411008e61588c8f81aa0bd72fe884624831a0ff9c4d159a' },
  { url: '/fonts/NotoSansTC.woff2', file: 'NotoSansTC.woff2', license: 'NotoSansTC-OFL.txt', sha256: '3813cdfcb1de18e3befd3aaeeec02510344e088f3b486166a1c8d71d483cbda3' },
]);
const knownTags = ('cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill').split(' ').map(tag => tag.replace('_', ' '));
const maximumFontBytes = 16 * 1024 * 1024;
const maximumDecodedBytes = 64 * 1024 * 1024;
const invalidFont = () => new Error('Invalid bundled variable WOFF2 font.');

// Validate the actual font container and its compressed table stream before
// embedding it. A magic prefix alone would also accept truncated/corrupt files.
export function validateWoff2(value) {
  const bytes = Buffer.from(value);
  if (bytes.length < 48 || bytes.length > maximumFontBytes || bytes.toString('ascii', 0, 4) !== 'wOF2'
    || ![0x00010000, 0x4f54544f].includes(bytes.readUInt32BE(4)) || bytes.readUInt32BE(8) !== bytes.length
    || bytes.readUInt16BE(14) !== 0) throw invalidFont();
  const count = bytes.readUInt16BE(12), sfntSize = bytes.readUInt32BE(16), compressedSize = bytes.readUInt32BE(20);
  if (!count || count > 4095 || !compressedSize || sfntSize > maximumDecodedBytes) throw invalidFont();
  let cursor = 48, decodedSize = 0, expectedSfntSize = 12 + count * 16;
  const tables = new Map();
  function readBase128() {
    let result = 0;
    for (let index = 0; index < 5; index++) {
      if (cursor >= bytes.length) throw invalidFont();
      const next = bytes[cursor++];
      if ((!index && next === 0x80) || result > 0x1ffffff) throw invalidFont();
      result = result * 128 + (next & 0x7f);
      if (!(next & 0x80)) return result;
    }
    throw invalidFont();
  }
  for (let index = 0; index < count; index++) {
    if (cursor >= bytes.length) throw invalidFont();
    const flags = bytes[cursor++], tagIndex = flags & 63, version = flags >>> 6;
    let tag = knownTags[tagIndex];
    if (tagIndex === 63) {
      if (cursor + 4 > bytes.length) throw invalidFont();
      tag = bytes.toString('ascii', cursor, cursor + 4); cursor += 4;
      if (!/^[\x20-\x7e]{4}$/.test(tag)) throw invalidFont();
    }
    if (tables.has(tag)) throw invalidFont();
    const originalLength = readBase128();
    let transformed = false;
    if (tag === 'glyf' || tag === 'loca') {
      if (![0, 3].includes(version)) throw invalidFont();
      transformed = version === 0;
    } else if (tag === 'hmtx') {
      if (version > 1) throw invalidFont();
      transformed = version === 1;
    } else if (version !== 0) throw invalidFont();
    const length = transformed ? readBase128() : originalLength;
    if ((tag === 'loca' && transformed && length !== 0) || !originalLength) throw invalidFont();
    tables.set(tag, { offset: decodedSize, length });
    decodedSize += length; expectedSfntSize += Math.ceil(originalLength / 4) * 4;
    if (decodedSize > maximumDecodedBytes) throw invalidFont();
  }
  if (sfntSize !== expectedSfntSize || cursor + compressedSize > bytes.length) throw invalidFont();
  let decoded;
  try { decoded = brotliDecompressSync(bytes.subarray(cursor, cursor + compressedSize), { maxOutputLength: maximumDecodedBytes }); }
  catch { throw invalidFont(); }
  if (decoded.length !== decodedSize) throw invalidFont();
  const blocks = [{ start: 0, end: cursor + compressedSize }];
  const metadataOffset = bytes.readUInt32BE(28), metadataLength = bytes.readUInt32BE(32), metadataOriginalLength = bytes.readUInt32BE(36);
  const privateOffset = bytes.readUInt32BE(40), privateLength = bytes.readUInt32BE(44);
  if ((!metadataOffset && (metadataLength || metadataOriginalLength)) || (metadataOffset && (!metadataLength || !metadataOriginalLength))
    || (!privateOffset && privateLength) || (privateOffset && !privateLength)) throw invalidFont();
  for (const [start, length] of [[metadataOffset, metadataLength], [privateOffset, privateLength]]) if (start) {
    if (start % 4 || start < blocks.at(-1).end || start + length > bytes.length) throw invalidFont();
    blocks.push({ start, end: start + length });
  }
  for (let index = 1; index < blocks.length; index++) {
    const gap = bytes.subarray(blocks[index - 1].end, blocks[index].start);
    if (gap.length > 3 || gap.some(byte => byte !== 0)) throw invalidFont();
  }
  const trailing = bytes.subarray(blocks.at(-1).end);
  if (trailing.length > 3 || trailing.some(byte => byte !== 0)) throw invalidFont();
  if (metadataOffset) {
    let metadata;
    try { metadata = brotliDecompressSync(bytes.subarray(metadataOffset, metadataOffset + metadataLength), { maxOutputLength: maximumDecodedBytes }); }
    catch { throw invalidFont(); }
    if (metadata.length !== metadataOriginalLength) throw invalidFont();
  }
  const fvar = tables.get('fvar');
  if (!fvar || fvar.length < 16) throw invalidFont();
  const variation = decoded.subarray(fvar.offset, fvar.offset + fvar.length);
  const axisOffset = variation.readUInt16BE(4), axisCount = variation.readUInt16BE(8), axisSize = variation.readUInt16BE(10);
  if (variation.readUInt32BE(0) !== 0x00010000 || axisSize < 20 || !axisCount || axisOffset < 16
    || axisOffset + axisCount * axisSize > variation.length) throw invalidFont();
  let weight;
  for (let index = 0; index < axisCount; index++) {
    const offset = axisOffset + index * axisSize;
    if (variation.toString('ascii', offset, offset + 4) === 'wght') {
      weight = { min: variation.readInt32BE(offset + 4) / 65536, max: variation.readInt32BE(offset + 12) / 65536 };
    }
  }
  if (!weight || weight.min > 100 || weight.max < 900) throw invalidFont();
  return { byteLength: bytes.length, tableCount: count, weight };
}

export async function embedFontStyles(css, { fontDirectory: directory = fontDirectory } = {}) {
  if (typeof css !== 'string') throw new Error('Expected the shared stylesheet.');
  const faces = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)];
  if (faces.length !== fonts.length) throw new Error('Expected exactly the two bundled variable font faces.');
  const replacements = new Map();
  for (const match of faces) {
    const urls = [...match[0].matchAll(/url\(\s*(?:(["'])(.*?)\1|([^\s"'()]+))\s*\)/g)];
    const url = urls[0]?.[2] ?? urls[0]?.[3];
    const font = fonts.find(item => item.url === url);
    if (!font || urls.length !== 1 || replacements.has(url) || /\blocal\s*\(/i.test(match[0])
      || !/\bfont-weight\s*:\s*100\s+900\s*(?:;|\})/.test(match[0]) || !/format\(\s*["']woff2["']\s*\)/.test(match[0])) {
      throw new Error('Only the two exact bundled WOFF2 font URLs and variable weight ranges are allowed.');
    }
    const [bytes, license] = await Promise.all([readFile(resolve(directory, font.file)), readFile(resolve(directory, font.license), 'utf8')]);
    validateWoff2(bytes);
    if (createHash('sha256').update(bytes).digest('hex') !== font.sha256) {
      throw new Error('Bundled font differs from the approved full-coverage WOFF2 asset.');
    }
    if (!license.includes('SIL OPEN FONT LICENSE Version 1.1') || !license.includes('Copyright') || /\*\/|<\/style/i.test(license)) {
      throw new Error('The bundled font copyright and OFL license must be preserved safely.');
    }
    replacements.set(url, { bytes, license, file: font.file });
  }
  let result = css;
  for (const [url, { bytes }] of replacements) result = result.replace(url, 'data:font/woff2;base64,' + bytes.toString('base64'));
  const withoutFaces = css.replace(/@font-face\s*\{[^}]*\}/g, '');
  if (/url\([^)]*\.(?:woff2?|ttf|otf)(?:[?#][^)]*)?\s*["']?\s*\)/i.test(withoutFaces)) throw new Error('Unexpected font asset URL outside the bundled font faces.');
  result += '\n/* Font licenses (bundled unchanged with the embedded font software):\n'
    + [...replacements.values()].map(({ file, license }) => file + '\n' + license.trim()).join('\n\n') + '\n*/\n';
  return result;
}
