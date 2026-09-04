import { createHash } from "node:crypto";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function shortHash(value: string, length = 12): string {
  return sha256(value).slice(0, length);
}
