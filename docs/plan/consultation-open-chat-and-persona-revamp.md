# 战略咨询重构方案

> 落地进度：
> - ✅ **阶段一（已实现）**：① 去张雪峰人格（→「资深战略咨询顾问」，新 `consultSkills.ts`）② 换音色为爽快思思 ③ 自由聊天窗口（记录可选，`/consult/start`）④ **按需检索的技能体系**（capability 技能 + `detectRecordAnalysisIntent` + `recordFetch` + message route）。`tsc` 通过、咨询相关单测通过。
> - ⏳ **阶段二（待做）**：§4 全人长期记忆与画像（domain 维度 / 两层时效 / 每场画像增量 + 时间线 / open_threads 主动回访 / 综合判断 / 记忆管理 UI）。需配套 DB 迁移；建议按本文件 §4 单独一轮落地（迁移免改可走 `metadata` JSONB）。
>
> 范围：① 去张雪峰人格 ② 换音色为爽快思思 ③ 改成自由聊天窗口（面试记录可选）④ 全人长期记忆与画像（**带上下文与存储规模控制**）。

## 0. 总目标
- 顾问从「张雪峰人格」改为**有温度、有专业经验、像过来人的资深职业战略顾问**；保留现有方法论 skills，去掉其身份/语气/个人经历。
- 咨询语音改为**爽快思思**（与面试官同款）。
- 咨询是一个**聊天窗口**：进来就能聊任何求职/人生困惑，**不必先选面试场次**；选了记录→有证据复盘，不选→凭专业经验陪聊。
- 长期记忆从「岗位画像」升级为**全人画像 + 情绪/陪聊**，且**每场都有新画像、长期能形成综合判断**；同时严格保证：**越用越准，但不越用越慢、不越用越乱**——注入大模型的内容固定大小、数据库活跃集有上限、每场计算量与历史长度无关。

---

## 1. 人格：去张雪峰 → 资深职业战略顾问

新人格：经验丰富、温和共情、务实、敢判断但对事不对人；**先做人再做顾问**（会共情、会陪聊、会记得用户说过的事），再给可执行建议。不假冒真人、不输出免责声明。

### 改动
**`lib/consultation/zhangxuefengSkills.ts` → 重命名 `lib/consultation/consultSkills.ts`**
- 重命名导出：`ZhangXuefengSkillId→ConsultSkillId`、`selectZhangXuefengSkills→selectConsultSkills`。
- 删除/替换带张雪峰身份的 skill：`style_dna→mentor_voice`（温和口语、结论前置、有温度、对事不对人）；`personal_origin_story`/`career_pivot_story`（张雪峰传记）→ 合并为 `peer_experience`（泛化过来人共情，**不引用任何真人生平**）；`controversy_temperance→tone_guard`（先肯定再点问题、不极端不攻击）；`health_pace_warning` 去掉指名。
- 保留并去味：`employment_reverse/median_case/family_constraint/choice_over_effort/social_filter/irreplacability_test/city_platform_lens/ai_era_lens/interview_issue_diagnosis/role_direction/practice_plan/follow_up_strategy`（逐条把残留口头禅/犀利反问改中性温和）。
- `BASE_SKILLS`：`style_dna→mentor_voice`、`controversy_temperance→tone_guard`。
- **技能注册表加 `kind: "method" | "capability"`**（见 §3A）：现有全部归 `method`；新增 `capability` 技能 `common_issues`/`single_review`/`direction_evidence`/`progress_tracking`，各带 `retrieval` 标记，命中即触发面试记录检索。`selectConsultSkills` 同时返回两类。

**`lib/consultation/langgraphAgent.ts`**：`consultSystemPrompt` 与三个子 prompt（opening/reply/summary）整体改写为新人格，删「张雪峰式」「连麦」字样；import 改 `consultSkills`。

**`lib/consultation/types.ts` / `store.ts`**：`mentorType: "zhang_xuefeng_style"→"career_strategist"`；store 读旧值一律按新人格（兼容历史会话）。

**`lib/prompts/consultation.ts`**：兜底文案换新顾问口吻。

---

## 2. 音色：爽快思思

**`components/ConsultChat.tsx`（`CONSULT_VOICE_SETTINGS`）**
```diff
-  voice: "S_N5saI8g02",
+  voice: GROUP_INTERVIEW_HOST_VOICE, // 爽快思思 zh_female_shuangkuaisisi_moon_bigtts
   autoPlay: true,
-  speedRatio: 0.88,
```
复用 `lib/voice/types.ts` 的 `GROUP_INTERVIEW_HOST_VOICE`；去掉为压张雪峰语速设的 `speedRatio`（落实时听一版定）。

---

## 3. 自由聊天窗口（面试记录可选）

- **首页**（`components/HomePageContent.tsx`）：主按钮「开始战略咨询」→ 新增 `app/consult/start/page.tsx`（进入即 `POST /api/consult/session`（空记录）→ `router.replace('/consult/{id}')`）；次按钮「结合面试记录复盘」→ 仍 `/summary`。
- **`/summary`**（`SummarySelection.tsx`）：降级为**可选的「焦点置顶」**入口——顶部加「不挑选，直接开聊」；允许 0 选；选了则作为本会话 pinned 焦点集（检索时优先用，见 §3A）。
- **创建 API**（`app/api/consult/session/route.ts`）：去掉「至少选一场」硬校验，允许空记录；空记录时 `goal="open_chat"`、`summaryMode="single_session"`。所选记录只存为小的 pinned 焦点 id 列表，不必持久化全量 records。
- **Prompt 证据规则**（`langgraphAgent.ts`）：**只有当 capability-skill 命中并检索到记录时**才引用岗位/分数/短板/原回答等证据；否则凭专业经验与全人记忆推进，**不假装有面试数据**；`buildOpeningPrompt` 无记录时生成温暖欢迎语、邀请聊任意话题。
- **聊天页**（`ConsultChat.tsx`）：默认不展示「已选面试记录」摘要（除非有 pinned 焦点），提示可随时让顾问「帮我复盘/找共性问题」。
- **`ConsultGoal`** 增加 `"open_chat"`，`selectConsultSkills` 对其走通用方法论组合。

---

## 3A. 智能体架构：按需检索的技能体系（核心）

把「共性问题总结、单场复盘、方向取证」等**需要面试数据的能力也做成 Skills**，由对话意图触发：用户说要做这些事 → AI 才去**检索面试记录**作答；用户没说 → 就顺着当前话题继续聊。**面试记录不再预先全量注入，而是「按需检索」**——这既实现了「聊天为主、复盘为辅」，也根治了上下文膨胀。

### 技能分两类（统一注册表）
- **method（方法/表达类，无需数据）**：现有方法论 + `mentor_voice`/`tone_guard`/`peer_experience`。始终可用，纯表达。
- **capability（能力类，需检索数据）**，每个声明 `retrieval` 来源：
  - `common_issues`（跨多场**共性问题**）
  - `single_review`（**单场复盘**）
  - `direction_evidence`（**方向判断**取证）
  - `progress_tracking`（多场**进步对比**）
  这些 capability-skill 命中时，触发检索节点拉面试记录。

### 每轮对话流程（确定性 LangGraph，复用现有 `langgraphAgent.ts`）
```
用户消息
 → [classify]  本轮意图 + 是否请求“基于面试记录的分析”（启发式关键词 + 1 次轻量 LLM 兜底）
 → [selectSkills]  selectConsultSkills 返回 method + capability 技能
 → [retrieve?]  若命中任一 capability-skill 才执行：
        按需拉取面试记录（用户点名的公司/岗位/时间 → 命中过滤；否则取最近 K=8 已完成记录，
        一对一 + 群面经适配器统一；只注入 recordsDigest 摘要，绝不注入原始逐字稿）
 → [respond]  生成回复 = 全人记忆 digest（恒定注入，见 §4） + 命中时的记录摘要（有上限）+ 所选技能 prompt
 → [persist]  落消息；（会话结束）记忆抽取/compaction（见 §4.5）
```

### 与「自由聊天」「规模控制」的关系
- 默认就是自由聊天；**没有触发 capability，就完全不碰面试数据**，上下文只含全人画像 digest。
- 触发时也**只拉最近 K 场、只注入摘要**，与历史总量无关 → 仍是定长上下文。
- `/summary` 的预选记录降级为「**焦点置顶（可选）**」：用户主动说「就复盘这几场」时预置一个小的 pinned 集；检索节点优先用 pinned，否则取最近 K。`ConsultSession` 不再需要持久化全量 records（减存储）；会话结束的记忆抽取基于**对话本身**（AI 已把证据落在对话里）。

### 可扩展性
新增能力 = 在注册表加一个 capability-skill + 一个 retrieval 源（如未来「简历库」「行业数据」），**图结构不变**；意图分类与检索节点天然复用。

---

## 4. 全人长期记忆与画像（核心）

### 4.0 设计基线（先定规模，再谈功能）
**硬约束：注入 LLM 的记忆永远是「固定大小」，DB 活跃集有上限，每场计算量 O(1)（只处理当场）。** 记忆总量可以无限增长，但「活跃 + 注入」的部分恒定。靠三招实现：**紧凑画像（1 行、定长）+ 按需 top-K 检索 + 情景层衰减归档**。

### 4.1 数据模型：加「领域」维度（扩展不重写）
在现有 `user_memory_items` 条目与记忆图谱节点上加 `domain`（开放可扩展）：
`career`（现有岗位内容，默认值）、`personality`、`values`、`life_context`、`emotion`、`interest`、`aspiration`、`relationship`、`rapport`（与顾问的相处偏好：要鼓励还是直说、敏感话题、玩笑梗）。
节点类型只新增少量通用项（`trait/value/state/interest/bond`），其余复用现有；career 节点 domain 默认 `career`，**向后兼容**。

两层时效：
- **稳定层**（慢变）：personality/values/life_context/aspiration/rapport。
- **情景层**（快变，**带半衰期**）：emotion/近期事件/本周纠结。节点加 `volatility`+复用 `lastSeenAt`；emotion 类半衰期 ~14 天，超期或被取代 → `status='archived'`。

### 4.2 存储与规模控制（防止越用越慢/越乱）
- **写时去重合并**（已有图谱增量合并）：语义相同的复用旧节点，不新建；冲突用 `conflicts_with`/`superseded`（如「以前想去大厂，现在想稳定」）。
- **活跃集封顶**：每 domain 活跃节点 ≤ 12（career ≤ 16）；全局活跃节点硬上限 ≤ 80。**溢出按 `weight×recency` 最低者归档**（archived，不删，可回捞）。
- **情景层衰减**：定时（或每场写入时顺带）把过期 emotion/event 归档。
- **加载只查活跃**：所有读路径 `where status='active'` 且走索引（`(owner_id, profile_id, status, domain)` + `last_seen_at`）。**永不**为单轮对话加载全量历史条目。
- 结论：DB 行数随时间增长，但**单次查询/注入成本与历史长度无关**。

### 4.3 上下文预算（注入大模型的固定大小）
每轮只注入三块，合计硬上限（建议 ≤ ~1.5k tokens）：
1. **紧凑全人画像 digest**（来自下方 4.4 的定长画像，≤ ~900 tokens）：TA 是谁、在意什么、当前状态/情绪、相处偏好（rapport）、未收尾的牵挂。
2. **本轮 top-K 相关记忆**（K=8，每条 1 行）：用**非 LLM 的打分器**（当前消息的 tag/关键词命中 + recency + weight）从活跃集里选，复用 `memorySelector.ts`。
3. **open_threads ≤ 3**（见 4.6）。
会话内消息也保持现有「仅最近 N 轮」（`messagesDigest` slice）——同样定长。

### 4.4 紧凑全人画像（1 行、定长、随每场 compaction 更新）
扩展 `ConsultMemoryProfile`（仍是单行）为全人版，**每个字段限长**：
- `compactSummary`（≤ ~500 字的人物速写）、各 domain 一句话（≤ ~120 字/domain）、`stableTraits[≤8]`、`coreValues[≤6]`、`lifeContext[≤6]`、`currentState`（情绪/近况，1-2 句，会被新场覆盖）、`rapportPrefs[≤5]`、`openThreads[≤5]`、`careerView`（沿用现有岗位字段）。
- 这是**唯一始终加载、且大小恒定**的画像；细节都沉到 items/graph，按需检索。

### 4.5 每场写入管线（固定 2 次 LLM，与历史无关）
会话结束（已有 stop→summary）后：
1. **抽取**（1 次 LLM，仅本场消息，截断到最近 N 轮）：产出带 `domain` 的记忆条目 drafts + 一份**本场画像增量（delta）**：新增/更新的稳定画像、情景快照（当前情绪/发生了什么/这场想要什么）、一句「这场在 TA 人生里的位置」。
2. **合并**：drafts 增量并入 items + 图谱（去重/合并/冲突/封顶，见 4.2）。
3. **compaction**（1 次 LLM）：把 delta 折叠进 4.4 的定长画像（同时把被挤出的细节留在 items）。**综合判断不另起膨胀流程**——它就是 compaction 维护的 `compactSummary`/各 domain 叙事，自然长期收敛。

### 4.6 每场画像增量 + 时间线 + 主动回访（陪聊与情绪价值）
- delta 追加到一条 **timeline**（`consult_profile_timeline`：每行一场的快照摘要，定长字符串），可回看演化。
- **结束页向用户展示「本场我新认识你的几点」**（透明 + 正是「每场都有新画像」的体感）。
- `openThreads`（未收尾的牵挂）→ 下次 `buildOpeningPrompt` **主动回访**：「上次你说…后来怎么样了？」。回访可在记忆设置里开关。

### 4.7 隐私（默认存、可控）
- **默认存**（含情绪/家庭等），但每条带来源+置信度，`status` 支持 `user_removed`；补一个**记忆管理 UI**（查看/删除、敏感话题不再存、情景层默认更短留存）。

### 4.8 不破坏的既有能力
长期记忆框架、图谱增量合并、技能选择、群面记录接入、历史会话回放全部保留；本次是**加 domain + 全人画像 + 预算/衰减**，不是重写。

---

## 5. 逐文件改动清单

| 文件 | 改动 |
|---|---|
| `lib/consultation/zhangxuefengSkills.ts`→`consultSkills.ts` | 去张雪峰、保留方法论、改名导出、BASE_SKILLS 更新；加 `kind:method/capability` + capability 技能（common_issues 等）与 retrieval 标记 |
| `lib/consultation/langgraphAgent.ts` | 新人格 prompt；**每轮图：意图分类→选技能→按需检索记录→生成**；证据规则改为「命中 capability 且检索到才引用」；空记录开场；注入「全人 digest + topK + openThreads」；主动回访；import 改名 |
| `app/api/consult/[id]/message/route.ts`（检索） | capability 命中时按需拉取最近 K 场记录（一对一+群面，优先 pinned 焦点），只传摘要给 agent |
| `lib/consultation/types.ts` | `mentorType` 新值；`ConsultGoal` 加 `open_chat`；画像/条目加 `domain`、`volatility`、`openThreads`、timeline 类型 |
| `lib/consultation/store.ts` | mentorType 兼容；空记录会话；timeline 读写 |
| `lib/consultation/memoryItems.ts` | 抽取加 `domain`、开放话题打标；写入封顶/去重 |
| `lib/consultation/memoryGraph.ts` | 节点加 `domain`+通用类型；合并 prompt 扩 whole-person；活跃集封顶+情景衰减归档 |
| `lib/consultation/memoryProfile.ts` | compaction 扩为定长全人画像 + delta 折叠（即综合判断） |
| `lib/consultation/memory.ts` | snapshot/digest 改为定长全人 digest（含预算裁剪） |
| `lib/consultation/memorySelector.ts` | top-K 非 LLM 打分检索（tag/关键词+recency+weight），输出硬上限 |
| `lib/prompts/consultation.ts` | 兜底文案换新口吻 |
| `components/ConsultChat.tsx` | 音色爽快思思；空记录 UI；结束页「本场新认识你」展示 |
| `components/SummarySelection.tsx` | 「不挑选直接开聊」、允许 0 选 |
| `components/HomePageContent.tsx` | 主按钮直达聊天、次按钮去 /summary、文案 |
| `app/consult/start/page.tsx`（新增） | 创建空记录会话并跳转 |
| `app/api/consult/session/route.ts` | 放开空记录、open_chat |
| 记忆管理 UI（新增，轻量） | 查看/删除记忆、敏感开关、回访开关 |
| `lib/i18n.ts` | 入口/记忆相关新文案 |

## 6. DB 迁移
- `user_memory_items` / 图谱节点表：加 `domain TEXT`（默认 `'career'`）、`volatility TEXT`（`stable`/`episodic`）；索引 `(owner_id, profile_id, status, domain)`、`last_seen_at`。
- `consult_memory_profiles`：加全人画像字段（或一个 `whole_person JSONB`）。
- 新表 `consult_profile_timeline`（owner_id, profile_id, session_id, snapshot 摘要, created_at）。
- 旧数据：`domain` 回填 `'career'`，向后兼容。

## 7. 验证
1. `npx tsc --noEmit` 通过。
2. 端到端：首页「开始战略咨询」→ 直接进聊天（爽快思思音色、温和过来人语气）；随便聊「最近压力大/要不要考研/投产品还是运营」均正常、**不触碰面试数据**；**结束页出现「本场我新认识你的几点」**；再开一场，开场能**主动回访上次的牵挂**。
3. **按需检索**：在聊天里说「帮我把最近几场面试的共性问题找出来」「复盘我上一场」→ AI 自动检索记录给出有证据的分析；用户没提则继续顺着话题聊。
4. 「结合面试记录复盘」→ /summary 选记录（含群面）作为 pinned 焦点 → 检索优先用焦点集。
5. **规模/性能**：构造多场历史后，验证单轮注入大小恒定（活跃集封顶生效、情景层已归档）、对话加载不变慢；记忆管理 UI 可删除/关回访。
6. 回归：历史咨询会话回放、群面接入正常；全程无张雪峰痕迹。
