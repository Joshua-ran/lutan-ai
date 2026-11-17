# 路探 AI V1.2 · 源码交付说明

当前代码、说明与已有材料合并为可移动源码包，保留三个页面和 24 场景原始基线。五场景真实文字 API 已完成联调；新增三类普通规则分支的模型候选契约，详见 [真实 API 记录](LIVE_API_REPORT.md)。真实照片、在线天气及实钓效果尚未验收。

## 阅读顺序

| 角色 | 建议入口 |
| --- | --- |
| 演示与评审 | 根目录 `交付中心.html` → 当前界面 → [演示指南](DEMO_GUIDE.md) |
| 产品与设计 | [原始 PRD](../LutanAI_PRD_V1.0.md) → [V1.2 增量范围](V1.2_AGENT.md)；V1.0 原型只作历史参考 |
| 研发 | [README](../README.md) → [AI 工作流](AI_WORKFLOW.md) → `shared/`、`server/`、`src/` |
| 测试 | [评测方案](../LutanAI_Evaluation_Plan_V1.0.md)、原始 24 场景、`tests/` 与版本验证边界 |

根目录 HTML 和预渲染文档可离线阅读。当前 V1.2 页面通过本机 Node 服务运行；历史 V1.0 可点击原型独立放在手机壳中，标签不会把它当成当前实现。

## 包含与排除

包含 React/TypeScript/Express/Zod 源码、锁文件、运行与测试脚本、静态交付入口、预渲染文档、V1.2 空态截图、原始 PRD/原型/研究/24 场景材料，以及两个无密钥环境变量模板。

排除 node_modules、dist、缓存、浏览器测试产物、日志、旧 ZIP、releases、`.git` 和私有环境目录；只允许 `.env.example` 与 `.env.deepseek.example` 两个环境模板。实际 `.env` 和环境密钥不进入包。当前已有旧压缩包保留原处，不被覆盖或嵌套打包。

`RELEASE_MANIFEST.json` 记录逐文件 SHA-256、字节数、源码版本和交付边界；不记录本机绝对路径、密钥或浏览器记录。它证明文件一致性，不提供发布者签名。

## 本机运行

Windows 解压后双击 `Start-LutanAI.cmd`，或在终端执行：

```powershell
npm ci --cache .cache/npm --no-audit --no-fund
npm run doctor
npm run launch
```

Node.js 要求 22.12+。启动器仅在依赖未安装时执行 `npm ci`，每次重新构建当前源码；变更依赖后请主动重新执行 `npm ci`。默认生产入口是 `http://127.0.0.1:8787`。初次创建的 `.env` 关闭模型，规则可独立使用。配置自己的模型见 [演示指南](DEMO_GUIDE.md)；检查不会验证真实 API。

开发者继续使用 `npm run dev`，默认入口 5173。两种地址的本机历史记录独立，换地址前可导出备份。交付包不带原浏览器历史，不提供登录或云同步。

## 重新生成交付物

```powershell
npm run delivery
npm run release
```

交付脚本的安全回归可单独运行 `npm run test:delivery`，验证路径排除、密钥阻断和配置检查不发送推理请求。

`delivery` 使用构建时 Markdown 渲染器生成静态 HTML，没有浏览器运行时 Markdown 解析，也没有外链字体或样式依赖。`release` 先生成交付页，再按明确目录和扩展名清单选取文件，检查密钥与禁入路径、文档链接和资源，写入 `releases/` 中新的 ZIP；不会覆盖已有归档。

源码包需要再次安装依赖，不是免安装或全离线安装包。依赖下载缓存可供本机验证复用，但不随包分发。

## 验证口径

运行记录见 [V1.2 说明](V1.2_AGENT.md) 和 [交付验证记录](DELIVERY_VERIFICATION.md)。自动测试中的模型、天气与图片输入为模拟或合成数据；模拟工具测试执行了真实工具代码，但不等同供应商在线联调。

已知 P02 历史物种资料仍待接入，不能把 24 条全部记为通过。五场景真实文字推理记录已随文档保存；尚无真实图文与天气联调、真实用户反馈或渔获改善结果。

