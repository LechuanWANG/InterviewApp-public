# InterviewApp 版本迭代时间轴

> 整理依据：`origin/main` 的 GitHub 推送/提交历史，范围为 `db42105`（2026-04-29）到 `ab74566`（2026-06-07）。  
> 筛选口径：只保留对产品能力、数据架构、部署交付或核心体验有明显影响的更新；单纯触发部署、清理文件、误删恢复、零散文案调整等记录不单独列出。  
> 说明：下方版本号为时间轴整理用，不代表仓库中已有 Git tag。

## 总览

| 日期 | 阶段 | 代表提交 | 重要更新 |
| --- | --- | --- | --- |
| 2026-04-29 | V0.1 产品初版 | `db42105` | 完成 AI 面试训练应用基础架构，包含面试、咨询、报告、历史记录、语音、LLM 接入和 Supabase 初始结构。 |
| 2026-04-29 | V0.2 面试结束与报告生成增强 | `ba6cce2`, `84818cd`, `f4eedf7` | 引入面试结束检测、报告生成服务、历史删除逻辑和本地 demo 同步能力。 |
| 2026-04-30 | V0.3 体验反馈与缓存控制 | `ce9c749` | 新增面试/咨询体验评分 API、评分组件和 Supabase 评分表迁移。 |
| 2026-05-01 | V0.4 用户认证与数据归属 | `393646f`, `dc0c9f3` | 优化首页、摘要和报告导航；接入 Supabase Auth 与 RLS，使会话、历史、反馈等数据绑定到用户。 |
| 2026-05-02 | V0.5 面试流程控制优化 | `08304a4` | 新增停止意图识别，完善面试对话收束、追问和报告提示词。 |
| 2026-05-05 | V0.6 标注与脚本化能力补强 | `3585833` | 增加回答标注再生成脚本、构建产物和标注核心测试，强化报告标注链路。 |
| 2026-05-23 | V0.7 AI Council 与长期记忆系统 | `8fc765a` | 新增 AI Council 面试模式、流式多角色讨论界面、用户记忆画像、记忆图谱和后续计划文档。 |
| 2026-05-24 - 2026-05-25 | V0.8 Cloudflare 生产部署链路 | `b47db12`, `47a3b8e`, `8ddac25` | 接入 Cloudflare Workers、OpenNext、Wrangler 和 GitHub Actions，建立生产部署工作流。 |
| 2026-05-25 | V0.9 语音面试与报告链路强化 | `37bea3f`, `d52a8de` | 新增实时 ASR WebSocket、答案完整性校验、报告标注 API、本地 ASR 服务脚本和软删除机制。 |
| 2026-05-26 | V0.10 登录与部署环境稳定化 | `72191a8`, `6297270`, `1d5b775` | 增加 Google 登录入口，修复 Cloudflare 构建中 Supabase 公共变量注入和浏览器端环境兜底。 |
| 2026-05-28 | V0.11 记忆图谱与实时转写修复 | `2244cf5`, `af929ee` | 优化咨询记忆图谱展示与选择逻辑，修复实时转写显示和 Supabase 环境注入问题。 |
| 2026-06-07 | V0.12 报告维度与实时转写流程升级 | `ab74566` | 更新报告评分维度、面试设置流程、实时转写交互、语音设置和报告 demo 生成脚本，并重整产品文档目录。 |

## 详细时间轴

### 2026-04-29 - V0.1 产品初版

代表提交：`db42105`  

本次初始版本一次性搭建了 AI 面试训练产品的主体能力：

- 前端页面：主页、面试创建、面试对话、报告、历史记录、咨询、咨询历史、咨询议题、设置流程和报告 demo。
- 后端 API：面试 session、回答提交、结束面试、生成报告、转写、TTS、简历解析、咨询会话、咨询消息、历史记录和模型测试。
- AI 能力：接入 OpenAI、Anthropic、DeepSeek、Doubao 等 LLM 适配层，建立面试、咨询、报告、答案标注等提示词模块。
- 语音能力：加入浏览器 ASR、Doubao ASR/TTS、音频转 WAV 和语音设置。
- 数据层：建立本地 store、历史记录 store、咨询 store、Supabase 初始 schema。
- 验证基础：加入答案标注、咨询记忆、咨询技能相关测试。

阶段意义：产品从零进入可运行原型状态，已经具备“创建面试 - 语音/文本作答 - 生成报告 - 查看历史 - 咨询辅助”的完整闭环。

### 2026-04-29 - V0.2 面试结束与报告生成增强

代表提交：`ba6cce2`, `84818cd`, `f4eedf7`

重要更新：

- 抽离 `lib/interview/endDetection.ts` 和 `lib/interview/reportService.ts`，把面试结束判断与报告生成逻辑从页面/API 中分离出来。
- 优化回答提交与报告页面，使面试结束检测更稳定，报告生成入口更清晰。
- 改进历史记录删除逻辑，减少删除面试或咨询记录时的数据不一致风险。
- 新增 `scripts/sync-local-demos-to-supabase.mjs`，支持把本地 demo 数据同步到 Supabase。
- 增加 `tests/interviewEndDetection.test.ts`，开始覆盖面试结束判断。

阶段意义：核心面试流程从“能跑”推进到“更可维护、更可测试”，报告生成和历史数据管理进入服务化阶段。

### 2026-04-30 - V0.3 体验反馈与缓存控制

代表提交：`ce9c749`

重要更新：

- 新增 `app/api/feedback/consult/route.ts` 和 `app/api/feedback/interview/route.ts`，支持咨询与面试体验评分。
- 新增 `components/ExperienceRating.tsx`，在产品界面中收集用户反馈。
- 新增 `lib/experienceFeedback.ts`，统一处理体验反馈写入逻辑。
- 新增 `supabase/20260430_experience_ratings.sql`，并扩展 `supabase/schema.sql`。
- 同步优化历史记录、咨询历史、创建流程和面试组件中的缓存/数据读取行为。

阶段意义：产品开始具备体验反馈闭环，后续可以基于评分数据观察面试与咨询质量。

### 2026-05-01 - V0.4 用户认证与数据归属

代表提交：`393646f`, `dc0c9f3`

重要更新：

- 优化首页、摘要页、报告页和历史页体验，并新增 `ReportFloatingNav`。
- 新增 Supabase 登录链路：`app/login/page.tsx`、`app/auth/callback/page.tsx`、`components/AuthLogin.tsx`、`components/AuthCallback.tsx`、`components/AuthControl.tsx`。
- 新增 `lib/auth.ts` 和 `lib/supabaseBrowser.ts`，建立服务端/浏览器端认证辅助能力。
- 新增 `app/api/auth/session/route.ts`，支持会话校验。
- 新增 `supabase/20260501_user_ownership.sql`，为面试、咨询、历史和反馈数据增加用户归属与 RLS 约束。
- 调整多个 API，使数据访问按当前用户隔离。

阶段意义：产品从单用户/弱归属数据模型升级为可支持真实用户登录和私有数据隔离的应用。

### 2026-05-02 - V0.5 面试流程控制优化

代表提交：`08304a4`

重要更新：

- 新增 `lib/interview/stopIntent.ts`，识别用户主动结束或停止面试的表达。
- 优化 `app/api/session/[id]/answer/route.ts`，让回答提交流程能结合结束检测与停止意图。
- 调整答案标注和最终报告提示词，使追问、结束和报告输出更贴近业务流程。
- 更新 `tests/interviewEndDetection.test.ts`，补充结束检测相关测试。

阶段意义：面试流程从固定轮次/简单结束判断，升级为更自然的对话式收束。

### 2026-05-05 - V0.6 标注与脚本化能力补强

代表提交：`3585833`

重要更新：

- 新增 `scripts/regenerate-anker-annotations.ts`，支持批量再生成/校准特定 demo 报告的答案标注。
- 新增 `tsconfig.script.json` 与 `.script-build/` 构建产物，方便脚本在独立运行环境中使用核心业务模块。
- 增强 `lib/prompts/annotateAnswersCore.ts`，并补充 `tests/annotationCore.test.ts`。
- 调整语音设置面板和国际化内容。

阶段意义：报告标注能力开始从页面内逻辑扩展为可批处理、可验证的工具链。

### 2026-05-23 - V0.7 AI Council 与长期记忆系统

代表提交：`8fc765a`

重要更新：

- 新增 `app/interview/council/page.tsx` 和 `components/InterviewCouncilPage.tsx`，提供 AI Council 面试入口。
- 新增 `app/api/session/council-stream/route.ts`，支持多角色讨论/评议的流式输出。
- 新增 Council 相关组件：圆桌、思考动画、转录面板、设计简报、样式和工具函数。
- 扩展 `InterviewChat` 与 `ConsultChat`，把普通面试/咨询流程与记忆、计划和多 Agent 逻辑衔接起来。
- 新增长期记忆能力：`memoryGraph`、`memoryItems`、`memoryProfile`、`memorySelector`、`memoryCoverage` 等模块。
- 新增记忆相关 Supabase 迁移：用户记忆项、咨询记忆画像、咨询记忆图谱。
- 新增多份产品与技术计划文档，包括 AI Council 主题计划、开放式咨询记忆计划、下一步计划和业务流程图。

阶段意义：产品从单 Agent 面试训练，扩展到“多角色评议 + 用户长期记忆”的更高阶能力。

### 2026-05-24 - 2026-05-25 - V0.8 Cloudflare 生产部署链路

代表提交：`b47db12`, `47a3b8e`, `8ddac25`

重要更新：

- 新增 `open-next.config.ts` 和 `wrangler.jsonc`，接入 Cloudflare Workers 部署形态。
- 调整 Next.js、PDF 解析、LLM 和 TTS 相关配置，使应用适配 Cloudflare 运行环境。
- 新增 `.github/workflows/cloudflare-workers.yml`，开始通过 GitHub Actions 部署 Cloudflare Worker。
- 后续继续补充 Cloudflare 生产部署 workflow、部署记录 workflow、Node 版本和 ASR WebSocket 部署修复。
- 新增/更新 Cloudflare 部署文档，记录 GitHub 到 Cloudflare 的部署配置。

阶段意义：项目从本地/传统 Next.js 运行，进入可自动化发布到 Cloudflare Workers 的生产交付阶段。

### 2026-05-25 - V0.9 语音面试与报告链路强化

代表提交：`37bea3f`, `d52a8de`

重要更新：

- 新增 `app/api/asr/stream/route.ts`，支持实时 ASR 流式转写。
- 新增 `lib/voice/liveDoubaoAsrClient.ts` 和 `lib/voice/doubaoAsrStreamProtocol.ts`，封装 Doubao 实时 ASR 协议。
- 新增 `scripts/local-asr-stream-server.mjs` 和 `scripts/dev.mjs`，支持本地实时语音开发。
- 增强 `VoiceRecorder`、`InterviewChat`、`SetupFlow` 和 `ReportView`，提升语音输入、面试推进和报告展示体验。
- 新增 `lib/interview/answerIntegrity.ts`，校验回答完整性。
- 新增 `app/api/session/[id]/report/annotations/route.ts`，支持报告答案标注。
- 新增 `tests/answerIntegrity.test.ts` 和 `tests/doubaoAsrStreamProtocol.test.ts`。
- 新增 `supabase/20260525_soft_delete_records.sql`，对面试和咨询记录引入软删除机制。

阶段意义：语音面试链路从普通录音/转写升级为实时转写，并进一步增强报告质量控制和历史记录安全删除能力。

### 2026-05-26 - V0.10 登录与部署环境稳定化

代表提交：`72191a8`, `6297270`, `1d5b775`

重要更新：

- 在登录页新增 Google sign-in 按钮。
- 在 Cloudflare 构建流程中注入 Supabase public 环境变量。
- 增加 Supabase 浏览器端环境变量兜底，降低生产环境变量缺失导致登录或数据访问失败的风险。
- 后续加入并移除调试性质的登录来源提示，说明该阶段主要围绕生产环境诊断和稳定性收敛。

阶段意义：认证链路和 Cloudflare 环境配置逐步稳定，减少线上登录和 Supabase 初始化问题。

### 2026-05-28 - V0.11 记忆图谱与实时转写修复

代表提交：`2244cf5`, `af929ee`

重要更新：

- 重构/优化 `lib/consultation/memoryGraph.ts`，改善咨询记忆图谱的结构和展示逻辑。
- 调整 `memorySelector`、咨询 store 和咨询界面，使记忆选择和咨询上下文更稳定。
- 移除独立的咨询 memory API，减少重复入口。
- 修复 `VoiceRecorder` 和 `InterviewChat` 中实时转写显示问题。
- 新增 `lib/publicSupabaseEnv.ts` 和 `scripts/verify-public-supabase-env.mjs`，更明确地验证 Supabase public 环境变量。
- 在 `app/layout.tsx` 中注入公开环境变量，配合 Cloudflare 部署环境。

阶段意义：长期记忆系统从“新增能力”进入“可视化与稳定性优化”，同时修复实时转写和线上环境注入问题。

### 2026-06-07 - V0.12 报告维度与实时转写流程升级

代表提交：`ab74566`

重要更新：

- 更新 `ReportView`、报告 demo API 和报告页，强化报告展示维度。
- 大幅调整 `SetupFlow`、`CreateForm`、`VoiceRecorder`、`VoiceSettingsPanel` 和 `InterviewChat`，优化面试准备、语音设置和实时转写流程。
- 扩展报告提示词和类型定义，使最终报告能够覆盖更明确的业务主题与评分维度。
- 新增 `scripts/generate-anker-report-demo.ts` 和 `scripts/generate-council-report-demo.ts`，支持生成不同场景的报告 demo。
- 新增 `docs/description/product-description-complete.md` 和 `docs/description/product-requirements-overview.md`。
- 将计划类文档移动到 `docs/plan/`，并新增 `docs/plan/interview-report-business-theme-score-plan.md`。
- 新增 `docs/update/260606/product-tech-highlights.md`，记录产品和技术亮点。

阶段意义：报告从通用总结进一步向业务化评分和展示维度升级，实时转写流程也更接近正式面试使用场景。

## 未单独列出的推送类型

以下类型的提交已被合并到相邻阶段或忽略，未作为独立版本节点展示：

- 仅触发 Cloudflare redeploy 的提交。
- 单纯 cleanup、截图删除、参考资料移除、Git tracking 恢复等仓库维护提交。
- 只包含很小范围 UI 文案、国际化或构建产物同步的提交。
- 生产部署链路中的重复修复提交，已统一归入 V0.8 或 V0.10。

## 当前状态

截至 `ab74566`（2026-06-07），InterviewApp 已形成以下核心能力组合：

- AI 面试训练：支持创建面试、对话追问、停止意图识别、答案完整性校验和报告生成。
- 语音交互：支持 TTS、ASR、实时转写和本地实时 ASR 开发服务。
- 报告体系：支持答案标注、业务维度评分、报告 demo 生成和报告展示优化。
- 咨询与记忆：支持咨询会话、用户长期记忆、记忆画像和记忆图谱。
- 多 Agent 能力：支持 AI Council 面试模式和流式多角色讨论。
- 用户体系：支持 Supabase Auth、Google 登录、RLS 数据隔离和用户数据归属。
- 生产交付：支持 Cloudflare Workers、OpenNext、Wrangler 和 GitHub Actions 自动部署。
