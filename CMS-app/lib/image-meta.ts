// ── Image ownership metadata ──
//
// Images are plain files, so their owner can't live on the file itself. We
// keep a single sidecar manifest — content/images/.metadata.json — keyed by
// the image's relative path (e.g. "images/foo/bar.png"), mirroring the
// per-folder .order.json pattern. Read/written through the storage
// abstraction so it works in both local-fs and GitHub modes, and excluded
// from the image listing (it isn't an image extension).

import { getFile, putFile } from "./storage";
import type { ImageMeta, ImageMetadataMap } from "./types";

const META_PATH = "content/images/.metadata.json";

export async function loadImageMeta(): Promise<ImageMetadataMap> {
  try {
    const file = await getFile(META_PATH);
    const data = JSON.parse(file.content) as ImageMetadataMap;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

/**
 * Record (or overwrite) the owner of a single image, preserving every other
 * entry. `file` is the image's relative path, e.g. "images/foo/bar.png".
 */
export async function setImageOwner(
  file: string,
  meta: ImageMeta
): Promise<void> {
  const map = await loadImageMeta();
  map[file] = meta;
  await putFile(
    META_PATH,
    JSON.stringify(map, null, 2),
    `Record owner for ${file}`
  );
}
