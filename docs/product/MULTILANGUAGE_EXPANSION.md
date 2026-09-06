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
| Shell | `.sh` `.bash` `.zsh` | dedicated Tree-sitter Bash 0.25 WASM | scan + safe fix |
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

## Live generated-code gate

发布前使用 Hermes 的 `muse-spark-1.3-contributor-free` 在隔离仓库中生成三个批次共 19 个文件。输入仅包含合成任务和桩代码。原始输出包含 64 条真实注释、38 条 `Step 1/2` 叙述、19 个理由注释和19 个字符串伪标记。

初次联合扫描暴露旧 Bash WASM 与当前 Tree-sitter runtime 的动态链接不兼容。该问题在发布前修复为独立的 `tree-sitter-bash@0.25.1` WASM。最终原始扫描识别全部 38 条编号叙述：36 条属于18个可写适配器，SQL 的2条降级为人工建议；字符串误报和解析错误均为0。36条安全改写逐文件应用并逐次验证，复扫自动修复项为0，Shell undo 后逐字节恢复原始哈希并可重新应用。

首次远端矩阵继续暴露 Node 24 V8 在多语法 WASM 测试中的 `Fatal process out of memory: Zone`。RepoFit 增加跨平台 JavaScript launcher，在 Node 24 子进程和测试入口启用 `--liftoff-only`；相同 Node 24.20.0 的本地定向测试通过，随后 [run 34010327234](https://github.com/TAOMA-06/repofit-comments/actions/runs/34010327234) 的六个系统/Node 组合及 package smoke 全部通过。
