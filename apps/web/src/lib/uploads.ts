import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve, extname } from "node:path";

/**
 * Server-only media storage on a local volume (`UPLOAD_DIR`). The BFF owns the
 * bytes; graph-service only ever stores the resulting URL string. Swap this
 * module's backend for S3/MinIO later without touching callers.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/data/uploads";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", avif: "image/avif",
};

export interface SavedMedia {
  /** Same-origin URL the browser loads (served by GET /api/media/[...]). */
  url: string;
}

/** Persist an uploaded image under `subdir`. Throws on non-image / oversize. */
export async function saveUpload(file: File, subdir = "uploads"): Promise<SavedMedia> {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("no file");
  const ext = EXT_BY_MIME[file.type];
  if (!ext) throw new Error("unsupported image type");
  if (file.size > MAX_BYTES) throw new Error("image too large (max 8 MB)");

  const safeSub = subdir.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "uploads";
  const dir = join(UPLOAD_DIR, safeSub);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));
  return { url: `/api/media/${safeSub}/${name}` };
}

/** Read a stored media file for GET /api/media/[...]; guards against traversal. */
export async function readMedia(parts: string[]): Promise<{ bytes: Buffer; contentType: string } | null> {
  const rel = parts.map((p) => p.replace(/[^a-zA-Z0-9._-]/g, "")).filter(Boolean);
  if (!rel.length) return null;
  const full = resolve(UPLOAD_DIR, ...rel);
  if (!full.startsWith(resolve(UPLOAD_DIR))) return null; // path traversal guard
  try {
    const bytes = await readFile(full);
    const ext = extname(full).slice(1).toLowerCase();
    return { bytes, contentType: MIME_BY_EXT[ext] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}
