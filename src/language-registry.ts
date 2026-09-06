export type LanguageBatch = 1 | 2 | 3;

export type LanguageId =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "swift"
  | "java"
  | "kotlin"
  | "csharp"
  | "c"
  | "cpp"
  | "php"
  | "ruby"
  | "dart"
  | "lua"
  | "vue"
  | "svelte"
  | "bash"
  | "sql";

export type ParserKind = "typescript" | "tree-sitter" | "component" | "sql";

export interface LanguageDefinition {
  readonly id: LanguageId;
  readonly label: string;
  readonly batch: LanguageBatch;
  readonly extensions: readonly string[];
  readonly parser: ParserKind;
  readonly grammarFile?: string;
  readonly grammarPackage?: string;
  readonly automaticFixes: boolean;
}

export const LANGUAGE_DEFINITIONS: readonly LanguageDefinition[] = [
  {
    id: "typescript",
    label: "TypeScript",
    batch: 1,
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    parser: "typescript",
    automaticFixes: true,
  },
  {
    id: "javascript",
    label: "JavaScript",
    batch: 1,
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    parser: "typescript",
    automaticFixes: true,
  },
  {
    id: "python",
    label: "Python",
    batch: 1,
    extensions: [".py", ".pyw"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-python.wasm",
    automaticFixes: true,
  },
  {
    id: "go",
    label: "Go",
    batch: 1,
    extensions: [".go"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-go.wasm",
    automaticFixes: true,
  },
  {
    id: "rust",
    label: "Rust",
    batch: 1,
    extensions: [".rs"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-rust.wasm",
    automaticFixes: true,
  },
  {
    id: "swift",
    label: "Swift",
    batch: 1,
    extensions: [".swift"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-swift.wasm",
    automaticFixes: true,
  },
  {
    id: "java",
    label: "Java",
    batch: 2,
    extensions: [".java"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-java.wasm",
    automaticFixes: true,
  },
  {
    id: "kotlin",
    label: "Kotlin",
    batch: 2,
    extensions: [".kt", ".kts"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-kotlin.wasm",
    automaticFixes: true,
  },
  {
    id: "csharp",
    label: "C#",
    batch: 2,
    extensions: [".cs"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-c_sharp.wasm",
    automaticFixes: true,
  },
  {
    id: "c",
    label: "C",
    batch: 2,
    extensions: [".c", ".h"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-c.wasm",
    automaticFixes: true,
  },
  {
    id: "cpp",
    label: "C++",
    batch: 2,
    extensions: [".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-cpp.wasm",
    automaticFixes: true,
  },
  {
    id: "php",
    label: "PHP",
    batch: 2,
    extensions: [".php", ".phtml"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-php.wasm",
    automaticFixes: true,
  },
  {
    id: "ruby",
    label: "Ruby",
    batch: 2,
    extensions: [".rb"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-ruby.wasm",
    automaticFixes: true,
  },
  {
    id: "dart",
    label: "Dart",
    batch: 2,
    extensions: [".dart"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-dart.wasm",
    automaticFixes: true,
  },
  {
    id: "lua",
    label: "Lua",
    batch: 2,
    extensions: [".lua"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-lua.wasm",
    automaticFixes: true,
  },
  {
    id: "vue",
    label: "Vue",
    batch: 3,
    extensions: [".vue"],
    parser: "component",
    automaticFixes: true,
  },
  {
    id: "svelte",
    label: "Svelte",
    batch: 3,
    extensions: [".svelte"],
    parser: "component",
    automaticFixes: true,
  },
  {
    id: "bash",
    label: "Shell",
    batch: 3,
    extensions: [".sh", ".bash", ".zsh"],
    parser: "tree-sitter",
    grammarFile: "tree-sitter-bash.wasm",
    grammarPackage: "tree-sitter-bash/tree-sitter-bash.wasm",
    automaticFixes: true,
  },
  {
    id: "sql",
    label: "SQL",
    batch: 3,
    extensions: [".sql"],
    parser: "sql",
    automaticFixes: false,
  },
] as const;

const BY_EXTENSION = new Map<string, LanguageDefinition>();
for (const definition of LANGUAGE_DEFINITIONS) {
  for (const extension of definition.extensions) BY_EXTENSION.set(extension, definition);
}

const CPP_HEADER_PATTERN =
  /\b(?:namespace|template|constexpr|class\s+\w+\s*[:{]|using\s+(?:namespace|\w+\s*=))\b|\b(?:public|private|protected)\s*:/;

export function languageForPath(
  relativePath: string,
  content = "",
): LanguageDefinition | undefined {
  const lower = relativePath.toLowerCase();
  const extension = [...BY_EXTENSION.keys()]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => lower.endsWith(candidate));
  const definition = extension ? BY_EXTENSION.get(extension) : undefined;
  if (definition?.id === "c" && extension === ".h" && CPP_HEADER_PATTERN.test(content.slice(0, 8192))) {
    return LANGUAGE_DEFINITIONS.find((candidate) => candidate.id === "cpp");
  }
  return definition;
}

export function supportsAutomaticFixes(relativePath: string, content = ""): boolean {
  return languageForPath(relativePath, content)?.automaticFixes ?? false;
}

export const SUPPORTED_SOURCE_GLOBS = Object.freeze(
  [...new Set(LANGUAGE_DEFINITIONS.flatMap((definition) => definition.extensions))]
    .sort()
    .map((extension) => `**/*${extension}`),
);
