export function decodeUtf8Bytes(value: Uint8Array, context: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value);
  } catch {
    throw new Error(`${context} is not valid UTF-8; RepoFit refused to process it.`);
  }
}
