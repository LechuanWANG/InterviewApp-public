# 代面 Daimian

`代面 Daimian` 是一款面向校招、实习、转岗和早期职场求职者的 AI 求职训练产品。它不是单次问答式的模拟面试工具，而是把“面试前设计、一对一追问、智能群面、面试后报告、长期战略咨询和记忆画像”串成一个闭环，帮助用户持续提升岗位匹配度、表达质量、群面协作能力和求职决策能力。

## 链接

| 类型 | 链接 |
| --- | --- |
| 应用 | <https://www.daimian.top/> |
| 介绍页 | <https://panos-pang.github.io/InterviewAgent-materials/> |
| 介绍视频 | <https://www.xiaohongshu.com/explore/6a2fc0fc000000001c0254c8?xsec_token=ABcxz0rBZP5BUzmL9LfWm3oEgfkw3zgCFo6q6aae73Zwo=&xsec_source=pc_user> |
| 英文 Demo | <https://www.linkedin.com/feed/update/urn:li:activity:7464902667304218627/> |

## 产品亮点

- **面试编排 Harness 控制过程**：在模型外层管理上下文、面试状态、主题覆盖、追问规则、结果校验和兜底，避免随机提问、重复追问或无效循环。
- **AI 智囊团先设计面试**：正式面试前由 JD 解构官、简历深挖官、策略官、风险质疑官和主持人共同生成面试路线图，让问题围绕岗位和简历展开。
- **自适应一对一面试官**：根据用户回答质量、已覆盖主题、剩余轮次和难度上限，动态决定继续追问、切换主题或结束面试。
- **智能群面训练**：用户与 4 名不同人格、背景和音色的 AI 同学完成无领导小组讨论，练习抢答、承接、反驳、总结、控场和汇报。
- **证据化报告复盘**：报告不只给分数，还将评价落到逐轮回答和原话片段，提供维度评分、智能批注、推荐回答和下一步训练建议。
- **长期战略咨询与记忆**：面试和咨询记录会沉淀为结构化记忆和 compact profile，让后续咨询能围绕用户长期目标、反复短板和已解决问题继续跟进。
- **SaaS 化闭环**：已覆盖登录、用户级数据隔离、历史记录、报告保存、咨询记录、体验评分、线上部署和多模型配置。

## 核心体验

```text
填写简历 / JD / 岗位目标
  -> AI 智囊团生成面试计划或群面题目
  -> 一对一模拟面试 / 智能群面训练
  -> 语音或文本作答，系统动态追问和调度
  -> 生成结构化报告和逐轮证据批注
  -> 保存历史记录
  -> 进入战略咨询，形成长期记忆和下一轮训练计划
```

## 功能模块

| 模块 | 能力 |
| --- | --- |
| 首页与用户系统 | 面试训练与战略咨询入口、中英文 UI、登录态识别、用户级数据隔离 |
| 面试创建 | 公司、岗位、JD、简历、补充背景、难度、模式、模型和语音配置 |
| AI Council | 多角色审阅 JD 与简历，输出主题优先级、开场问题、风险点和面试策略 |
| 一对一面试 | 模拟模式、练习模式、语音朗读、语音识别、动态追问、主题切换和结束判断 |
| 智能群面 | HR 开场、读题、个人陈述、自由讨论、共识收口、推选汇报、代表汇报 |
| AI 报告 | 综合评分、维度评分、逐轮点评、答案批注、推荐回答、行为倾向分析 |
| 战略咨询 | 基于历史面试、群面记录、当前问题和长期记忆输出求职诊断与行动建议 |
| 记忆系统 | 结构化记忆条目、长期画像、记忆图谱、上下文压缩和相关证据召回 |
| 体验反馈 | 面试和咨询体验评分，为后续产品优化提供反馈闭环 |

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Web | Next.js 14, React 18, Tailwind CSS |
| LLM / 编排 | LangGraph, DeepSeek, OpenAI, Anthropic, Doubao |
| Voice | Doubao ASR, Doubao TTS, Web Audio |
| Data | Supabase Auth, Supabase Postgres |
| Runtime / Deploy | Cloudflare Workers, OpenNext, Vercel config |
| Testing | TypeScript, Node test runner |

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

常用脚本：

```bash
npm run dev          # 启动本地开发服务
npm run build        # Next.js 构建
npm run test         # TypeScript 编译测试与 node:test
npm run cf:build     # OpenNext Cloudflare 构建
npm run cf:preview   # Cloudflare 本地预览
npm run cf:deploy    # 部署到 Cloudflare
```

## 环境变量

项目使用 `.env.local` 管理本地密钥，公开仓库中只保留 `.env.example`。核心变量包括：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_COOKIE_SECRET`
- `DEEPSEEK_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `DOUBAO_*`

## 项目结构

```text
app/          Next.js App Router 页面和 API routes
components/   产品 UI 组件
lib/          Agent、报告、语音、存储、认证和模型适配逻辑
supabase/     数据库 schema 与迁移 SQL
scripts/      Demo 生成、数据同步和维护脚本
tests/        关键业务逻辑测试
docs/         产品、技术、计划和答辩材料
public/       静态资源与 README banner
```

## 适合展示的价值

代面展示的是一个 AI 求职训练产品从“模型调用”走向“可运行 SaaS”的完整落地过程：前面有可解释的面试设计，中间有状态化面试和群面交互，后面有结构化报告、长期记忆和战略咨询闭环。它的重点不是单个 prompt，而是把大模型能力放进可控、可复盘、可持续使用的产品流程里。
