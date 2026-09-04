# RepoFit Comments V1 产品规格

状态：Draft

研究与事实截点：2026-09-04

适用版本：RepoFit Comments 1.0 候选

## 1. 决策摘要

RepoFit Comments 不进入“通用 AI slop 扫描器”或“AI 作者鉴定器”赛道。V1 将成为一个本地优先、确定性、面向 Git Diff 的 **Comment Integrity Gate（注释完整性门）**：识别生成式编码过程中留下的低价值注释表达，只自动执行能够验证为不改变非注释代码、语法树和受保护注释的修改。

一句话承诺：

> **RepoFit Comments 清理你即将提交的 Git Diff 中的注释噪音，并提供可复验的证据，证明非注释代码与受保护的工程意图没有被改变。**

正式产品不等于扩大规则数量。对 RepoFit Comments 而言，正式产品意味着：可从可信渠道安装、可在真实开发流程中稳定运行、行为边界可配置、修改可验证、误报可追踪、跨平台与发布链路有证据，并有明确的支持和停止条件。

## 2. 命名与品牌边界

- 对外始终使用全称 **RepoFit Comments**。
- 命令名可以保留 `repofit comments ...`，但文档、npm 描述、GitHub Action 和产品页面不得只写“RepoFit”。
- 暂不把短名 **RepoFit** 当作独占品牌。完成正式的商标、包名、域名和同类产品检索前，不声称拥有该短名，也不围绕该短名投入不可逆的品牌资产。
- V1 的品类词是 `comment integrity`、`comment hygiene` 和 `proof-carrying cleanup`，不是 `AI detector`、`watermark remover` 或 `humanizer`。

## 3. 事实基线

### 3.1 RepoFit Comments 当前已确认事实

以下事实来自当前仓库，不代表尚未完成的 1.0 能力：

- 当前为公开 GitHub Alpha，尚未发布 npm、Homebrew、签名二进制或生产发行版。
- 当前只支持 TypeScript 和 TSX，只分析 staged、worktree 或相对 base ref 的 Git 变更中的新增/修改注释。
- `check`、`preview` 和 `profile` 为离线只读操作；自动写入只允许单 finding 或单文件安全 finding 集合，并要求显式 `--apply`。
- 写入前检查 parse diagnostics、非注释 token hash、去注释语法树 hash、受保护注释 hash 和源文件 hash；写入使用原子替换，并留下本地 receipt。
- 当前保护许可证、归属、JSDoc、块注释、工具指令、生成标记、URL/issue/TODO、兼容性、安全、隐私、并发、迁移、格式/单位/版本约束、理由性注释和疑似注释代码；不确定时保留。
- 当前 30 个自动化测试通过，并有少量真实生成 fixture 与公开仓库 smoke evidence；这不是统计有效的 precision/recall 研究，也没有维护者盲审结论。

仓库证据：[README](../../README.md)、[STATUS](../../STATUS.md)、[写入验证实现](../../src/patch.ts)、[Grok 4.5 样例](../../evidence/grok-4.5-eval-2026-09-03.md)。

### 3.2 竞品事实表

表中能力和数字均来自竞品官方文档、官方仓库或 npm；厂商自报 benchmark、安装量和效果不视为独立验证。

| 产品 | 截至截点的官方定位与能力 | 安装与发行 | 价格与开源状态 | 对 RepoFit Comments 的含义 |
| --- | --- | --- | --- | --- |
| [aislop](https://github.com/scanaislop/aislop) | npm 当前 `0.16.0`。官方描述为 50+ 规则、10 类语言目标的确定性 AI-code-quality gate；覆盖格式、lint、复杂度、安全、AI-slop 和架构，并提供评分、CI、SARIF、auto-fix、Agent repair、hooks 与 MCP。[规则](https://github.com/scanaislop/aislop/blob/main/docs/rules.md) | `npx`、npm、Yarn、Bun、Homebrew、PyPI；Node.js ≥20。 | CLI 为 MIT；托管层公开价格为 Hobby $5/月、Pro $19/月、Team $49/月，公开仓库扫描免费。[定价](https://scanaislop.com/pricing/) | 最强直接威胁。RepoFit Comments 不能靠“确定性”“叙事注释规则”或“安全修复”三个词形成差异。 |
| [slop-scan](https://github.com/modem-dev/slop-scan) | 面向 JS/TS 的确定性 scanner，重点是热点、按文件/KLOC/函数归一化、固定 cohort benchmark、delta 和插件规则；官方明确不声称作者鉴定。 | npm 全局或 dev dependency；Node.js ≥18。GitHub 最新 release 为 `0.4.0`，但 npm `latest` 在截点仍为 `0.3.0`。[Releases](https://github.com/modem-dev/slop-scan/releases) · [npm](https://www.npmjs.com/package/slop-scan) | 仓库为 MIT；未发现官方付费产品。npm 发布元数据在截点未声明 license。 | 说明 benchmark、diff/delta 和可扩展规则已是基础能力；也说明发行物与文档一致性本身是正式产品门槛。 |
| [vibecop](https://github.com/bhvbhushan/vibecop) | npm 当前 `0.4.3`。官方列出 35 个确定性 detector，覆盖质量、安全、正确性和测试；提供 Agent hooks、GitHub Action、MCP 和 diff 扫描。[detectors](https://bhvbhushan.github.io/vibecop/detectors/overview/) | npm 或 Bun 全局安装，`vibecop init` 配置 Agent；Node.js ≥20。[Releases](https://github.com/bhvbhushan/vibecop/releases) | MIT；未发现官方商业定价。 | “Agent 写完立即反馈”已有竞品。V1 应提供结构化集成，但不应为追工具数量而牺牲安全边界。 |
| [CodeRabbit](https://docs.coderabbit.ai/cli) | 通用 LLM 代码审查平台，覆盖 PR、IDE 和 CLI；支持团队 learnings、代码库上下文、linters/SAST、one-click fixes、Agent loops、跨仓库和持续安全。 | 官方安装脚本、Homebrew、Windows；需要账户和服务连接。Free 的 CLI 限额为每开发者每小时 3 次；OSS 有独立额度。[Plans](https://docs.coderabbit.ai/management/plans) | Free/OSS；Essentials $30 月付或 $24 年付/开发者，Team $60/$48，Advanced $90 月付，Enterprise 定制；用量附加项按文件计费。[定价](https://www.coderabbit.ai/pricing) | 属于相邻品类。RepoFit Comments 不应替代通用 code review，而应成为其前置的本地确定性卫生层。 |
| [Greptile](https://www.greptile.com/docs/introduction) | 通用 LLM reviewer，索引完整代码库并建图，自动审 PR、从反馈学习，并把问题交给 Agent 修复；提供 [CLI](https://www.greptile.com/cli)。 | GitHub/GitLab App，以及 npm、Homebrew 和安装脚本。 | Starter 免费，1 位活跃开发者、50 credits/月；Pro $30/席位/月，含 50 次标准 review，超额 $1/次；Enterprise 定制。[定价](https://www.greptile.com/pricing) | RepoFit Comments 的优势只能来自离线、确定性和可验证写入，不能来自更广的代码库理解。 |

一个重要的官方历史事实：aislop 的 v0.6.0 changelog 记录过 narrative-comment autofix 在一个已知仓库误删 1,340 行 OpenAPI 文档，随后增加了 API 文档保护规则。该事件已被修复，但它证明“保护层先于样式层”和真实误报回归不是理论需求。[aislop changelog](https://scanaislop.com/changelog/)

## 4. 目标用户与 JTBD

### 4.1 主要用户

1. **TypeScript/React 仓库维护者和 Tech Lead**：需要审查大量 AI-assisted diff，希望先去掉机械叙事，再把注意力放在意图和行为上。
2. **在提交前使用编码 Agent 的个人开发者**：希望快速整理注释，但不愿把私有代码发送到另一个模型，也不愿接受无法解释的批量改写。
3. **需要确定性 CI 规则的小团队**：希望所有 Agent 生成的 PR 遵循同一注释标准，同时保留许可证、工具指令和工程理由。

V1 不以“采购综合代码审查平台”的大型企业安全团队为主要用户；该需求由 CodeRabbit、Greptile、Qodo、Sonar 等更广平台覆盖。

### 4.2 核心 JTBD

**JTBD-1：提交前降噪**

> 当编码 Agent 生成或修改一组 TypeScript 文件、而我准备提交或发 PR 时，帮我找出只是在复述步骤、代码动作或生成过程的注释，使 reviewer 首先看到真正的工程意图。

**JTBD-2：安全自动清理**

> 当我允许工具自动删除或缩短注释时，给我机器可复验的证据，证明非注释 token、语法结构和受保护注释没有改变，而不是只让我相信“safe fix”标签。

**JTBD-3：不确定时交还判断**

> 当工具不能确定一条注释是否有价值时，解释证据并保留原文，让我决定，而不是为了提高 cleanup 数量而写入。

**JTBD-4：团队一致性**

> 当多个开发者和 Agent 向同一仓库提交代码时，只检查本次变化，并依据一个版本化、可审阅的规则集给出相同结果。

## 5. 正式定位

### 5.1 品类

RepoFit Comments 是 **本地优先的 Git Diff 注释完整性工具**，不是通用 linter，也不是 LLM reviewer。

它位于开发流程的这个位置：

`Agent/开发者写代码 → RepoFit Comments 注释完整性检查 → lint/test/安全扫描 → 人工或 AI code review → PR`

### 5.2 核心差异

- **Proof-carrying cleanup**：每次自动写入都能出具并复验不变量 receipt。
- **Protect first, style second**：明确的受保护类别先于任何风格规则运行。
- **Diff-native**：评价的是即将提交的变化，不给整个仓库贴“AI 分数”。
- **Repository-aware but fail-closed**：仓库样本足够时提供风格证据；样本不足时不伪造个性化结论。
- **Local and deterministic**：核心扫描、预览和修复不需要账户、云 API 或 LLM。

## 6. 明确不做

V1 明确不做以下事项：

- 不鉴定代码由人还是 AI 编写，不输出 AI 概率、作者分数或“human-written”结论。
- 不移除隐藏模型水印，不承诺绕过任何 AI detector，不以掩盖作者身份为产品目标。
- 不成为通用 slop scanner；不新增安全漏洞、复杂度、dead code、依赖、测试质量、UI 设计或架构评分规则。
- 不替代 ESLint、TypeScript、CodeQL、Semgrep、CodeRabbit、Greptile 或人工 review。
- 不让 LLM 进入 `remove-safe` / `rewrite-safe` 的自动写入路径。
- 不自动重命名变量、不做结构重构、不修改非注释 token。
- 不执行目标仓库脚本、不安装目标仓库依赖。
- 不自动 stage、commit、push、开 PR 或改分支。
- 不上传源代码、diff、文件路径或 finding 到 RepoFit Comments 服务；V1 不建设托管 dashboard。
- 不做跨文件全仓“一键清理”事务；自动写入保持单 finding 或单文件事务。
- V1 正式支持范围为 TypeScript 家族（`.ts`、`.tsx`、`.mts`、`.cts`）。JS/JSX、Python、Go 等语言只有在独立 extractor、保护模型和真实证据门槛通过后才进入后续版本。

## 7. V1 功能边界

### 7.1 必须提供的用户流程

1. **检查**：对 staged、worktree 或 `--base <ref>` 范围执行 changed-comment-only 分析。
2. **预览**：展示具体 finding、原文、建议动作、证据和保护/不写入原因。
3. **解释**：通过稳定 finding ID 查看规则、仓库风格证据、风险和候选替换。
4. **修复**：只对 `remove-safe` 和 `rewrite-safe` 执行显式 dry-run 或 `--apply`；支持单 finding 和单文件安全批次。
5. **验证**：读取最近一次 receipt，复验文件 hash、非注释 token、语法树、受保护注释和 parse 状态。
6. **CI**：在 PR diff 上生成稳定退出码、JSON 和 SARIF；提供固定版本 GitHub Action。

### 7.2 Finding 合同

V1 保留五类动作，并把它们作为稳定公开 schema：

| 动作 | V1 行为 |
| --- | --- |
| `remove-safe` | 窄规则可删除独立行注释；必须通过所有写入不变量。 |
| `rewrite-safe` | 只允许确定性、局部、注释内重写，例如去掉 `Step N:` 前缀并保留理由。 |
| `rewrite-suggested` | 提供建议但不自动写入。 |
| `keep-protected` | 明确展示保护类别与理由；永不自动写入。 |
| `uncertain` | 默认不写入；可在详细输出中查看，不计入自动修复。 |

正式版不得把 suggestion-only 规则通过配置“升级”为自动写入规则。

### 7.3 受保护注释

V1 至少维持当前保护类别，并增加以下产品要求：

- 输出可解释的 protection reason，而不仅是 protected 数量。
- 保护规则拥有稳定 ID、版本和回归用例。
- 配置只能增加保护范围，不能将内置 legal、tooling、security、compatibility 和 rationale 核心保护降级为自动删除。
- suppression 必须支持可选/推荐理由，并在详细报告中可见；安全类别的保护不能被裸 suppression 静默绕过。

### 7.4 配置

V1 提供静态、不可执行的仓库配置文件，例如 `.repofit.yml`，至少支持：

- 路径 include/exclude；
- 规则启停与 suggestion 严格度；
- 额外保护短语或路径；
- CI 是否因新增 safe finding 失败；
- 显示语言和输出格式；
- 版本化 rule-pack pin。

V1 不加载可执行 JavaScript/TypeScript 配置，避免扫描工具执行仓库控制的代码。

### 7.5 输出与集成

- 人类可读终端输出默认简短，先显示安全动作、再显示建议、最后显示保护统计。
- JSON 提供 schema version、CLI version、rule-pack version、scope、稳定 finding ID 和每项证据。
- SARIF 用于 GitHub code scanning annotations，但不得上传额外仓库内容。
- GitHub Action 必须支持精确版本 pin；正式文档不以浮动 `main` 或 `latest` 作为可复现示例。
- Agent 集成优先复用 JSON/标准输入输出；V1 不以支持十几个 Agent 专用 hook 为发布条件。

### 7.6 写入与 receipt

每个自动写入事务必须：

1. 校验 finding 仍匹配原注释与分析时文件 hash；
2. 在内存中构造完整候选文件；
3. 拒绝重叠 edit、symlink、非普通文件和并发修改；
4. 要求修改前后均无 parse diagnostics；
5. 要求非注释 token 序列一致；
6. 要求去注释语法树一致；
7. 要求所有受保护注释内容与顺序一致；
8. 以原子替换写入；
9. 生成权限受限的 receipt，并能由独立 `verify` 命令复验。

receipt 是安全证据，不是“运行行为完全等价”或“被删注释一定无价值”的证明；文档必须保留该限制。

### 7.7 分发与支持矩阵

1.0 发布至少包括：

- npm public package 和 `npx` 使用路径；
- npm provenance、签名 Git tag、checksums 和可复现的 package smoke test；
- 固定版本 GitHub Action；
- Node.js 22 与 24；
- macOS、Ubuntu/Linux 和 Windows 的 CI、安装、扫描、dry-run、apply、verify 测试；
- 安装、升级、卸载、迁移、故障排查、安全报告和支持策略文档。

Homebrew 不是 1.0 阻塞项；只有在 npm 发行稳定后再增加，避免同时维护过多渠道。

### 7.8 隐私与遥测

- 核心命令默认和显式行为均为零遥测、零账户、零网络依赖。
- CI 也不得为分析而联网；下载 npm 包或 Action 本身不等同于运行期上传源代码。
- 若未来引入 opt-in usage analytics，必须先形成单独产品决策、公开事件 schema，并默认关闭；不在 V1 范围内。

### 7.9 性能目标

以下是尚未验证的产品目标，不是当前事实：

- 对 100 个 changed TypeScript/TSX 文件的本地 diff，温启动扫描 P95 小于 5 秒；
- 相同输入、相同版本和相同配置必须产生相同 findings、IDs 和候选 patch；时间戳等非决定性字段不参与结果等价性；
- 无 finding 的 CI 运行不得修改工作树或 `.git` receipt。

## 8. 商业化假设

以下均为待验证假设：

1. **V1 CLI 免费且 MIT 开源。** 当前直接竞品已有多个免费 MIT CLI，对本地扫描收费会显著增加采用阻力。
2. **未来收费对象是团队治理，而不是本地安全能力。** 潜在付费能力包括组织规则层级、例外审批、跨仓库 policy、审计导出、趋势和托管 PR checks。
3. **安全核心保持开放。** protection rules、write invariants、receipt schema 和本地 verify 不应成为闭源或付费专属能力，否则会削弱核心信任。
4. **V1 不设正式付费价格。** 只有在至少 3 个独立团队愿意把 RepoFit Comments 放进持续 CI，并明确表达团队治理预算后，才设计付费方案。
5. **不与通用 reviewer 按席位价格正面竞争。** CodeRabbit 和 Greptile 约 $30/开发者/月，购买理由是全面 review；RepoFit Comments 若推出团队层，必须以更窄、更低摩擦的 workspace/policy 价值验证定价。

## 9. 1.0 真实证据门槛

只有全部满足，才能称为 RepoFit Comments 1.0；未满足时仍是 Beta/RC。

### 9.1 语料与盲审

- 至少 20 个相互独立的 TypeScript/React 仓库；不能主要来自作者自己的项目。
- 至少 200 个真实开发 diff，包含人写、AI-assisted 和来源未知的变化；评估时不要求也不尝试判断作者。
- 至少 500 条进入 `remove-safe` / `rewrite-safe` 候选集的真实注释。
- 至少 5 位非项目作者的维护者或高级工程师进行盲标，标签为 keep/rewrite/remove，并记录分歧。
- 每条自动规则单独报告 precision、样本数和置信区间；不得只报告总体准确率。
- 自动写入候选的盲审接受率目标 ≥98%；任何许可证、工具指令、API 文档、安全/兼容性理由或其他核心 protected comment 的误删均为 release blocker。

### 9.2 写入安全

- 全部 corpus auto-fix 中，非注释 token 变化为 0。
- 全部 corpus auto-fix 中，去注释语法树变化为 0。
- 全部 corpus auto-fix 中，受保护注释内容丢失、改变或重排为 0。
- 并发修改、symlink、parse error、CRLF、template literal、JSX comment、Unicode、无权限文件和中断写入均有自动化回归。
- 对 receipt 执行独立重放/篡改测试，验证修改后确实失败。

### 9.3 分发与运行

- npm 干净安装、`npx`、项目 devDependency 和 GitHub Action 四条路径均通过 smoke test。
- Node 22/24 × macOS/Linux/Windows 支持矩阵通过；未运行的平台不得标记支持。
- 发布 SHA、npm tarball integrity、GitHub tag 和 CI evidence 可相互绑定。
- 运行时依赖审计无已知 critical/high 漏洞；任何例外必须有公开、限时的风险接受记录。

### 9.4 用户价值

- 至少 10 位目标维护者在真实仓库连续使用两周。
- 至少 60% 在第二周再次使用，或至少 3 个独立团队将固定版本检查放进 CI。
- 记录 auto-fix 接受、手动撤销、suppression、规则关闭和 false-positive 报告；不得只统计扫描次数。
- 至少 70% 的参与者认同它减少了注释审阅时间，且不降低对重要注释的信任。

## 10. Go / Pivot / Stop

### Go：继续独立产品

满足以下条件时进入 1.x：

- 1.0 的安全、发行和盲审门槛全部通过；
- 至少 3 个独立团队愿意持续在 CI 中使用固定版本；
- 用户选择 RepoFit Comments 的主要理由是“保护意图 + 可验证写入”，而不只是一次性删除 `Step N:`；
- 与 aislop、slop-scan、vibecop 的同 corpus 对照显示，RepoFit Comments 在重要注释保护或自动修复接受率上有可重复优势。

### Pivot：变为集成组件

出现以下情况时不建设独立 SaaS，转为免费 CLI、库、ESLint/Agent/现有 reviewer 插件或规则包：

- 安全和 precision 达标，但少于 30% 的目标仓库产生可行动 finding；
- 两周后继续使用率低于 40%，且用户只在偶发大批生成后运行；
- 团队认可规则，但不愿安装另一个独立 CI 产品；
- 最有价值的使用方式是被 aislop、CodeRabbit 或 Agent 工作流调用，而非直接使用。

### Stop：停止正式产品投入

出现任一情况时停止 1.0 发布并回到研究阶段：

- 发生非注释 token、语法树或核心受保护注释的自动修改，且无法通过收紧规则从机制上消除；
- 真实盲审中 auto-fix 接受率低于 95%，或误报主要来自无法可靠静态判断的语义；
- 对照实验无法证明相对于免费竞品有重要注释保护或工作流价值；
- 用户的主要需求被验证为作者身份掩饰或 detector bypass，而不是减少审阅噪音；
- 没有目标维护者愿意连续使用，且没有团队愿意把它加入 CI。

## 11. 推断、反对理由与未知项

### 11.1 当前产品推断

- 最有机会形成差异的不是规则数量，而是可验证 receipt、保护优先级和真实误报 corpus 的组合。
- RepoFit Comments 更适合成为 CodeRabbit、Greptile、aislop、ESLint 之前的窄层，而不是替代它们。
- “完全离线、零遥测”对私有代码用户有价值，但 aislop、slop-scan、vibecop 也有本地确定性能力，因此隐私本身不足以成为唯一护城河。
- 长期护城河只能来自维护者标注、规则级 precision 历史、受保护语义模型和公开可复现实验；当前代码还没有形成该护城河。

### 11.2 反对独立产品化的理由

- 注释清理可能只是低频功能，而不是足够大的独立产品。
- aislop 已覆盖 narrative/trivial comments、safe fix、CI、hooks、MCP、多语言与商业团队层，功能追赶没有合理终点。
- token/AST 不变只能证明代码结构不变，不能证明被删除的文字没有业务价值。
- 用户可以直接要求现有编码 Agent 重写注释，RepoFit Comments 的额外安装成本必须由更高信任来抵消。
- “让代码更像真人写的”有声誉和伦理风险，必须持续避免作者归因与规避检测的表达。

### 11.3 尚未知

- 真实仓库中可行动注释出现的频率，以及用户一周内会运行多少次。
- 用户是否理解并重视 receipt，还是只关心更快的一键删除。
- 与竞品在同一 corpus 上的真实 precision、recall、运行时间和修复接受率。
- 当前 style profile 的最小样本是否足以形成稳定、可重复的仓库风格判断。
- JS/JSX 或其他语言扩展时，能否定义与 TypeScript 同等强度的语法和保护不变量。
- 团队治理是否有付费意愿，以及适合按 workspace、repository、seat 还是 usage 定价。
- `RepoFit Comments`、`repofit-comments` 和相关域名/商标的长期可用性；当前仅确认 npm 在截点没有已发布的 `repofit-comments` 包，这不构成商标或品牌权利。

## 12. 首个验证实验

在增加新规则或新语言前，先建立同 corpus 对照：

1. 冻结 20 个仓库、200 个 diff 和维护者盲标协议。
2. 用相同输入运行 RepoFit Comments、aislop `--safe`、slopscore fix，以及 slop-scan/vibecop 的扫描模式。
3. 分别记录 protected loss、规则级 precision、auto-fix 接受/撤销、actionable finding 数、耗时和首次安装到结果的时间。
4. 先修复误报并沉淀回归，再决定 JS/JSX、Agent hook 或 Team 产品；不得根据宣传页的规则数量直接排期。

这个实验会决定 RepoFit Comments 是继续成为独立产品、转为现有工具的安全修复组件，还是停止投入。
