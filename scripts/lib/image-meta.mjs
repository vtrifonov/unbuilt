import zlib from "node:zlib";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const XMP_PREFIX = "http://ns.adobe.com/xap/1.0/";

// Inflated text chunks are capped so a small file cannot exhaust memory (decompression bomb).
const MAX_INFLATED_BYTES = 1048576;

const utf8 = (b) => new TextDecoder("utf-8").decode(b);

// Returns the inflated buffer, or a string error that becomes the "cannot be parsed" finding.
function inflateCapped(body, chunk) {
  try {
    return zlib.inflateSync(body, { maxOutputLength: MAX_INFLATED_BYTES });
  } catch (err) {
    return err?.code === "ERR_BUFFER_TOO_LARGE" ? `${chunk} chunk inflates past 1 MiB` : `${chunk} chunk failed to inflate`;
  }
}
const latin1 = (b) => Buffer.from(b).toString("latin1");

function detect(buf) {
  if (buf.length >= 8 && PNG_MAGIC.every((v, i) => buf[i] === v)) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 12 && latin1(buf.subarray(0, 4)) === "RIFF" && latin1(buf.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

function splitNul(data, from = 0) {
  const i = data.indexOf(0, from);
  return i < 0 ? [data.subarray(from), data.length] : [data.subarray(from, i), i + 1];
}

function parsePng(buf, segments) {
  let off = 8;
  let seenIdat = false;
  for (;;) {
    if (buf.length - off < 12) return seenIdat ? null : "truncated PNG chunk";
    const len = buf.readUInt32BE(off);
    if (off + 12 + len > buf.length) return seenIdat ? null : "truncated PNG chunk";
    const type = latin1(buf.subarray(off + 4, off + 8));
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === "IEND") return null;
    if (type === "IDAT") {
      seenIdat = true;
    } else if (type === "tEXt") {
      const [kw, p] = splitNul(data);
      segments.push(latin1(kw) + "\n" + latin1(data.subarray(p)));
    } else if (type === "zTXt") {
      const [kw, p] = splitNul(data);
      const text = inflateCapped(data.subarray(p + 1), "zTXt");
      if (typeof text === "string") return text;
      segments.push(latin1(kw) + "\n" + latin1(text));
    } else if (type === "iTXt") {
      const [kw, p] = splitNul(data);
      const compressed = data[p] === 1;
      const [, afterLang] = splitNul(data, Math.min(p + 2, data.length));
      const [tkw, textStart] = splitNul(data, afterLang);
      let body = data.subarray(textStart);
      if (compressed) {
        body = inflateCapped(body, "iTXt");
        if (typeof body === "string") return body;
      }
      segments.push(latin1(kw) + "\n" + utf8(tkw) + "\n" + utf8(body));
    } else if (type === "eXIf") {
      segments.push(latin1(data));
    }
  }
}

function parseJpeg(buf, segments) {
  const bad = "malformed JPEG segment";
  let off = 2;
  while (off < buf.length) {
    if (buf[off] !== 0xff) return bad;
    while (off < buf.length && buf[off] === 0xff) off++;
    if (off >= buf.length) return bad;
    const marker = buf[off];
    off++;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (marker === 0xda || marker === 0xd9) return null;
    if (off + 2 > buf.length) return bad;
    const length = buf.readUInt16BE(off);
    if (length < 2 || off + length > buf.length) return bad;
    const payload = buf.subarray(off + 2, off + length);
    off += length;
    if (marker === 0xe1) segments.push(latin1(payload.subarray(0, XMP_PREFIX.length)) === XMP_PREFIX ? utf8(payload) : latin1(payload));
    else if (marker === 0xfe) segments.push(latin1(payload));
  }
  return bad;
}

function parseWebp(buf, segments) {
  const bad = "truncated WebP chunk";
  const riffSize = buf.readUInt32LE(4);
  // An understated RIFF size would hide trailing chunks from the scan.
  if (riffSize < 4 || riffSize + 8 < buf.length) return bad;
  const end = Math.min(riffSize + 8, buf.length);
  let off = 12;
  while (off < end) {
    if (off + 8 > end) return bad;
    const fourcc = latin1(buf.subarray(off, off + 4));
    const size = buf.readUInt32LE(off + 4);
    if (off + 8 + size > end) return bad;
    const data = buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
    if (fourcc === "EXIF") segments.push(latin1(data));
    else if (fourcc === "XMP ") segments.push(utf8(data));
  }
  return null;
}

export function extractImageText(buf) {
  const segments = [];
  const format = detect(buf);
  if (format === null) return { format, segments, error: "unrecognised image format" };
  let error;
  try {
    error = format === "png" ? parsePng(buf, segments) : format === "jpeg" ? parseJpeg(buf, segments) : parseWebp(buf, segments);
  } catch {
    error = format === "png" ? "truncated PNG chunk" : format === "jpeg" ? "malformed JPEG segment" : "truncated WebP chunk";
  }
  return { format, segments, error };
}
