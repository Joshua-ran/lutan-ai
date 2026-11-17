import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Marked } from "marked";
import { root, pkg } from "./local-runtime.mjs";

const slash = (s) => s.split(path.sep).join("/");
const escape = (s) => String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const relative = (from, to) => slash(path.relative(path.dirname(from), to));
const docs = readdirSync(root).filter((name) => name.endsWith(".md"));
function findMarkdown(directory) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) findMarkdown(name);
    else if (entry.isFile() && name.endsWith(".md")) docs.push(name);
  }
}
findMarkdown("docs");
const targets = new Map(docs.map((name) => [name, `delivery/文档/${name.replace(/\.md$/, ".html")}`]));
const titleOf = (source) => source.match(/^#\s+(.+)$/m)?.[1] || "路探 AI 文档";

function page(title, content, output, extra = "") {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · 路探 AI</title><link rel="stylesheet" href="${relative(output, "delivery/assets/delivery.css")}"></head><body ${extra}>${content}</body></html>`;
}

export function buildDelivery() {
  mkdirSync(path.join(root, "delivery/assets"), { recursive: true });
  for (const asset of ["v1.2-desktop.png", "v1.2-mobile.png", "delivery.css"]) {
    if (!existsSync(path.join(root, "delivery/assets", asset))) throw new Error(`缺少交付资产：${asset}`);
  }
  for (const source of docs) {
    const text = readFileSync(path.join(root, source), "utf8");
    if (/```mermaid/.test(text)) throw new Error(`文档需要本地 Mermaid 渲染资源：${source}`);
    const output = targets.get(source);
    const ids = new Map();
    const renderer = new Marked({ gfm: true, renderer: {
      heading({ tokens, depth }) {
        const label = this.parser.parseInline(tokens);
        const base = label.replace(/<[^>]*>/g, "").toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-|-$/g, "") || "section";
        const count = ids.get(base) || 0;
        ids.set(base, count + 1);
        return `<h${depth} id="${escape(base + (count ? `-${count}` : ""))}">${label}</h${depth}>\n`;
      },
    } });
    let html = renderer.parse(text);
    html = html.replace(/(href|src)="([^"]*)"/g, (_all, attr, raw) => {
      if (!raw || raw.startsWith("#") || /^(?:https?:|mailto:|data:)/i.test(raw)) return `${attr}="${raw}"`;
      if (/^[a-z]+:|^[/\\]/i.test(raw)) throw new Error(`文档存在不可移动链接：${source}`);
      const split = raw.search(/[?#]/);
      const link = split < 0 ? raw : raw.slice(0, split);
      const suffix = split < 0 ? "" : raw.slice(split);
      const resolved = slash(path.normalize(path.join(path.dirname(source), decodeURIComponent(link))));
      let mapped = targets.get(resolved) || resolved;
      if (resolved === "LutanAI_Prototype_V1.0.html") mapped = "delivery/demo/demo.html";
      return `${attr}="${escape(relative(output, mapped))}${suffix}"`;
    });
    const title = titleOf(text);
    const content = `<header class="doc-nav"><a href="${relative(output, "交付中心.html")}">← 交付中心</a><span>V${pkg.version} · 文档阅读</span><a href="${escape(relative(output, source))}">原始 Markdown</a></header><main class="document"><p class="source-label">源文件：${escape(source)}</p>${html}</main>`;
    mkdirSync(path.dirname(path.join(root, output)), { recursive: true });
    writeFileSync(path.join(root, output), page(title, content, output));
  }
  const docLink = (source) => targets.get(source);
  const card = (tag, title, text, href, label, source) => `<article class="card"><span class="eyebrow">${tag}</span><h3>${title}</h3><p>${text}</p><a class="card-link" href="${href}">${label} <span aria-hidden="true">↗</span></a><small>${source}</small></article>`;
  const main = `<header class="topbar"><a class="brand" href="交付中心.html"><span class="brand-mark">路</span>路探 AI <span class="version">V${pkg.version}</span></a><span class="muted">源码与产品材料 · 本机交付</span></header>
  <main class="hub"><section class="intro"><p class="eyebrow">DELIVERY / 2026.11</p><h1>从这里打开路探 AI。</h1><p class="lead">查看当前界面、运行 V1.2 应用，或沿着文档理解规则、模型与已知边界。</p><div class="tags"><span>三个页面完整保留</span><span>安全与合法性优先</span><span>五场景真实文字 API 已验证</span></div></section>
  <section class="run-panel" aria-labelledby="run-title"><div><span class="eyebrow">01 / 本机体验</span><h2 id="run-title">运行当前 V1.2 应用</h2><p>解压源码包，安装 Node.js 22.12+，双击根目录 <code>Start-LutanAI.cmd</code>。首次安装依赖需要联网，随后自动构建并打开浏览器。</p><p class="muted">默认新配置关闭模型。已有配置与环境变量优先；此页面不检测或调用你的 API。</p><div class="actions"><a class="button" href="${docLink("docs/DEMO_GUIDE.md")}">阅读演示与配置步骤</a><a class="button secondary" href="http://127.0.0.1:8787" target="_blank" rel="noopener">打开已启动的应用 ↗</a></div></div><aside><strong>双击可看</strong><p>本页、文档与历史原型可离线浏览。</p><strong>服务启动后可用</strong><p>V1.2 真实页面、API 与本机记录。默认地址：127.0.0.1:8787。</p><a href="Start-LutanAI.cmd">定位 Windows 启动文件</a><small>浏览器可能下载或询问；推荐在解压目录直接双击。</small></aside></section>
  <section class="section"><div class="section-heading"><div><p class="eyebrow">02 / 演示与评审</p><h2>先看当前，再看历史。</h2></div><p>适合演示者、产品与设计</p></div><div class="preview-grid"><figure><a href="delivery/assets/v1.2-desktop.png"><img src="delivery/assets/v1.2-desktop.png" alt="V1.2 桌面现场助手初始界面" width="1440" height="1000"></a><figcaption>V1.2 当前空态截图 · 无模型结果或天气样例</figcaption></figure><div class="preview-text"><h3>图文助手与原表单共存</h3><p>文字与可选图片、有限工具调用、连续反馈会话已实现。配置、输出校验或服务失败时回到规则。</p><a href="delivery/assets/v1.2-mobile.png">查看当前手机截图 ↗</a><hr><span class="pill">历史参考 / V1.0</span><h3>可点击的原型演示</h3><p>保留原始三个页面，用手机壳维持移动视口。它早于 V1.2，不展示当前模型能力。</p><a class="card-link" href="delivery/demo/demo.html">打开历史原型手机演示 ↗</a></div></div></section>
  <section class="section"><div class="section-heading"><div><p class="eyebrow">03 / 需求定义</p><h2>产品依据与范围</h2></div><p>适合产品、设计与评审</p></div><div class="cards">${card("当前范围", "V1.2 增量说明", "了解图文、会话、工具调用和事实边界，区分模拟验证与真实联调。", docLink("docs/V1.2_AGENT.md"), "阅读当前实现", "docs/V1.2_AGENT.md")}${card("原始需求", "V1.0 PRD", "保留原始问题、页面与规则需求。当前实现状态以版本说明为准。", docLink("LutanAI_PRD_V1.0.md"), "阅读产品基线", "LutanAI_PRD_V1.0.md")}${card("需求证据", "公开二手研究", "研究材料只用于需求发现，不作为实时鱼情、许可或生态结论。", docLink("LutanAI_Secondary_Research.md"), "阅读研究与来源", "LutanAI_Secondary_Research.md")}</div></section>
  <section class="section"><div class="section-heading"><div><p class="eyebrow">04 / 研发交付</p><h2>接手、验证与继续开发</h2></div><p>适合研发与测试</p></div><div class="cards">${card("启动与源码", "交付说明", "源码组织、解压启动、重新打包方式与历史记录的来源限制。", docLink("docs/DELIVERY.md"), "查看交接说明", "docs/DELIVERY.md · README.md")}${card("规则与模型", "AI 工作流", "服务端配置、严格 Schema、超时配额、隐私与回退机制。", docLink("docs/AI_WORKFLOW.md"), "查看接口与配置", "docs/AI_WORKFLOW.md")}${card("真实执行记录", "测试与评测边界", "查看本轮检查与已知待复核项。测试响应为模拟数据，不等于真实模型效果。", docLink("docs/DELIVERY_VERIFICATION.md"), "阅读验证记录", "docs/DELIVERY_VERIFICATION.md")}</div><div class="resource-row"><a href="${docLink("docs/FOLLOWUP_FIX.md")}">连续追问与真实四轮验证</a><a href="${docLink("docs/USABILITY_FIX.md")}">首次使用与许可提示修复</a><a href="${docLink("docs/LIVE_API_REPORT.md")}">真实 API 五场景与原始输出</a><a href="${docLink("README.md")}">工程 README</a><a href="${docLink("LutanAI_Evaluation_Plan_V1.0.md")}">评测方案</a><a href="LutanAI_Evaluation_24cases_V1.0.json">24 场景原始 JSON</a><a href="LutanAI_Public_Cases_13.json">公开案例索引</a><a href="${docLink("docs/IMPLEMENTATION.md")}">早期实现基线</a><a href="${docLink("LutanAI_Portfolio_Guide.md")}">原型阶段展示指南</a><a href=".env.deepseek.example">DeepSeek 无密钥模板</a></div></section>
  <footer><strong>交付边界</strong><p>五个合成场景的真实 DeepSeek 文字 API 已通过本轮检查，首轮问题与修复结果均有原始记录。真实照片、在线天气、真实用户和鱼获效果尚未验收。P02 历史物种资料仍待接入，安全或许可未知时规则优先。</p><p class="muted">本地文件全部使用相对路径；外部 API 文档和已启动应用的地址需要相应网络或本机服务。</p></footer></main>`;
  writeFileSync(path.join(root, "交付中心.html"), page("交付中心", main, "交付中心.html"));
  const demo = "delivery/demo/demo.html";
  mkdirSync(path.dirname(path.join(root, demo)), { recursive: true });
  writeFileSync(path.join(root, demo), page("V1.0 历史原型演示", `<header class="doc-nav"><a href="../../交付中心.html">← 交付中心</a><span>V1.0 历史原型</span><a href="../文档/docs/DEMO_GUIDE.html">运行当前 V1.2</a></header><main class="demo-main"><span class="pill">原始材料 · 非当前实现</span><h1>历史原型手机演示</h1><p>375 × 812 移动视口。V1.2 图文与工具能力请启动真实应用查看。</p><div class="demo-stage"><div class="phone-frame"><iframe title="路探 AI V1.0 历史交互原型" src="../../LutanAI_Prototype_V1.0.html" width="375" height="812"></iframe></div></div></main>`, demo));
  console.log(`交付中心已生成：${docs.length} 份静态文档、历史原型手机壳、2 张当前界面截图。`);
  return { documents: docs.length, targets };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) buildDelivery();
