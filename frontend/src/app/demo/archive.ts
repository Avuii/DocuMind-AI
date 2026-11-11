import { Unzip, UnzipInflate } from "fflate";

const limit = 29_000_000;
const types: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
export const baseName = (path: string) => path.replaceAll("\\", "/").split("/").pop() ?? "";
export const mimeType = (name: string) => {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  return Object.hasOwn(types, extension) ? types[extension] : undefined;
};

export async function unpackArchive(archive: File) {
  if (archive.size > 30_000_000) throw new Error("The file exceeds the demo upload limit.");
  const input = new Uint8Array(await archive.arrayBuffer());
  const files: File[] = [];
  const skipped: string[] = [];
  let count = 0;
  let total = 0;
  const unzip = new Unzip((entry) => {
    if (++count > 100) throw new Error("A ZIP archive can contain up to 100 entries.");
    const name = baseName(entry.name);
    if (!name) return;
    const type = mimeType(name);
    if (!type || name.length > 260) { skipped.push(name); return; }
    let size = 0;
    const chunks: ArrayBuffer[] = [];
    entry.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length;
      total += data.length;
      if (size > limit || total > 60_000_000) throw new Error("The ZIP exceeds the demo unpacked size limit.");
      chunks.push(Uint8Array.from(data).buffer);
      if (final && size) files.push(new File(chunks, name, { type }));
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  // Bounded input chunks keep a malformed entry from inflating in one large allocation.
  for (let pos = 0; pos < input.length; pos += 4096) {
    unzip.push(input.subarray(pos, pos + 4096), pos + 4096 >= input.length);
  }
  if (!files.length) throw new Error("The ZIP contains no supported documents.");
  return { files, skipped };
}
