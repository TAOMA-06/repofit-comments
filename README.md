# RepoFit Comments

[![CI](https://github.com/TAOMA-06/repofit-comments/actions/workflows/ci.yml/badge.svg)](https://github.com/TAOMA-06/repofit-comments/actions/workflows/ci.yml)

RepoFit Comments 是一个本地终端工具，用来检查当前 Git Diff 中显眼的生成式注释写法，并在能够证明代码结构和受保护内容没有改变时进行保守清理。

它处理编号步骤、装饰性标题、附近重复、逐行复述、教程语气和生成过程叙述。它不判断代码作者，也不输出所谓“AI 概率”。

当前源码对应已公开的 [`v1.1.0-alpha.1`](https://github.com/TAOMA-06/repofit-comments/releases/tag/v1.1.0-alpha.1) 多语言预发布版。发布状态与验证边界见 [STATUS.md](./STATUS.md)，三批扩展能力与证据要求见 [MULTILANGUAGE_EXPANSION.md](./docs/product/MULTILANGUAGE_EXPANSION.md)。

## Language support

运行 `repofit languages` 可以查看安装版本的完整能力表。

| 批次 | 语言 | 能力 |
| --- | --- | --- |
| 1 | TypeScript、JavaScript、Python、Go、Rust、Swift | 扫描和安全自动修复 |
| 2 | Java、Kotlin、C#、C、C++、PHP、Ruby、Dart、Lua | 扫描和安全自动修复 |
| 3 | Vue、Svelte、Shell | 扫描和安全自动修复 |
| 3 | SQL | 扫描和人工审查建议 |

Vue 和 Svelte 的自动修复限于 `<script>` 区块；模板中的 HTML 注释保持受保护。SQL 方言差异较大，目前不会自动写入。

## Safety contract

- 只分析 staged、worktree 或相对 base ref 的新增和修改注释。
- `check`、`preview`、`profile`、`explain`、`doctor` 和 `languages` 不执行目标仓库脚本，也不发送源码到网络。
- TypeScript/JavaScript 使用 TypeScript AST；其他自动修复语言使用本地 Tree-sitter WASM 语法树。
- 自动修改前后必须保持非注释 token、去注释语法树和受保护注释哈希一致。
- 原文件或候选文件出现解析错误时拒绝自动修改。
- 自动修改只接受 `--worktree`，每次只处理一条 finding 或一个明确文件。
- 写入前保存私有、逐字节一致的备份和恢复日志；支持 `verify`、`recover` 和单层 `undo`。
- 不执行 Git stage、commit 或 push。
- Windows 继续提供只读扫描和 SARIF；自动写入等待独立的 DACL 与文件系统事务证据。

## Install for local development

需要 Node.js 22.14 或更新版本。

```bash
git clone https://github.com/TAOMA-06/repofit-comments.git
cd repofit-comments
npm install
npm run build
npm link
```

## Commands

```bash
repofit languages
repofit init
repofit doctor
repofit check --staged
repofit check --worktree --format json
repofit check --base origin/main --format sarif
repofit preview --staged
repofit explain <finding-id> --staged
repofit fix <finding-id> --worktree --dry-run
repofit fix <finding-id> --worktree --apply
repofit fix --all-safe --file src/example.py --worktree --apply
repofit verify
repofit verify --staged
repofit recover
repofit undo
repofit history list
repofit history prune --keep 20
repofit history prune --keep 20 --apply
```

旧版 `repofit comments <command>` 命令形式保持兼容。

## Repository configuration

`repofit init` 创建静态 `.repofit.json`。配置支持 include/exclude glob、额外保护短语和路径、规则级别、失败阈值、资源上限和默认输出格式。工具拒绝未知字段、可执行配置、配置符号链接、无效 UTF-8、路径穿越和超过安全上限的值。

```json
{
  "schemaVersion": "1.0",
  "rulePackVersion": "1.0.0",
  "include": ["src/**/*.ts", "src/**/*.py", "Sources/**/*.swift"],
  "exclude": ["**/generated/**"],
  "protect": {
    "phrases": ["backward-compatible wire format"],
    "paths": ["src/protocol/**"]
  },
  "rules": {
    "comments.step-label": "warning",
    "comments.tutorial-tone": "info"
  },
  "failOn": "warning",
  "display": { "language": "auto", "format": "terminal" }
}
```

抑制规则必须写明理由，并会出现在报告中。注释前缀使用所在语言的原生形式：

```python
# repofit-ignore-next-line comments.step-label -- mirrors the numbered protocol in docs
# Step 1
run_protocol()
```

## Findings and recovery

| Action | Meaning |
| --- | --- |
| `remove-safe` | 确定性规则可以删除该独立行注释，写入前仍需完整验证。 |
| `rewrite-safe` | 提供确定性的注释改写，例如删除 `Step N:` 前缀并保留解释。 |
| `rewrite-suggested` | 只给出审查建议，不会自动写入。 |
| `keep-protected` | 法律、工具指令、文档、约束、理由或其他重要注释。 |
| `uncertain` | 证据不足，默认隐藏。 |

每次写入在 `.git/repofit-comments/` 下保存 receipt 和备份。POSIX 目录与文件使用私有权限，并通过仓库级写锁和 no-clobber 事务处理并发修改。`verify --staged` 可以确认 Git index 中是修复后的字节；`undo` 不改变 index。

自动修复单文件上限为 2 MiB。恢复数据达到 200 条记录或 64 MiB 时停止接受新写入。`history prune` 默认只预览，不选择最新或未完成的记录，并能恢复被中断的清理。

## GitHub Action and schemas

仓库包含 [Action definition](./action.yml) 和 [version-pinned example](./examples/github-action.yml)。Action 输出 SARIF；调用方负责配置 `security-events: write` 并上传结果。

配置、报告、错误、修复预览、receipt、诊断、历史和语言能力的 JSON Schema 位于 [`schemas/`](./schemas/)。

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | 命令完成，没有达到失败阈值的 finding。 |
| `1` | `check` 或 `preview` 达到配置的 `failOn` 阈值。 |
| `2` | 命令参数无效。 |
| `3` | 分析、Git、解析、编码或运行步骤失败。 |
| `4` | 保存的修复记录没有通过验证。 |
| `5` | 写入请求被安全边界拒绝。 |

## Development

```bash
npm run check
npm test
npm run test:package
npm run benchmark
```

支持的 npm 契约目前是 CLI 和版本化 Schema；内部模块不作为公共 API。许可证为 MIT，见 [LICENSE](./LICENSE)。
