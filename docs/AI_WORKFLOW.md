# 路探 AI · 第一阶段 AI 辅助工作流

> 本文描述原表单诊断的 V1.1 候选工作流。V1.2 已复用其传输、配置和预算，新增独立 Agent 端点，详见 [V1.2 图文助手](V1.2_AGENT.md)。两条路径的生成范围与来源分别标注。

实现版本 V1.1.0；规则版本仍为 `lutan-rules-1.0.0`，工作流版本为 `lutan-workflow-1.1.0`。原始三个入口、已有交互和 24 场景基线保留。本轮不接入天气、水位、物种资料，也不引入多 Agent。

## 调用链与文件

```text
App.generate → src/lib/api.ts → POST /api/diagnoses
  → diagnosisInputSchema → server/diagnosis-service.ts
  → shared/engine.ts：先生成完整规则结果与风险
  ├ 危险 / 禁钓 / 合法性未知：直接规则结果，零模型调用
  ├ 无配置 / 限流 / 预算 / 并发限制：规则回退
  └ 普通且用户自述已核实允许
      → server/llm/grounding.ts：脱敏与可信候选
      → server/llm/adapter.ts：模型 HTTP 调用、超时、大小上限
      → Zod + 引用约束校验 → 服务端渲染 → diagnosisSchema
      └ 任意失败：同一次请求返回原有规则结果

前端 API 离线 → 相同版本本机规则 → 反馈 → 本机快照 / JSON
```

| 文件                                   | 职责                                             |
| -------------------------------------- | ------------------------------------------------ |
| `server/llm/config.ts`、`.env.example` | 环境配置与非敏感能力信息                         |
| `server/llm/grounding.ts`              | 输入白名单、候选动作/依据/未知项、结构化输出约束 |
| `server/llm/adapter.ts`                | Chat Completions 兼容 HTTP 调用与校验            |
| `server/diagnosis-service.ts`          | 风险门控、调用预算、并发限制、失败回退、匿名事件 |
| `server/app.ts`、`server/index.ts`     | 接口接入、请求取消、服务端 `.env` 读取           |
| `shared/schema.ts`、`shared/engine.ts` | 模式、版本、模型展示名、输出边界、旧数据归一化   |
| `shared/presentation.ts`、页面文件     | 来源与用户可理解的回退提示                       |
| `src/lib/api.ts`、`src/lib/records.ts` | 本机降级、V1 → V2 兼容与导出                     |

其余修改包括 `package.json` / `package-lock.json` 的版本及开发启动命令、README 与实现说明；新增 `tests/llm.test.ts`、`tests/llm-api.test.ts`、`tests/e2e/ai.spec.ts`、`tests/e2e/fixtures.ts`，补充 `tests/api.test.ts`、`tests/records.test.ts` 和 `tests/e2e/app.spec.ts`。没有修改原始 PRD、研究素材、HTML 原型或 24 场景 JSON。

## 为什么限制生成范围

本轮采用**模型结构化选择 + 服务端可信文案渲染**，而非通过正则猜测一段自由文本是否存在幻觉。

模型只能返回 `action_id`、`rationale_ids`、`unknown_ids`、`follow_up_question_id` 和 `evidence_status`。动作候选沿用同一规则方向，只允许单变量比较。依据来自实际用户输入与现有规则，结构、水色和目标选择被表述为观察条件或计划目标，不新增鱼类生态知识。模型可选择解释重点，不能生成新的事实。

服务端要求保留规则依据、全部未知边界及规则必要追问，拒绝重复/伪造引用、额外字段、多个追问、证据状态升级、截断、拒答、工具调用和非 JSON 输出。风险级别、输入快照、规则 ID、规则版本、合法性提醒与未知事实由服务端保留。只有校验完成才标记为 `server_llm`。

该方式保证展示内容来自已有可信候选，**不代表候选已获渔业专业验证，也不代表模型新增了科学知识或提高实际渔获**。需要自由文本解释时，应另设证据与人工审核机制，不能直接放开当前 Schema。

## 配置

服务启动时仅在 `server/index.ts` 读取项目根目录 `.env`。默认 `LLM_ENABLED=false`，无密钥时规则模式完整可用。配置变更后重启服务。

开发接口使用 Node 内置 `--watch` 配合 `--import tsx`，生产使用编译后的 Node 入口。本轮在 Windows 上验证了两种入口，避免旧 `tsx watch` 启动后未监听接口的问题。

| 变量                      | 默认                        | 说明                                                                                       |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `LLM_ENABLED`             | `false`                     | 显式开启可选调用                                                                           |
| `LLM_BASE_URL`            | `https://api.openai.com/v1` | API 根地址，系统追加 `/chat/completions`；HTTPS，或本机回环 HTTP；不接受地址内凭据与查询串 |
| `LLM_API_KEY`             | 空                          | 仅在服务端鉴权头使用；不发送给前端                                                         |
| `LLM_MODEL`               | 空                          | 实际供应商模型 ID，不默认回显                                                              |
| `LLM_MODEL_LABEL`         | `configured-model`          | 非敏感展示名，限字母、数字、点、下划线与短横线，最长 64 字符                               |
| `LLM_TIMEOUT_MS`          | `2500`                      | 100–60000 ms；通用默认 2500 ms，DeepSeek 默认 20000 ms，诊断前端等待上限 65000 ms                               |
| `LLM_MAX_OUTPUT_TOKENS`   | `384`                       | 128–1024；单次生成上限，包含供应商计入该参数的推理/输出额度                                |
| `LLM_REQUESTS_PER_MINUTE` | `20`                        | 当前服务进程每分钟最多发起次数                                                             |
| `LLM_DAILY_REQUEST_LIMIT` | `100`                       | 当前服务进程滚动 24 小时最多发起次数；失败请求也计数                                       |
| `LLM_MAX_CONCURRENCY`     | `2`                         | 1–4；超限立即返回规则，无排队                                                              |
| `LLM_RESPONSE_FORMAT`     | `json_schema`               | 供应商不支持时手动改 `json_object`，两者接受相同本地校验                                   |
| `LLM_TOKEN_PARAMETER`     | `max_completion_tokens`     | 可按供应商支持情况改 `max_tokens`                                                          |
| `LLM_LOG_EVENTS`          | `false`                     | 可选匿名过程事件，不记录用户输入或模型原文                                                 |

供应商必须兼容 Chat Completions 协议，返回 `choices[0].message.content` 与 `finish_reason: stop`。不支持的协议、模型权限或参数会回退规则，不自动重试、不自动切换供应商。真实供应商模型是否支持这些选项，需要在自己的账号下验证。

健康接口 `capabilities.llm` 表示配置通过并启用，不表示上游已连通；`llm.connection_verified: false` 明确健康检查没有发起付费联通测试。前端只收到配置状态和非敏感展示名，不会收到 API 地址或密钥。V1.2 可在结果快照中保留供应商返回的模型标识和耗时。

请求数、输出上限与并发限制用于控制调用开销，不代表固定金额上限。计数在当前进程内，重启会重置，多实例不共享；正式公开前应结合供应商账户配额与共享配额服务。正文最多读取 16 KB，不接受自动重定向，不重试。浏览器取消请求会中止上游；取消/超时前供应商已产生的费用仍可能发生。

## 隐私与记录兼容

前端继续去除水域备注。模型侧再次用明确白名单构造输入，不发送昵称、反馈备注、坐标、IP、内部记录 ID、时间戳、环境变量或其他自由文本。即使直接调用 API 并填写昵称，该昵称也不进入模型请求。

匿名事件仅含 `event`、`rule_id`、`mode`、`fallback_reason`、`duration_ms`，默认关闭；上游错误原文不会返回页面或进入日志。密钥只在服务端 `Authorization` 头中使用，`.env` 已由 `.gitignore` 排除。不要将真实密钥命名为 `VITE_` 变量。

本机存储键仍为 `lutan_records_v1`，避免用户记录失联。读取接受 V1/V2，旧记录缺少的生成元数据归一化为规则模式、`model: null`、`workflow_version: legacy-v1`，不补造历史模型信息。读取不改写原始数据；后续成功保存或删除时原子写入 V2，导出使用 V2。格式损坏和未来未知版本仍明确报错并保留原文。

每条新快照保存模式、来源、规则版本、工作流版本、非敏感模型展示名、回退原因和输出边界；不保存原始上游响应。原型 HTML 的旧存储键仍保留，不自动猜测字段迁移。

## 验证与未验证范围

执行 `npm run typecheck`、`npm test`、`npm run evaluate`、`npm run test:e2e` 与 `npm run build`。单元/接口测试使用可控响应；新增浏览器测试经本机 HTTP 模拟供应商进入实际适配器与页面，包括正常 AI 来源、超时、无效输出、危险门控以及旧记录读取和导出。

这些测试不调用真实付费模型。浏览器常规用例通过隔离的规则服务，AI 用例通过本机模拟供应商，即使开发 `.env` 已启用自己的模型也不借用其额度。未配置真实供应商凭据时，不报告真实模型联通、输出质量、真实钓友反馈或渔获改善。24 条基线仍为人工场景，P02 历史鱼种库未实现，继续待复核。

协议参考：[OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat)、[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)、[Node.js loadEnvFile](https://nodejs.org/api/process.html#processloadenvfilepath)。

