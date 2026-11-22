// RNX-334: made-up photo files and the multipart body of an upload, for the profile photo specs (no real image needed:
// the API reads only the first bytes).

/** A file's first bytes (its type signature) padded with zeros to `size` bytes. */
function pad(signature: Buffer, size: number): Buffer {
  return Buffer.concat([signature, Buffer.alloc(Math.max(0, size - signature.length))]);
}

export const photoBytes = {
  png: (size = 64) => pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), size),
  jpeg: (size = 64) => pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), size),
  webp: (size = 64) => pad(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]), size),
  gif: (size = 64) => pad(Buffer.from("GIF89a"), size),
  pdf: (size = 64) => pad(Buffer.from("%PDF-1.7\n"), size),
  text: () => Buffer.from("this is not an image, only text renamed .png"),
};

const BOUNDARY = "----rnx334boundary";

/** The headers and payload of a multipart form with one file part (after any `fields`, as a browser would send them). */
export function buildMultipartUpload(options: {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Buffer;
  readonly fields?: Readonly<Record<string, string>>;
}) {
  const fields = Object.entries(options.fields ?? {}).map(
    ([name, value]) => Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
  );
  const filePart = Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${options.filename}"\r\nContent-Type: ${options.contentType}\r\n\r\n`,
    ),
    options.bytes,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  return {
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat([...fields, filePart]),
  };
}
