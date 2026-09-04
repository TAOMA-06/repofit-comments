# RepoFit Comments v1 发布策略

状态：Proposed

研究截止：2026-09-04（Asia/Shanghai）

本文定义 RepoFit Comments 从公开 Alpha 走向 Beta、RC 和正式 `1.0.0` 的分发、供应链、验证与回滚要求。它是一份未来发布规范，不是当前完成证明；任何阶段名称都必须由对应证据支持。

## 1. 发布决策

RepoFit Comments v1 采用以下分发顺序：

1. **npm/npx 是主渠道。** 当前产品本身是 Node.js CLI，已有单一 `bin` 入口，npm 能以最少的额外工程提供发现、安装、精确版本和一次性执行。
2. **每一个公开 npm 版本都必须有对应的 GitHub Release。** Release 保存人类可读变更、同一份 npm tarball、校验值、SBOM 和可验证证明。
3. **Homebrew 在稳定 v1 后追加。** 首先维护官方项目自己的 tap；在项目达到 Homebrew 官方仓库的稳定性与知名度门槛前，不申请 `homebrew/core`。
4. **独立二进制不进入 v1 的关键路径。** 只有真实安装数据证明 Node.js 前置条件显著阻碍采用时，才单独评估。

“正式产品”不由分发渠道数量决定。`1.0.0` 还意味着产品效果、写入安全、兼容范围、支持政策和回滚流程均已通过本文门槛。

## 2. 当前基线与未完成项

截至本文编写时，仓库仍应被视为公开 Alpha，而不是 npm、Homebrew 或正式产品发布。以下项目是 v1 工作，不得表述为已经完成：

- `package.json` 仍为 `0.1.0` 且设置了 `"private": true`，npm 会拒绝发布带有该字段的包。参见 [npm package.json 文档](https://docs.npmjs.com/files/package.json/)。
- CLI 代码中另有硬编码版本号，尚未建立 package、lockfile、CLI 输出与 Git tag 的单一版本源。
- 常规 CI 只验证 Ubuntu 和 Node.js 22；尚未形成 Windows、macOS、Node.js 24 的支持证据。
- 现有 CI 只做 `npm pack --dry-run`，没有在每个平台安装同一份真实 tarball 后运行端到端 smoke。
- 尚无 npm 可信发布、provenance、SBOM、GitHub Artifact Attestation、不可变 Release 或发行回滚演练。
- 现有公开 smoke 和单次模型样例不能替代多仓库标注语料、维护者盲评和真实用户重复使用证据。

## 3. 阶段定义

### 3.1 Beta

推荐版本：`0.2.0-beta.N`

分发标签：

- npm dist-tag：`beta`
- GitHub Release：prerelease
- Homebrew：不发布

Beta 的目标是验证真实仓库中的安全性、效果和安装闭环。进入公开 Beta 前至少要求：

- 覆盖不少于 5 个真实仓库、50 个真实 AI 辅助 Diff、20 个高质量人工控制 Diff 和 200 条人工标注候选注释；数据按仓库隔离开发、校准和隐藏验收集。
- 非注释 token 一致率为 100%。
- 已识别的受保护注释保留率为 100%。
- 自动修改导致的解析失败、公共 API 文档误改和维护者确认的关键意图丢失均为 0。
- 所有自动修复均幂等。
- Beta tarball 已通过本文定义的跨平台安装与 smoke 矩阵。

Beta 可以公开供目标用户试用，但文档必须继续声明语言范围、自动写入边界和未完成的效果验证。不得宣传“去除水印”“证明人工原创”“绕过检测器”或类似能力。

### 3.2 Release Candidate

推荐版本：`1.0.0-rc.N`

分发标签：

- npm dist-tag：`next`
- GitHub Release：prerelease
- Homebrew：不发布

RC 表示 v1 功能、CLI 命令、退出码、JSON schema 和安全契约已经冻结，只接受阻塞发布的问题修复。进入 RC 前要求：

- Beta 的全部安全门槛持续通过。
- `remove-safe` 精确率不低于 90%，确定性痕迹召回率不低于 70%，`remove-safe` 接受率不低于 80%。
- 匿名 A/B 中清理版被认为更符合仓库的比例不低于 70%；样本足够时，95% 置信区间下限高于 50%。
- 高质量人工控制组的“无需修改”率不低于 90%。
- 1,000 行以内 Diff 的检查耗时 P95 小于 10 秒。
- 至少 5 名目标用户在各自不少于 5 个真实 Diff 中使用；至少 3 人连续两周主动重复使用。
- 发布、验证和回滚 runbook 已在 RC 上真实演练。

### 3.3 正式 1.0

推荐版本：`1.0.0`

分发标签：

- npm dist-tag：`latest`
- GitHub Release：stable、latest、immutable
- Homebrew：满足延后门槛后追加

正式 `1.0.0` 要求至少一个 RC 完成观察期，期间没有未解决的发布阻塞问题、安全门槛回归或制品身份不一致。`1.0.0` 发布后，CLI 命令、退出码和 JSON schema 属于兼容性承诺；破坏兼容性的修改必须进入新的 major 版本。

## 4. npm/npx 主渠道

### 4.1 用户入口

公开文档应区分三种使用方式：

- Beta 试用：`npx repofit-comments@beta comments check --staged`
- 稳定版一次性运行：`npx repofit-comments@1 comments check --staged`
- 高频使用：`npm install --global repofit-comments@1`，随后运行 `repofit ...`

CI、教学材料和可复现实验必须固定精确版本，例如 `repofit-comments@1.0.0`，不得依赖可移动的 `latest`。npm 的 `npx` 会从包的单一 `bin` 字段推断要运行的命令；详细行为见 [npm exec/npx 官方文档](https://docs.npmjs.com/cli/v11/commands/npm-exec/)。

### 4.2 首次 npm 引导发布

npm 的 staged publishing 和 trusted publisher 都要求包已经存在。因此首次 registry 发布是一次明确记录的引导例外：

1. 确认最终包名；若无作用域名称不可用，则在发布前改为拥有并控制的公共 scope。
2. 用户启用 npm 账号级双因素认证。
3. 从已验证的 Beta tag 构建 `0.2.0-beta.1` tarball。
4. 用户在本地已认证会话中以 2FA 将该 tarball发布到显式 `beta` dist-tag；不得写入 `latest`。
5. 引导版发布后，立即配置 trusted publisher，再进入正常流水线。

官方限制见 [npm staged publishing](https://docs.npmjs.com/staged-publishing/) 和 [`npm trust` 文档](https://docs.npmjs.com/cli/v11/commands/npm-trust/)。首次交互式版本不会获得 GitHub Actions OIDC 产生的 npm provenance，发布记录必须如实注明这项一次性差异。

### 4.3 后续正常发布

后续所有 Beta、RC 和 stable 版本使用 GitHub-hosted runner 上的 npm trusted publishing：

- trusted publisher 只授权指定的 `release.yml`。
- 只允许 `npm stage publish`，不允许 OIDC 直接 `npm publish`。
- npm package access 设为要求 2FA 并禁止传统 token 发布。
- 删除不再需要的自动化发布 token。
- 发布工作使用满足 staged publishing 要求的 npm CLI；截至研究日期，需要 npm 11.15.0 或更高和 Node.js 22.14.0 或更高。

Trusted publishing 使用短期 OIDC 凭证，避免在 GitHub 保存长期 npm 写 token；GitHub Actions 和 GitLab CI 的公共包可信发布会自动生成 npm provenance。参见 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) 和 [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)。

Provenance 证明包来自哪个仓库、commit 和工作流，不证明代码没有恶意行为或缺陷。因此它不能代替测试、安全审计或人工批准。

## 5. GitHub Release

每一个发布到 npm 的版本都必须创建同名 Git tag 和 GitHub Release。发布资产至少包括：

- `repofit-comments-X.Y.Z.tgz`
- `repofit-comments-X.Y.Z.spdx.json`
- `SHA256SUMS`
- 版本说明与兼容性/升级提示

仓库应启用 GitHub release immutability。工作流先创建 draft、上传完整资产，最后才发布；发布后 tag 和资产不可移动、替换或删除，并自动生成 release attestation。参见 [GitHub Immutable Releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)。

Homebrew 和校验脚本不得依赖 GitHub 自动生成的 “Source code” 压缩包。GitHub 会按需重新生成这些压缩包，文件内容可以稳定，但外层压缩字节可能变化；需要稳定字节身份时应使用显式上传的 release asset。参见 [GitHub source archive stability](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)。

## 6. CI 和 release 流水线

### 6.1 Pull request CI

v1 的最低必需矩阵为三个操作系统乘两个 LTS Node 版本：

| 操作系统 | Node.js 22 | Node.js 24 |
| --- | --- | --- |
| Ubuntu | 必须 | 必须 |
| macOS | 必须 | 必须 |
| Windows | 必须 | 必须 |

Node.js 官方当前将 22 和 24 列为 LTS；支持状态变化时，应通过正常兼容性发布调整矩阵，不能默默删除仍在承诺范围内的运行时。参见 [Node.js Releases](https://nodejs.org/en/about/previous-releases)。

每个矩阵项至少执行：

1. 锁文件一致性安装。
2. TypeScript 严格检查。
3. 全部单元与端到端测试。
4. Git staged、worktree、base scope smoke。
5. dry-run、单 finding apply、单文件批量 apply、receipt verify。
6. CRLF、Unicode、空格路径、符号链接/非普通文件和并发修改拒绝测试。

PR 中涉及 `package.json` 或 lockfile 的更改还必须经过 dependency review。公共仓库可使用 GitHub dependency review 来阻止引入已知漏洞的依赖，参见 [GitHub Dependency Review](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-dependency-review-action)。

### 6.2 Build once, test everywhere

Release 不能让六个矩阵项各自构建不同 tarball。推荐流程是：

1. 一个受控 Linux release-build job 从精确 tag 构建唯一 tarball。
2. 计算 tarball SHA-256，并生成运行时依赖 SBOM。
3. 将同一 tarball交给六个 install-smoke job。
4. 每个 job 在全新临时目录安装 tarball，验证 `repofit --version`、`--help`、只读扫描、写入、拒绝路径和 receipt。
5. 全部通过后，原始 tarball才可进入 npm staging 和 GitHub draft Release。

`npm sbom` 官方支持 SPDX 与 CycloneDX；v1 使用 SPDX JSON，并排除开发依赖，参见 [`npm sbom`](https://docs.npmjs.com/cli/commands/npm-sbom/)。

### 6.3 发布顺序

1. 合并版本 PR；所有 required checks 通过。
2. 由有权限的维护者在受保护的 `vX.Y.Z` tag 上启动 release。
3. 验证 `Git tag == package.json == package-lock root == repofit --version`。
4. 构建唯一 `.tgz`，审查文件清单并完成跨平台安装 smoke。
5. 生成 SHA-256、SPDX SBOM 和 GitHub Artifact Attestations。
6. 创建 GitHub draft Release 并附齐资产，但暂不公开。
7. 通过 OIDC 执行 `npm stage publish <tgz> --tag beta|next|latest`。
8. 人工下载 npm staged tarball，与构建产物 SHA-256 比较，并复核包清单。
9. 用户使用 2FA 批准 staged package。
10. 立即发布已经准备完整的 GitHub draft；不得重新构建资产。
11. 执行发布后验证；全部通过后再更新 Homebrew tap。

如果 npm 批准成功而 GitHub 发布暂时失败，应继续使用已经存在的 draft 重试发布，不得重新构建或替换 tarball。

## 7. 供应链要求

### 7.1 GitHub Actions

- 所有外部 Action，包括 GitHub 官方 Action，都固定到完整 commit SHA；版本号只作为旁注。GitHub 明确指出，完整 SHA 是 action 唯一不可变引用方式，参见 [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)。
- 普通 CI 顶层权限保持 `contents: read`。
- 构建证明 job 只增加 `id-token: write` 和 `attestations: write`。
- 创建 GitHub Release 所需的 `contents: write` 只授予独立 finalization job。
- npm 发布不保存 `NODE_AUTH_TOKEN`；只使用可信发布的 OIDC。
- release job 禁用 package-manager cache。npm 官方 trusted publishing 示例明确建议发布构建不使用缓存。
- release job 使用全新 GitHub-hosted runner；不使用长期存在的 self-hosted runner。
- release workflow 绑定受保护的 GitHub environment，限制只能由 release tag 运行，并要求人工批准。公共仓库可使用 required reviewers 和防止自审，参见 [GitHub Environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。

### 7.2 包内容和依赖

- 发布前移除或切换 `"private": true`；同时设置明确的 public registry 与 access，避免发往错误 registry。
- `repository.url` 大小写和路径必须精确匹配公开 GitHub 仓库，否则 npm provenance 可能失败。
- `files` 采用最小允许清单。README、LICENSE 会由 npm 始终包含；测试、原始评估语料、内部 evidence、临时文件和凭据不得进入 tarball。
- 正式包不应包含 `preinstall`、`install` 或 `postinstall` 脚本。
- release 安装依赖时禁止依赖生命周期脚本，再通过显式命令构建自己的代码。
- 运行时依赖必须有精确锁定、许可证检查和 high/critical 漏洞门禁。
- 发布前以真实 `npm pack` 和 `npm publish --dry-run` 审查文件清单；npm 官方也建议这样检查发布内容，参见 [`npm publish`](https://docs.npmjs.com/commands/npm-publish/)。

### 7.3 证明和验证

GitHub Artifact Attestations 用于 `.tgz` 和 SBOM，最低权限为：

- `contents: read`
- `id-token: write`
- `attestations: write`

GitHub 官方说明、生成方法和验证命令见 [Using artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)。

三个证明层各有不同职责：

| 证明 | 绑定对象 | 消费者验证 |
| --- | --- | --- |
| npm provenance | npm registry package 与源仓库/工作流 | npm 页面 provenance；`npm audit signatures` |
| GitHub artifact attestation | 显式上传的 `.tgz`、SBOM 与构建工作流 | `gh attestation verify` |
| GitHub release attestation | Release tag、commit 和完整资产集合 | `gh release verify`、`gh release verify-asset` |

正式发布必须能证明 npm tarball、GitHub `.tgz`、`SHA256SUMS` 和 Homebrew formula 指向同一字节内容。

## 8. Homebrew 延后策略

### 8.1 何时开始

建议在满足以下条件后创建 `TAOMA-06/homebrew-tap`：

- `1.0.0` 已稳定发布。
- 至少完成一个稳定 patch 周期，或 `1.0.0` 经过明确观察期且无 release-blocking 事件。
- macOS 和 Linux 的 npm tarball smoke 持续通过。
- 有真实用户明确要求无全局 npm 管理的安装/升级体验。

第三方 tap 由项目自行负责支持，不表示 Homebrew 官方认可。Homebrew 当前要求非官方 tap 默认显式信任，并推荐用户只信任所需 formula，参见 [How to Create and Maintain a Tap](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)。

### 8.2 Formula 设计

RepoFit 是开源 CLI，应使用 formula 而非 cask。公式要求：

- `url` 指向 npm registry 中精确版本的 `.tgz`。
- `sha256` 来自已发布 tarball，不使用移动 URL。
- 声明 `depends_on "node"`。
- 使用 Homebrew 的 `std_npm_args` 安装到 `libexec`，并链接 `repofit`。
- 功能测试必须创建临时 Git fixture 并运行一次真实检查；只测 `--version` 不足以验收。
- macOS 和 Linux 均执行 build-from-source install、`brew test`、strict audit 和 style 检查。

Homebrew 官方对 Node CLI 优先使用 npm release tarball、SHA-256、`std_npm_args` 和功能测试，参见 [Language-Specific Formulae](https://docs.brew.sh/Language-Specific-Formulae)。

### 8.3 不立即申请 homebrew/core

`homebrew/core` 要求稳定、不可变发布、活跃维护、无已知未修补漏洞和公开知名度。当前政策中，仓库所有者自行提交项目通常需达到至少 90 forks、90 watchers 或 225 stars 之一，且不足 30 天的仓库通常不符合条件。参见 [Homebrew Package Acceptance Policy](https://docs.brew.sh/Package-Acceptance-Policy) 和 [Acceptable Formulae](https://docs.brew.sh/Acceptable-Formulae)。

在达到这些门槛前，自有 tap 是正确渠道，不能把未被 Homebrew 接纳描述为官方 Homebrew 发布。

## 9. 独立二进制边界

v1 不发布独立 Node SEA 二进制。Node 官方截至研究日期仍将 Single Executable Applications 标为 “Stability 1.1 - Active development”，并记录平台构建、代码缓存、签名与测试限制，参见 [Node.js SEA](https://nodejs.org/api/single-executable-applications.html)。

未来只有在以下条件同时成立时重新评估：

- Node.js 安装是经过真实数据确认的主要采用障碍。
- 能在每个目标 OS/架构原生构建，而不是未经验证地交叉生成。
- 能及时随嵌入的 Node.js 和 TypeScript 安全更新重建全部资产。
- macOS 资产完成 Developer ID 签名、公证与 Gatekeeper 验证；Apple 要求直接分发软件使用 Developer ID 和 notarization，参见 [Apple Developer ID](https://developer.apple.com/support/developer-id/)。
- Windows 资产有正式代码签名、干净系统 smoke 和 SmartScreen 处置方案。
- 每个二进制都有 SHA-256、SBOM、Artifact Attestation 和不可变 Release 证明。

## 10. 版本策略

npm 建议新产品从 `1.0.0` 开始，并以 patch、minor、major 分别表达兼容修复、兼容功能和破坏性变化，参见 [npm Semantic Versioning](https://docs.npmjs.com/about-semantic-versioning/)。RepoFit 采用：

- Patch：安全规则修复、兼容 bug、性能修复，且不改变既有 CLI/JSON 合约。
- Minor：向后兼容的新规则、选项或语言适配器。
- Major：命令删除/重命名、退出码语义变化、默认写入范围扩大、JSON schema 破坏性变化或安全契约重定义。

版本 tuple 必须保持一致：

`Git tag = package.json = package-lock root = CLI --version = Release title = SBOM component version`

dist-tag 规则：

- `beta` 只指向最新 Beta。
- `next` 只指向当前 RC。
- `latest` 只指向已经正式批准的稳定版。
- 发布 prerelease 时必须显式指定 dist-tag；不得让 npm 默认把 prerelease 标成 `latest`。npm dist-tag 行为见 [Adding dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/)。

## 11. 回滚与事故处置

### 11.1 普通缺陷

npm 和 GitHub 发布均按不可变记录处理，不覆盖、不重用版本或 tag：

1. 停止 Homebrew 更新和进一步推广。
2. 将 npm `latest`、`next` 或 `beta` 指回上一已知良好版本。
3. 对坏版本执行 `npm deprecate`，说明影响和安全升级目标。
4. 在 GitHub Release notes 顶部添加醒目警告，并取消其 latest 状态；不可替换资产或移动 tag。
5. 从新 commit 发布 patch 版本。
6. Homebrew tap 先恢复供新安装使用的已知良好 formula，再尽快升级到修复 patch。

Homebrew 是滚动发布管理器，不保证为已经安装坏版本的用户自动降级，因此真正恢复路径必须是 patch-forward，并在公告中提供精确版本命令。

### 11.2 安全或发布凭证事故

1. 暂停 release workflow 和 GitHub environment。
2. 删除或禁用 npm trusted publisher 关系。
3. 撤销残留 npm token、GitHub token 或签名凭证。
4. 保全 workflow run、attestation、发布资产和审计记录。
5. deprecate 受影响 npm 版本并发布安全公告。
6. 从已知良好 commit 在恢复后的可信流水线构建新 patch。

除满足 npm 的严格政策或确认恶意包需要紧急处置外，不使用 unpublish。npm registry 的 name+version 一经使用就不能重用；npm也推荐 deprecate 来避免破坏依赖者，参见 [npm Unpublish Policy](https://docs.npmjs.com/policies/unpublish/) 和 [Deprecating packages](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/)。

### 11.3 回滚演练验收

正式 `1.0.0` 前，至少在 RC 上真实演练一次：

- 移动 `next` 回上一 RC。
- deprecate 一个有意淘汰的 RC。
- 发布新的 RC patch/revision。
- 验证旧精确版本仍可安装，新默认 tag 指向正确版本。
- 验证 GitHub 不可变旧 Release 仍可审计。
- 更新测试 tap formula 的 URL 与 SHA，并确认新安装恢复。

## 12. 发布验收清单

任一必需项失败，发布状态为 NO-GO。

### 12.1 产品与兼容性

- [ ] 对应阶段的安全、效果和真实用户门槛全部有可复核证据。
- [ ] CLI 命令、退出码、JSON schema 和支持范围已文档化。
- [ ] `--apply` 没有任何非注释 token 变化、受保护注释损失或解析失败。
- [ ] Windows、macOS、Linux 和 Node.js 22/24 全矩阵通过。

### 12.2 包与制品

- [ ] `private` 发布阻断已在明确发布变更中解除，而不是临时在 CI 中篡改。
- [ ] 版本 tuple 六处完全一致。
- [ ] tarball 文件清单只包含允许内容，无凭据、内部语料和临时路径。
- [ ] 六个矩阵项安装并执行的是同一 SHA-256 tarball。
- [ ] 运行时 dependency audit 无 high/critical 已知漏洞。
- [ ] SPDX SBOM 已生成并随 Release 发布。

### 12.3 发布安全

- [ ] 所有 Action 固定完整 commit SHA。
- [ ] 普通 CI、attestation 和 release finalization 权限相互隔离且最小化。
- [ ] npm release job 不含长期发布 token。
- [ ] trusted publisher 只绑定精确仓库、workflow、environment，且仅允许 staged publish。
- [ ] staged tarball 已由人下载、复核 SHA 并以 2FA 批准。
- [ ] npm provenance 可查看并可用 `npm audit signatures` 验证。
- [ ] `gh attestation verify <tgz> -R TAOMA-06/repofit-comments` 成功。
- [ ] `gh release verify vX.Y.Z` 成功。
- [ ] `gh release verify-asset vX.Y.Z <tgz>` 成功。
- [ ] GitHub Release 显示 immutable。

### 12.4 发布后 smoke

- [ ] `npm view` 返回预期版本、dist-tag 与 tarball integrity。
- [ ] 全新环境执行精确版本 `npx` 命令成功。
- [ ] 全局安装后 `repofit --version` 正确。
- [ ] 真实小型 Git fixture 完成 check、preview、apply 和 verify。
- [ ] GitHub tarball、npm tarball、checksum 和 Homebrew formula SHA 一致。
- [ ] Release notes、安装文档、安全支持版本和已知限制已更新。

## 13. 必须由用户完成的账号与设置步骤

以下步骤涉及账户身份、2FA、发布授权或仓库保护，不能由代码变更代替：

### npm

1. 确认 npm 账号可用并启用账号级 2FA。
2. 查询并决定最终 npm 包名；本策略不声称 `repofit-comments` 当前仍可注册。
3. 人工审核并用 2FA 完成首次 Beta 引导发布。
4. 在包设置中创建 GitHub Actions trusted publisher，精确填写：
   - GitHub owner：`TAOMA-06`
   - repository：`repofit-comments`
   - workflow filename：最终 `release.yml`
   - environment：最终生产发布 environment
   - allowed action：仅 `npm stage publish`
5. 将 package publishing access 设为要求 2FA 并禁止 token 发布。
6. 撤销不再需要的 granular automation tokens。
7. 每次 staged release 人工复核并用 2FA approve 或 reject。

### GitHub

1. 为 `main` 建立 required checks 与 PR 保护。
2. 为 `v*` 建立 tag ruleset，限制创建、更新和删除。
3. 创建生产发布 environment，限制 release tags；有第二维护者时启用 required reviewer 和 prevent self-review。
4. 开启 release immutability；该设置只影响启用后的未来 Releases，参见 [Preventing changes to releases](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)。
5. 在首次正式发布前检查 Actions、environment、ruleset 和 attestation 页面中的实际配置。

### Homebrew（稳定 v1 后）

1. 创建并拥有 `TAOMA-06/homebrew-tap`。
2. 审核 formula 会执行的 Ruby 代码和下载来源。
3. 审核并合并每次 formula 更新；不得让 release job 在未经审查时直接改写 tap 默认分支。

### 独立二进制（未来可选）

1. 取得目标平台的正式签名身份。
2. 对 macOS 加入 Apple Developer Program、管理 Developer ID 凭证并批准公证流程；Apple 当前会员费为每年 99 美元，参见 [Apple Developer Program](https://developer.apple.com/programs/whats-included/)。
3. 对 Windows 选择并管理适用的正式代码签名服务。

## 14. npm 政策边界

npm 于 2026-07-28 更新的 Dual-Use Content Policy 将渗透测试、安全研究和代码混淆等安全相关双用途能力纳入申报范围。RepoFit Comments 当前定义是对当前 Git Diff 的注释风格清理，不是安全工具、作者鉴定器或 detector-evasion 工具，因此本文不直接将其归类为 dual-use；这是一项产品/政策判断，而不是技术证明。

首次 npm 发布前必须复核最终功能和营销文案：

- 如果仍严格保持当前边界，记录“不适用”的判断依据。
- 如果未来加入代码混淆、规避检测或其他安全相关双用途能力，应先向 npm 确认分类要求。
- 若被归类，必须在 package metadata 中加入 `contentPolicy`、在 tarball 根目录加入 `DISCLOSURE`，并永久保留声明；OIDC 只能用于 staged publishing，最终由人类 2FA 批准。

完整要求见 [npm Dual-Use Content Policy](https://docs.npmjs.com/policies/dual-use/)。

## 15. 官方参考

- [npm package.json](https://docs.npmjs.com/files/package.json/)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm Staged Publishing](https://docs.npmjs.com/staged-publishing/)
- [Generating npm Provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [npm Publish](https://docs.npmjs.com/commands/npm-publish/)
- [npm Semantic Versioning](https://docs.npmjs.com/about-semantic-versioning/)
- [npm Dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/)
- [npm Unpublish Policy](https://docs.npmjs.com/policies/unpublish/)
- [GitHub Actions Secure Use](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub Artifact Attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [GitHub Immutable Releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [GitHub Release Integrity Verification](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity)
- [Homebrew Language-Specific Formulae](https://docs.brew.sh/Language-Specific-Formulae)
- [Homebrew Tap Guide](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)
- [Homebrew Package Acceptance Policy](https://docs.brew.sh/Package-Acceptance-Policy)
- [Node.js Releases](https://nodejs.org/en/about/previous-releases)
- [Node.js Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
