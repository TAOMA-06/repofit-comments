export function automaticWritesSupported(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform !== "win32";
}

export function automaticWriteBlockReason(
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return automaticWritesSupported(platform)
    ? undefined
    : "Automatic writes are disabled on Windows until DACL privacy and no-clobber filesystem semantics are independently verified. Read-only check, preview, profile, explain, doctor, and SARIF remain available.";
}
