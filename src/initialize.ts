import { existsSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_FILE_NAME, INITIAL_CONFIG_CONTENT } from "./config.js";
import { syncDirectory, writeNewFileDurably } from "./durable-file.js";

export function initializeRepositoryConfig(repositoryRoot: string): string {
  const path = join(repositoryRoot, CONFIG_FILE_NAME);
  if (existsSync(path)) {
    throw new Error(`${CONFIG_FILE_NAME} already exists; RepoFit refused to overwrite it.`);
  }
  writeNewFileDurably(path, INITIAL_CONFIG_CONTENT, 0o644);
  syncDirectory(repositoryRoot);
  return path;
}
