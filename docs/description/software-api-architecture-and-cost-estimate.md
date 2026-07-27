# InterviewApp API、架构与单次使用成本测算

> 整理日期：2026-06-07  
> 整理依据：当前仓库代码、`.env.example`、`package.json`、`wrangler.jsonc`、Cloudflare GitHub Actions 配置、Supabase schema，以及各服务官方公开定价页。  
> 价格说明：API 和云服务价格会变化，本文只按整理当天可查到的公开价格做工程估算，真实账单以各服务控制台为准。  
> 估算口径：默认按“一次中等难度完整模拟面试”测算，即创建面试、完成 8 轮问答、生成报告、可选生成答案标注、可选使用语音识别和语音合成。
> 当前用户可用范围：前端仅开放 `DeepSeek V4 Pro` 和 `DeepSeek V4 Flash` 两个 LLM；语音仅开放豆包 ASR/TTS。OpenAI、Anthropic、豆包 LLM 等仅作为非当前开放成本参考，不计入当前用户实际可选路径。

## 1. 系统组成总览

| 层级 | 当前实现 | 主要文件/配置 | 成本类型 |
| --- | --- | --- | --- |
| 前端 | Next.js App Router + React 18 + Tailwind CSS | `app/**/page.tsx`, `components/**` | 开源框架本身无 API 费用；托管在 Cloudflare Workers 上产生 Worker 请求/CPU 成本 |
| 后端 | Next.js API Routes，运行在 Node.js runtime / Cloudflare Workers OpenNext 环境 | `app/api/**/route.ts`, `worker.ts`, `open-next.config.ts` | Worker 动态请求、CPU 时间；外部 API 调用费用 |
| 数据库与认证 | Supabase Postgres + Supabase Auth + RLS | `lib/supabase.ts`, `lib/supabaseBrowser.ts`, `supabase/schema.sql` | Supabase 月费/额度/超额 MAU、数据库、流量 |
| LLM | 前端仅开放 DeepSeek V4 Pro / V4 Flash | `lib/llm/deepseek.ts`, `lib/llm/models.ts` | 按 token 计费 |
| 语音识别 ASR | 前端仅开放豆包语音 ASR，包括录音转写和实时 ASR | `app/api/transcribe/route.ts`, `app/api/asr/stream/route.ts`, `lib/voice/**` | 按音频时长计费 |
| 语音合成 TTS | 前端仅开放豆包 TTS | `app/api/tts/route.ts`, `lib/voice/doubaoTts.ts` | 按字符计费 |
| PDF 解析 | 本地 `pdf-parse` 解析简历 PDF | `app/api/resume/parse/route.ts`, `lib/pdf/parsePdf.ts` | 无外部 API 费用，只消耗 Worker/Node 资源 |
| 托管网站 | Cloudflare Workers + OpenNext + Workers Assets | `wrangler.jsonc`, `.github/workflows/cloudflare-production.yml` | Cloudflare Workers 月费/请求/CPU |
| CI/CD | GitHub Actions 部署到 Cloudflare | `.github/workflows/cloudflare-production.yml` | 不是用户单次使用成本；按 GitHub Actions 分钟数计费或走免费额度 |

当前生产部署目标在 workflow 中写为：

```text
https://interview-app.lwangey.workers.dev/
```

## 2. 前端页面清单

| 页面路由 | 文件 | 作用 |
| --- | --- | --- |
| `/` | `app/page.tsx` | 首页/主入口，进入面试、历史、咨询等核心功能 |
| `/setup` | `app/setup/page.tsx` | 面试配置流程，收集简历、JD、公司、岗位、面试类型、模型、难度等 |
| `/interview/new` | `app/interview/new/page.tsx` | 新建面试入口 |
| `/interview/[sessionId]` | `app/interview/[sessionId]/page.tsx` | 正式面试对话页面 |
| `/interview/council` | `app/interview/council/page.tsx` | AI Council 面试计划/多角色评议入口 |
| `/report/[sessionId]` | `app/report/[sessionId]/page.tsx` | 面试报告页 |
| `/report-demo` | `app/report-demo/page.tsx` | 报告 demo 预览 |
| `/history` | `app/history/page.tsx` | 历史面试列表 |
| `/history/[recordId]` | `app/history/[recordId]/page.tsx` | 单条历史面试详情 |
| `/summary` | `app/summary/page.tsx` | 历史面试选择/总结入口 |
| `/consult/issues` | `app/consult/issues/page.tsx` | 常见问题/咨询议题汇总 |
| `/consult/history` | `app/consult/history/page.tsx` | 咨询历史 |
| `/consult/[consultId]` | `app/consult/[consultId]/page.tsx` | 战略咨询对话 |
| `/login` | `app/login/page.tsx` | Supabase 登录页，支持邮箱/Google/GitHub OAuth UI |
| `/auth/callback` | `app/auth/callback/page.tsx` | Supabase OAuth 回调页 |

前端核心组件包括：

- `SetupFlow.tsx`：面试创建和语音准备流程。
- `InterviewChat.tsx`：面试问答主界面。
- `VoiceRecorder.tsx`：浏览器录音、ASR 调用、实时字幕处理。
- `ReportView.tsx`：报告展示。
- `ConsultChat.tsx`：咨询对话。
- `InterviewCouncilPage.tsx` 和 `components/council/**`：AI Council 可视化流程。
- `AuthLogin.tsx`、`AuthCallback.tsx`、`AuthControl.tsx`：登录态同步。

## 3. 后端 API 清单

### 3.1 面试与报告 API

| 方法 | 路径 | 作用 | 主要外部依赖 |
| --- | --- | --- | --- |
| `POST` | `/api/session` | 创建普通面试 session，生成面试计划和开场问题 | LLM、Supabase |
| `POST` | `/api/session/council-stream` | 创建 AI Council 面试 session，通过 SSE 返回多角色规划过程 | LLM、Supabase |
| `GET` | `/api/session/[id]` | 获取当前面试状态、轮次、当前问题和报告状态 | Supabase |
| `POST` | `/api/session/[id]/answer` | 保存候选人回答，识别停止意图，生成下一题或结束面试 | LLM、Supabase |
| `POST` | `/api/session/[id]/finish` | 手动结束面试，保存未作答/超时状态 | Supabase |
| `POST` | `/api/session/[id]/report` | 生成面试报告并写入历史记录 | LLM、Supabase |
| `GET` | `/api/session/[id]/report` | 获取已生成报告、轮次、公司和岗位 | Supabase |
| `POST` | `/api/session/[id]/report/annotations` | 生成报告中的逐轮回答标注 | LLM、Supabase |
| `GET` | `/api/session/[id]/report/annotations` | 查询报告标注状态和结果 | Supabase |
| `GET` | `/api/report-demo` | 读取 demo 报告数据 | Supabase/本地 demo 数据 |

### 3.2 历史记录与反馈 API

| 方法 | 路径 | 作用 | 主要外部依赖 |
| --- | --- | --- | --- |
| `GET` | `/api/history` | 获取当前用户的历史面试列表 | Supabase |
| `GET` | `/api/history/[id]` | 获取单条历史面试记录 | Supabase |
| `DELETE` | `/api/history/[id]` | 软删除历史面试记录 | Supabase |
| `POST` | `/api/feedback/interview` | 保存面试体验评分 | Supabase |
| `POST` | `/api/feedback/consult` | 保存咨询体验评分 | Supabase |

### 3.3 咨询与长期记忆 API

| 方法 | 路径 | 作用 | 主要外部依赖 |
| --- | --- | --- | --- |
| `POST` | `/api/consult/session` | 基于历史面试创建咨询会话，并生成开场消息 | LLM、Supabase |
| `GET` | `/api/consult/[id]` | 获取咨询会话详情 | Supabase |
| `DELETE` | `/api/consult/[id]` | 软删除咨询会话 | Supabase |
| `POST` | `/api/consult/[id]/message` | 保存用户消息并生成咨询回复，必要时生成总结 | LLM、Supabase |
| `POST` | `/api/consult/[id]/stop` | 主动结束咨询并生成总结 | LLM、Supabase |
| `POST` | `/api/consult/[id]/resume` | 恢复咨询会话 | Supabase |
| `GET` | `/api/consult/history` | 获取咨询历史 | Supabase |
| `GET` | `/api/consult/issues` | 获取跨面试常见问题 | Supabase |
| `POST` | `/api/consult/issues` | 基于选择的历史面试分析常见问题 | Supabase/本地分析逻辑 |

### 3.4 认证、语音、文件与模型测试 API

| 方法 | 路径 | 作用 | 主要外部依赖 |
| --- | --- | --- | --- |
| `GET` | `/api/auth/session` | 读取当前应用 cookie 登录态 | Supabase/Auth cookie |
| `POST` | `/api/auth/session` | 用 Supabase access token 同步应用 cookie | Supabase Auth |
| `DELETE` | `/api/auth/session` | 清除应用 cookie | 无外部 API |
| `POST` | `/api/transcribe` | 上传录音文件并转写；当前前端使用豆包 ASR | 豆包 ASR |
| `GET` | `/api/asr/stream` | WebSocket 实时 ASR 代理 | 豆包流式 ASR、Cloudflare WebSocket |
| `POST` | `/api/tts` | 文本转语音；当前前端使用豆包 TTS | 豆包 TTS |
| `POST` | `/api/resume/parse` | 解析 PDF 简历文本 | 本地 `pdf-parse` |
| `POST` | `/api/model/test` | 开发/诊断用模型测试接口；不作为普通用户入口 | LLM |

## 4. 外部服务与环境变量

### 4.1 当前用户可用 LLM

| 服务 | 代码入口 | 环境变量 | 当前用途 |
| --- | --- | --- | --- |
| DeepSeek API | `lib/llm/deepseek.ts` | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | 当前前端模型列表默认暴露 `deepseek-v4-pro` 和 `deepseek-v4-flash`；用于面试计划、追问、停止意图、报告、标注、咨询 |

需要注意：

- `lib/llm/models.ts` 当前 UI 默认模型是 `DeepSeek V4 Pro`，并可选 `DeepSeek V4 Flash`。
- 代码库里仍保留其他 provider 适配和部分环境变量，但当前前端没有开放给用户选择，因此不计入当前实际使用链路；相关价格只放在后文的非当前开放成本参考中。
- 普通用户创建面试时，接口会把前端选择的 DeepSeek `provider/model` 写入 session，后续追问、报告、标注、咨询均沿用该 session 中的 DeepSeek 模型。

### 4.2 语音服务

| 服务 | 代码入口 | 环境变量 | 当前用途 |
| --- | --- | --- | --- |
| 豆包录音文件识别/极速版 | `lib/voice/doubaoAsr.ts`, `/api/transcribe` | `DOUBAO_ASR_API_KEY`, `DOUBAO_ASR_FLASH_RESOURCE_ID` | 录音完成后上传并转写 |
| 豆包流式 ASR | `lib/voice/cloudflareAsrStream.ts`, `lib/voice/liveDoubaoAsrClient.ts`, `/api/asr/stream` | `DOUBAO_ASR_STREAM_RESOURCE_ID`, `DOUBAO_ASR_STREAM_ENDPOINT` | 实时字幕/实时识别 |
| 豆包 TTS | `lib/voice/doubaoTts.ts`, `/api/tts` | `DOUBAO_TTS_API_KEY`, `DOUBAO_TTS_RESOURCE_ID`, `DOUBAO_TTS_VOICE`, `DOUBAO_TTS_CLUSTER` | 把 AI 问题或回复转为语音 |

代码中保留了其他语音分支，但当前前端语音入口只开放豆包语音，本文实际成本只按豆包 ASR/TTS 计算；其他语音价格只放在后文的非当前开放成本参考中。

### 4.3 数据、认证与部署

| 服务 | 代码/配置 | 环境变量 | 用途 |
| --- | --- | --- | --- |
| Supabase Postgres | `lib/supabase.ts`, `supabase/schema.sql` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | 服务端读写 session、history、consult、feedback、memory graph |
| Supabase Browser Client | `lib/supabaseBrowser.ts`, `lib/publicSupabaseEnv.ts` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 前端 OAuth 登录和客户端 Supabase 初始化 |
| 应用 cookie | `lib/auth.ts` | `AUTH_COOKIE_SECRET` | 用 Supabase 用户信息签发应用侧登录 cookie |
| Cloudflare Workers | `wrangler.jsonc`, `worker.ts` | `CLOUDFLARE_API_TOKEN` 用于部署；运行时 secrets 见部署文档 | 生产托管 |
| GitHub Actions | `.github/workflows/cloudflare-production.yml` | GitHub Secrets | push 到 `main` 后测试、构建并部署 |

## 5. Supabase 数据表

当前 `supabase/schema.sql` 定义的主要表：

| 表 | 作用 |
| --- | --- |
| `interview_sessions` | 进行中的面试 session，保存简历、JD、计划、轮次、当前问题和报告 |
| `interview_history` | 已完成面试历史记录 |
| `consult_sessions` | 咨询会话 |
| `consult_messages` | 咨询消息 |
| `interview_experience_ratings` | 面试体验评分 |
| `consult_experience_ratings` | 咨询体验评分 |
| `consult_memory_resolutions` | 咨询问题解决记录 |
| `user_memory_items` | 用户长期记忆条目 |
| `consult_memory_profiles` | 压缩后的长期咨询画像 |
| `consult_memory_graph_nodes` | 咨询记忆图谱节点 |
| `consult_memory_graph_edges` | 咨询记忆图谱关系 |

这些表均启用了 RLS，并按 `owner_id` 隔离用户数据。

## 6. 托管与部署方式

### 6.1 Cloudflare Workers + OpenNext

当前配置：

- `wrangler.jsonc`
  - Worker 名称：`interview-app`
  - 入口：`worker.ts`
  - `compatibility_date`: `2026-05-24`
  - `compatibility_flags`: `nodejs_compat`, `global_fetch_strictly_public`
  - 静态资源目录：`.open-next/assets`
  - Assets binding：`ASSETS`
- `open-next.config.ts`
  - `incrementalCache: "dummy"`
  - `tagCache: "dummy"`
  - `queue: "dummy"`

这意味着当前没有使用 Cloudflare R2、KV、D1 或 Queue 做持久缓存；主要由 Supabase 负责业务数据持久化，Cloudflare Worker 负责运行 Next.js 服务端代码和代理实时 ASR WebSocket。

### 6.2 GitHub Actions 部署流程

`.github/workflows/cloudflare-production.yml` 流程：

1. push 到 `main` 或手动触发。
2. 使用 Node.js 24。
3. `npm ci` 安装依赖。
4. `npm test` 运行测试。
5. 校验 Supabase public env。
6. `npm run cf:build` 构建 OpenNext Cloudflare 产物。
7. `npx wrangler deploy` 部署到 Cloudflare Workers。

GitHub Actions 是部署成本，不计入用户每次使用软件的成本。

## 7. 官方定价摘要

### 7.1 当前开放 LLM

| 供应商/模型 | 当前代码使用方式 | 官方价格口径 | 本文估算采用 |
| --- | --- | --- | --- |
| DeepSeek `deepseek-v4-pro` | `https://api.deepseek.com/chat/completions` | 输入 cache miss `$0.435 / 1M tokens`，cache hit `$0.003625 / 1M tokens`，输出 `$0.87 / 1M tokens` | 按 cache miss 输入算，偏保守 |
| DeepSeek `deepseek-v4-flash` | 同上 | 输入 cache miss `$0.14 / 1M tokens`，cache hit `$0.0028 / 1M tokens`，输出 `$0.28 / 1M tokens` | 按 cache miss 输入算，偏保守 |

来源：

- DeepSeek Models & Pricing: <https://api-docs.deepseek.com/quick_start/pricing>

### 7.2 当前开放语音服务

| 服务 | 当前代码资源/接口 | 官方价格口径 | 本文估算采用 |
| --- | --- | --- | --- |
| 豆包大模型录音文件识别极速版 | `DOUBAO_ASR_FLASH_RESOURCE_ID=volc.bigasr.auc_turbo` | 后付费 `4.5 元 / 小时`；资源包可低至约 `4.3 元 / 小时` 或更低 | 按后付费 `4.5 元 / 小时` |
| 豆包大模型流式语音识别 | `DOUBAO_ASR_STREAM_RESOURCE_ID=volc.bigasr.sauc.duration` | 后付费 `4.5 元 / 小时`；资源包可低至 `4 元 / 小时` 起 | 按后付费 `4.5 元 / 小时` |
| 豆包大模型语音合成 | `DOUBAO_TTS_RESOURCE_ID=seed-tts-1.0` | 后付费 `5 元 / 万字符`；资源包可低至 `4.5 元 / 万字符` 起 | 按后付费 `5 元 / 万字符` |

来源：

- 豆包语音计费说明: <https://www.volcengine.com/docs/6561/1359370>
- 火山实时对话式 AI 计费示例: <https://www.volcengine.com/docs/6348/1392584>

### 7.3 非当前开放模型成本参考

以下项目不在当前前端开放给用户选择，只用于对比或未来方案估算。

| 服务/模型 | 价格口径 | 同一用量下估算 |
| --- | --- | --- |
| 火山方舟 `doubao-1.5-pro-32k` | 在线推理输入 `0.80 元 / 1M tokens`，输出 `2.00 元 / 1M tokens` | `100k input + 20k output` 约 `0.12 元` |
| OpenAI `gpt-4o` | 输入 `$2.50 / 1M tokens`，输出 `$10.00 / 1M tokens` | `100k input + 20k output` 约 `$0.45` |
| Anthropic Claude Sonnet 4.5 | 输入 `$3 / MTok`，输出 `$15 / MTok` | `100k input + 20k output` 约 `$0.60` |
| OpenAI transcription + TTS | transcription 按 `$0.006/min` 粗算，`tts-1` 按 `$15 / 1M characters` 粗算 | `16 min + 720 chars` 约 `$0.1068` |

来源：

- 火山方舟模型价格: <https://www.volcengine.com/docs/82379/1544106>
- OpenAI API Pricing: <https://platform.openai.com/docs/pricing>
- OpenAI Audio API Reference: <https://platform.openai.com/docs/api-reference/audio/create>
- Anthropic Claude Pricing: <https://docs.anthropic.com/en/docs/about-claude/pricing>

### 7.4 托管、数据库与 CI

| 服务 | 官方价格口径 | 本文估算采用 |
| --- | --- | --- |
| Cloudflare Workers Free | `100,000` Worker requests/day；静态资源请求免费且无限 | 开发/低流量可视为单次成本 `0` |
| Cloudflare Workers Paid | `$5/月`，含 `10M` requests/月和 `30M` CPU ms/月；超出请求 `$0.30 / 1M`，CPU `$0.02 / 1M CPU ms` | 单次面试几十个动态请求，边际成本约等于 `0` |
| Supabase Free | `50,000` MAU、`500 MB` 数据库、`5 GB` egress、`1 GB` storage | 单次面试写入量很小，额度内成本 `0` |
| Supabase Pro | `$25/月`，含 `100,000` MAU、`8 GB` disk、`250 GB` egress；MAU 超额 `$0.00325 / MAU` | 生产项目可按固定月费摊销 |
| GitHub Actions | 公共仓库标准 runner 免费；私有仓库按计划有免费分钟，超额 Linux 2-core `$0.006/min` | 只影响部署，不计入用户单次使用 |

来源：

- Cloudflare Workers Pricing: <https://developers.cloudflare.com/workers/platform/pricing/>
- Supabase Pricing: <https://supabase.com/pricing>
- Supabase Billing Docs: <https://supabase.com/docs/guides/platform/billing-on-supabase>
- GitHub Actions Billing: <https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions>

## 8. “用一次软件”的成本模型

### 8.1 默认使用假设

为了让成本可计算，本文定义一次完整使用为：

- 面试难度：`medium`
- 最大轮次：8 轮
- 模式：普通模拟面试，不含额外咨询会话
- 创建面试时启用 AI Council 规划
- 每轮提交一次回答
- 生成最终报告
- 生成一次答案标注
- 简历和 JD 中等长度
- LLM 总用量估算：
  - 输入：约 `100,000 tokens`
  - 输出：约 `20,000 tokens`

这个 token 估算偏保守，原因是当前链路会多次调用 LLM：

- AI Council 面试计划：约 6 到 8 次 LLM 调用。
- 每轮回答：停止意图识别 1 次；未结束时还会做主题覆盖评估和下一题生成，约 2 次。
- 8 轮面试：约 8 次停止意图识别 + 7 轮下一题生成链路。
- 报告生成：1 次。
- 答案标注：1 次。

如果关闭 AI Council、关闭答案标注、缩短简历/JD 或减少轮次，成本会明显下降。

### 8.2 LLM 单次成本

按 `100k input + 20k output` 估算：

| 模型 | 计算 | 单次 LLM 成本 |
| --- | --- | --- |
| DeepSeek V4 Pro | `0.10M * $0.435 + 0.02M * $0.87` | `$0.0609` |
| DeepSeek V4 Flash | `0.10M * $0.14 + 0.02M * $0.28` | `$0.0196` |

说明：

- DeepSeek 的实际输入费用可能因 cache hit 下降，但本文按 cache miss 估算。
- 当前用户无法在前端选择 OpenAI、Anthropic 或豆包 LLM，因此这些模型不计入当前单次使用成本；如需对比，见 7.3 的非当前开放模型成本参考。
- 火山方舟上的 DeepSeek 价格与 DeepSeek 官方 API 价格不同。当前 `deepseek.ts` 使用的是 DeepSeek 官方 API，因此 DeepSeek 估算按 DeepSeek 官方价格。

### 8.3 语音单次成本

假设一次 8 轮面试：

- 候选人总回答音频：约 16 分钟。
- 实时 ASR 连接/计费音频：按 20 分钟估算。
- AI 问题 TTS 总字符：约 720 字符。

| 语音方案 | 计算 | 单次语音成本 |
| --- | --- | --- |
| 不用语音，只打字 | 无 ASR/TTS | `0` |
| 豆包录音转写 + 豆包 TTS | ASR `16/60*4.5` + TTS `720/10000*5` | `1.20 + 0.36 = 1.56 元` |
| 豆包实时 ASR + 豆包 TTS | ASR `20/60*4.5` + TTS `720/10000*5` | `1.50 + 0.36 = 1.86 元` |

说明：

- 语音成本通常比 LLM 成本更容易成为单次使用的大头，尤其是实时 ASR。
- 如果实际候选人回答时长只有 8 分钟，ASR 成本约减半；如果一场真实面试持续 45 分钟并持续开实时识别，ASR 成本会明显上升。
- 豆包语音资源包比后付费便宜，规模化后应优先买资源包。
- 当前用户无法在前端选择 OpenAI 语音，OpenAI transcription/TTS 仅作为非当前开放成本参考。

### 8.4 Cloudflare、Supabase、GitHub Actions 单次成本

一次面试大概包含：

- 页面和静态资源请求：Cloudflare Workers Assets，静态资源请求免费且不限量。
- 动态 API 请求：创建面试、8 次提交回答、状态查询、报告生成、标注、历史记录等，通常几十次。
- WebSocket：实时 ASR 建立连接时算 1 个 Worker request，消息本身不按 request 计数。
- Supabase：写入 1 个 session、若干 rounds、1 条 history、可选评分和记忆数据，通常不到几百 KB。

因此：

- 在 Cloudflare Free 和 Supabase Free 额度内，单次托管/数据库边际成本可视为 `0`。
- 在 Cloudflare Paid 计划内，单次请求/CPU 通常远低于 included quota，边际成本接近 `0`。
- Supabase Pro 的 `$25/月` 是固定月费，适合按月活或面试次数摊销，不建议直接算进单次边际成本。
- GitHub Actions 只在部署时运行，不随用户使用软件而运行，不计入单次使用。

## 9. 单次成本结论

### 9.1 当前标准路径：DeepSeek V4 Pro + 豆包语音

| 使用方式 | LLM 成本 | 语音成本 | 托管/数据库边际成本 | 单次合计 |
| --- | --- | --- | --- | --- |
| 文本面试 + 报告 + 标注 | `$0.0609` | `0` | 约 `0` | 约 `$0.061` |
| 录音转写 + TTS | `$0.0609` | `1.56 元` | 约 `0` | `$0.0609 + 1.56 元` |
| 实时 ASR + TTS | `$0.0609` | `1.86 元` | 约 `0` | `$0.0609 + 1.86 元` |

如果粗略按 `1 USD ≈ 7.1 RMB` 折算：

- 文本面试：约 `0.43 元/次`。
- 录音转写 + TTS：约 `1.99 元/次`。
- 实时 ASR + TTS：约 `2.29 元/次`。

这个结果说明：在当前架构下，一次完整面试的主要变量不是托管成本，而是语音时长和所选 LLM。

### 9.2 低成本路径：DeepSeek V4 Flash + 少用语音

| 使用方式 | 单次合计 |
| --- | --- |
| 纯文本，DeepSeek V4 Flash | 约 `$0.0196`，粗略折合约 `0.14 元` |
| 录音转写 + TTS，DeepSeek V4 Flash | 约 `$0.0196 + 1.56 元`，粗略折合约 `1.70 元` |
| 实时 ASR + TTS，DeepSeek V4 Flash | 约 `$0.0196 + 1.86 元`，粗略折合约 `2.00 元` |

### 9.3 非当前开放路径参考

下面这些路径当前不在前端开放给用户选择，只用于未来方案或横向对比。

| 使用方式 | 单次估算 |
| --- | --- |
| 豆包 1.5 Pro 32k 纯文本 | 约 `0.12 元` |
| 豆包 1.5 Pro 32k + 豆包录音转写/TTS | 约 `1.68 元` |
| 豆包 1.5 Pro 32k + 豆包实时 ASR/TTS | 约 `1.98 元` |
| OpenAI gpt-4o 纯文本 | 约 `$0.45` |
| OpenAI gpt-4o + OpenAI 转写/TTS | 约 `$0.45 + $0.1068 = $0.5568` |
| Claude Sonnet 4.5 纯文本 | 约 `$0.60` |

这些不是当前产品实际用户路径，不能作为当前单次成本结论。

## 10. 月度摊销示例

假设每月有 `N` 次完整面试：

| 月使用量 | DeepSeek Pro + 实时 ASR/TTS | DeepSeek Flash + 实时 ASR/TTS | 备注 |
| --- | --- | --- | --- |
| 100 次/月 | 约 `229 元` | 约 `200 元` | Cloudflare/Supabase Free 可能仍够用，取决于 MAU 和数据库大小 |
| 1,000 次/月 | 约 `2,290 元` | 约 `2,000 元` | 建议购买豆包语音资源包，并升级 Supabase/Cloudflare 生产计划 |
| 10,000 次/月 | 约 `22,900 元` | 约 `20,000 元` | 语音资源包、缓存和模型降级策略会成为关键 |

上表未把 Supabase Pro `$25/月`、Cloudflare Workers Paid `$5/月` 和 GitHub Actions 额外分钟数摊入，因为它们是固定平台成本。正式商业化时，可以按月使用量把固定成本摊进去：

```text
单次总成本 = 单次 API 边际成本 + (Cloudflare 月费 + Supabase 月费 + GitHub Actions 超额费用) / 月使用次数
```

如果 Cloudflare `$5/月` + Supabase Pro `$25/月`，固定平台成本约 `$30/月`。在 1,000 次/月时，固定摊销约 `$0.03/次`；在 100 次/月时，固定摊销约 `$0.30/次`。

## 11. 成本敏感点与优化建议

1. 优先控制 ASR 时长。
   - 实时 ASR 按小时计费，用户不说话时也可能产生连接/处理时长。建议只在用户回答阶段开启识别，问题播放或等待阶段关闭。

2. 提供“纯文本/低成本模式”。
   - 纯文本面试成本可以低到几毛人民币以内，适合免费试用或批量练习。

3. 把 AI Council 做成可选高级功能。
   - AI Council 创建计划时会多次调用 LLM，适合正式模拟或付费用户；普通练习可以使用 `generateSingleInterviewPlan`。

4. 答案标注按需生成。
   - 当前报告标注会额外调用一次 LLM。可以先展示报告，再由用户点击“生成逐句批改”触发。

5. 默认模型可按场景分层。
   - 免费/低成本：DeepSeek V4 Flash。
   - 标准：DeepSeek V4 Pro。
   - OpenAI、Anthropic、豆包 LLM 当前不在前端开放；如果未来开放，应单独更新模型选择、价格表和单次成本测算。

6. 语音资源包适合规模化。
   - 豆包语音后付费方便起步，但资源包的折算单价更低；如果月使用量超过数百小时，应按资源包重新测算。

7. 记录真实 usage。
   - 当前估算基于 token 和时长假设。建议在 LLM provider 层、ASR/TTS 层记录每次调用的输入 token、输出 token、音频秒数、TTS 字符数，后续可以做真实单次成本报表。

## 12. 最终判断

按当前代码和官方公开价格粗算：

- 当前前端开放的完整纯文本面试边际成本大约是 `0.14 元到 0.43 元/次`，取决于选择 DeepSeek Flash 还是 DeepSeek Pro。
- 当前标准路径 DeepSeek V4 Pro 文本面试约 `0.43 元/次`。
- 当前低成本路径 DeepSeek V4 Flash 文本面试约 `0.14 元/次`。
- 带豆包录音转写和豆包 TTS 后，当前路径约 `1.7 元到 2.0 元/次`。
- 带豆包实时 ASR 和豆包 TTS 后，当前路径约 `2.0 元到 2.3 元/次`。
- OpenAI、Anthropic、豆包 LLM、OpenAI 语音只作为非当前开放成本参考，不计入当前用户实际可用路径。
- Cloudflare Workers、Supabase、GitHub Actions 对单次使用的边际成本通常很低，真正要关注的是月度固定费用和额度上限。

因此，这个软件的单次成本主要由两部分决定：

1. LLM 模型选择。
2. 语音识别的实际时长。

如果目标是低成本大规模使用，建议默认使用 DeepSeek V4 Flash，语音默认采用“录音结束后转写”，把实时 ASR 作为高级体验开关。
