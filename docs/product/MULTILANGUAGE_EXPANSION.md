# RepoFit Comments multi-language expansion

Status: `1.1.0-alpha.1` local implementation

Date: 2026-09-06

## Product boundary

多语言扩展复用现有 Git Diff、规则、SARIF、恢复日志和单文件事务。每种语言单独声明两项能力：是否能够可靠分析注释，以及是否允许自动修改。解析器不可用、源码存在语法错误或安全哈希不一致时，自动写入失败关闭。

RepoFit 的目标仍是减少机械式注释表达，不扩展为作者检测、通用 lint 或代码结构重构。

## Batch 1

| Language | Extensions | Parser | Status |
| --- | --- | --- | --- |
| TypeScript | `.ts` `.tsx` `.mts` `.cts` | TypeScript AST | scan + safe fix |
| JavaScript | `.js` `.jsx` `.mjs` `.cjs` | TypeScript AST | scan + safe fix |
| Python | `.py` `.pyw` | Tree-sitter WASM | scan + safe fix |
| Go | `.go` | Tree-sitter WASM | scan + safe fix |
| Rust | `.rs` | Tree-sitter WASM | scan + safe fix |
| Swift | `.swift` | Tree-sitter WASM | scan + safe fix |

## Batch 2

| Language | Extensions | Parser | Status |
| --- | --- | --- | --- |
| Java | `.java` | Tree-sitter WASM | scan + safe fix |
| Kotlin | `.kt` `.kts` | Tree-sitter WASM | scan + safe fix |
| C# | `.cs` | Tree-sitter WASM | scan + safe fix |
| C | `.c` `.h` | Tree-sitter WASM | scan + safe fix |
| C++ | `.cc` `.cpp` `.cxx` `.hh` `.hpp` `.hxx` | Tree-sitter WASM | scan + safe fix |
| PHP | `.php` `.phtml` | Tree-sitter WASM | scan + safe fix |
| Ruby | `.rb` | Tree-sitter WASM | scan + safe fix |
| Dart | `.dart` | Tree-sitter WASM | scan + safe fix |
| Lua | `.lua` | Tree-sitter WASM | scan + safe fix |

`.h` 文件默认使用 C；检测到 namespace、template、class、访问控制或 using 等 C++ 特征时改用 C++ 解析器。解析失败会阻止写入。

## Batch 3

| Language | Extensions | Parser | Status |
| --- | --- | --- | --- |
| Vue | `.vue` | component script adapter | scan + safe fix in scripts |
| Svelte | `.svelte` | component script adapter | scan + safe fix in scripts |
| Shell | `.sh` `.bash` `.zsh` | Tree-sitter Bash WASM | scan + safe fix |
| SQL | `.sql` | dialect-aware lexical scanner | scan + review only |

Vue/Svelte 的 `<script>` 内容按 JavaScript 或 TypeScript 解析。模板 HTML 注释作为 block comment 记录并保护。SQL 扫描器识别引号、反引号、方括号标识符、PostgreSQL dollar-quoted 字符串、行注释和嵌套 block comment；由于不同 SQL 方言没有统一语法树，安全 finding 会降级为 `rewrite-suggested`。

## Shared invariants

1. 字符串、raw string、heredoc 和模板内容中的注释标记不得成为 finding。
2. 自动改写保留所在语言的原生注释前缀。
3. legal、compiler、formatter、generated、tracking、security、compatibility、rationale 和 numeric-contract 注释优先保护。
4. 非注释 token、去注释语法树、受保护注释顺序和文件快照必须保持一致。
5. CRLF、Unicode 和无末尾换行的源文件保持原字节约定。
6. 目标文件发生并发修改时拒绝覆盖；receipt、verify、recover 和 undo 沿用同一事务模型。

## Evidence required before release

- 每种自动修复语言至少包含字符串/raw string、CRLF、Unicode、语法错误、保护指令和安全改写测试。
- 每个批次至少选择两个真实开源仓库进行只读 smoke，并保存固定 commit/range。
- 任何语言在真实样本中出现代码 token 或受保护注释变化，立即关闭该语言的自动写入能力。
- Node 22/24 × macOS/Linux/Windows 继续安装并测试同一 tarball；Windows 只验证扫描和写入拒绝。
- SQL 只有在选定明确方言语法树并完成同等安全证据后才开放自动写入。
