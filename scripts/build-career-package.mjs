import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Claims on the shareable page come from the retained real-call record. Missing
// evidence remains visibly pending; screenshots alone never establish success.
const proofPath = 'docs/verification/agent-showcase-live.json';
const proof = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')) : {};
const photoSource = 'https://commons.wikimedia.org/wiki/File:River_shoreline_with_gray_rocks_close_up_photo.jpg';
const passed = proof.status === 'passed';
const outputOf = item => item?.output ?? item?.api_output ?? item?.response ?? item ?? {};
const vision = proof.vision ?? {};
const visionOutput = outputOf(vision);
const visible = visionOutput.observations?.visible ?? vision.visible ?? [];
const turns = Array.isArray(proof.turns) ? proof.turns : [];
const toolEvents = [proof.weather?.tool_event, ...(proof.weather?.tool_events ?? []), ...(outputOf(proof.weather).tool_events ?? []), ...turns.flatMap(turn => outputOf(turn).tool_events ?? [])].filter(Boolean);
const weatherEvent = toolEvents.find(event => ['get_weather', 'get_weather_by_city'].includes(event.name) && event.status === 'ok');
const historyEvent = toolEvents.find(event => ['get_session_history', 'read_session_actions'].includes(event.name) && event.status === 'ok');
const weather = weatherEvent?.result ?? proof.weather?.result ?? {};
const shots = {
  vision: vision.screenshot ?? 'docs/assets/agent-showcase-vision.png',
  weather: proof.weather?.screenshot ?? 'docs/assets/agent-showcase-weather.png',
  turns: [0, 1, 2].map(index => turns[index]?.screenshot ?? `docs/assets/agent-showcase-turn${index + 1}.png`),
};
const visionReal = passed && visible.length > 0 && (visionOutput.answer_source === 'agent' || vision.status === 'passed') && existsSync(shots.vision);
const weatherReal = passed && (weatherEvent || proof.weather?.status === 'passed') && weather.status === 'ok' && existsSync(shots.weather);
const conversationReal = passed && turns.length >= 3 && turns.slice(0, 3).every((turn, index) => outputOf(turn).answer_source === 'agent' && existsSync(shots.turns[index]));
const historyReal = conversationReal && Boolean(historyEvent);
const allAgentReal = visionReal && weatherReal && historyReal;
const deploymentNote = proof.delivery_note ?? "演示输入为合成作钓场景，图片是真实图像，工具与模型输出见原始记录。";
const capabilityText = `本机真实联调：图片理解：${visionReal ? '真实图片与模型已联调' : '已实现，等待真实图片联调'}；天气工具：${weatherReal ? '真实天气查询已成功' : '已实现，等待真实查询联调'}；会话历史：${historyReal ? '真实工具调用已成功' : '已实现，等待真实工具联调'}；三轮连续决策：${conversationReal ? '真实模型连续对话已完成' : '等待真实三轮演示'}。`;

const live = 'https://lutan-ai-field-assistant.jazzy-snow-2518.chatgpt.site';
const bullets = [
  ['需求与 MVP', '围绕路亚作钓“连续没口、不知如何调整”的场景，结合 13 条公开社区案例开展二手需求分析，规划“出钓准备—现场排查—反馈复盘”闭环，形成 PRD、交互原型与三页面 MVP。'],
  ['AI Agent 方案', allAgentReal ? '接入真实 DeepSeek 多模态模型，结合河岸照片、现场描述和会话反馈形成单项行动；设计天气与本次会话历史两类 Function Calling 工具，由模型按需调用，并展示视觉观察、工具结果和调整依据。' : '设计“规则安全门控＋大模型辅助决策”工作流，接入真实 DeepSeek；通过结构化输出校验、依据约束、超时回退与来源展示，限定模型在可核查的信息内提供单项行动建议。'],
  ['体验迭代', conversationReal ? '围绕“初次无口—尝试后仍无口—换位后跟饵不咬”的三轮场景，完善会话记忆、动作反馈与决策解释，让用户看见 AI 记住了什么、实际调用什么工具、为何调整建议，并保留真实 API 输出与演示截图。' : '针对本人试用中发现的重复回复、模型状态不清和关键条件缺失问题，推动口语识别、可见追问、会话记忆及反馈状态优化，并通过四轮真实 API 连续对话验证排查流程。'],
  ['落地与交付', '借助 Codex 辅助完成 Web 应用实现和部署，支持手机与桌面访问、本机记录和导出；建立 24 条合成场景基线并结合真实 API 联调，完成免登录公开体验版上线。'],
];
const short = [
  '基于 13 条公开社区案例开展二手需求分析，定义“准备—排查—复盘”的路亚现场助手 MVP，完成 PRD、原型与产品上线。',
  allAgentReal ? '接入真实 DeepSeek 图片理解，设计天气与会话历史两类按需调用工具；结合照片、现场描述和动作反馈生成单项建议，并展示实际工具结果及调整依据。' : '设计安全规则前置、DeepSeek 辅助决策、结构化校验与异常回退流程，输出一项行动及依据，并明确结果来源与未知信息。',
  '围绕重复回复和连续反馈问题迭代会话体验，借助 Codex 落地手机／桌面 Web 产品，通过合成场景和真实 API 联调验证主流程。',
];
const intro = allAgentReal ? '路探 AI 是我围绕路亚现场“不知道下一步怎么做”设计并推动上线的个人项目。它结合照片、现场描述和尝试记录，用 DeepSeek 提取可见信息，并按需调用天气或会话历史工具，持续给出一项下一步建议。我负责产品方案与迭代推进，借助 Codex 辅助开发，已完成真实图片、工具调用和三轮连续决策演示。' : '路探 AI 是我围绕路亚现场“不知道下一步怎么做”设计并推动上线的个人项目。我把需求收敛到出钓准备、现场排查和反馈复盘，用规则处理安全与许可问题，让 DeepSeek 在有依据的范围内给一项建议。我负责产品方案和迭代推进，借助 Codex 辅助实现，已经完成真实 API 联调和公网发布。';
const resume = ['路探 AI｜淡水路亚 AI 现场助手（个人项目，已上线）', '角色：产品负责人｜AI 辅助开发', ...bullets.map(([label, text]) => `• ${label}：${text}`), `在线体验：${live}`].join('\n');
const agentGuide = `## 本轮 Agent 演示

${capabilityText}

${deploymentNote}

${existsSync(proofPath) ? '[真实联调原始记录](docs/verification/agent-showcase-live.json)。图片与连续对话使用演示场景，天气为查询时的真实返回；这不是实际钓获或外部用户反馈。' : '本轮真实联调记录尚未生成，以下功能状态不会提前标记为验证成功。'}

${visionReal ? `**多模态图片理解**：模型返回的可见观察包括：${visible.join('；')}。[查看真实图片分析截图](${shots.vision})。演示采用 U.S. Fish and Wildlife Service 的[公有领域示例照片](${photoSource})，不是南充现场照片，也不是目标鱼存在证据。单张照片不能确认水位涨退、流速或水下鱼群。` : '**多模态图片理解**：上传与图文协议已具备，真实图片分析的展示等待联调记录。演示采用公开授权示例照片，非南充现场。'}

${weatherReal ? `**真实天气工具**：本轮实际调用 ${weatherEvent?.name ?? 'get_weather'}，数据来源 ${weather.source ?? '见原始记录'}，数据时间 ${weather.data_time ?? weather.time ?? weather.observed_at ?? '见工具结果'} ${weather.timezone ?? ''}。[查看真实工具截图](${shots.weather})。` : '**真实天气工具**：已实现天气查询；只有实际工具返回成功后才展示为真实调用。'}

${conversationReal ? turns.slice(0, 3).map((turn, index) => `**第 ${index + 1} 轮**：${turn.message ?? turn.input?.message ?? '见原始输入'}  \n建议：${outputOf(turn).action ?? '见原始输出'}  \n实际工具：${(outputOf(turn).tool_events ?? []).map(event => event.name).join('、') || '本轮未调用工具'}。[截图](${shots.turns[index]})。`).join('\n\n') : '**三轮连续决策**：演示会覆盖初次无口、明确尝试失败、换位后出现跟饵。最终以实际模型回复与工具记录为准。'}

## AI Agent 技术架构

\`\`\`text
现场助手：一张照片＋自然语言＋本次会话反馈
    ↓ 输入脱敏 / Zod 校验 / 安全与许可门控
DeepSeek 图文 Agent：有界决策、按需选择工具
    ├─ get_weather → Open-Meteo 城市天气 / 数据时间 / 来源
    └─ get_session_history → 客户端提交的本次动作与反馈
    ↓ 输出结构与事实边界校验 / 失败时规则回退
页面：视觉观察、实际工具、下一行动、调整依据
    ↓ 本机保存 / 恢复 / 导出
\`\`\`

模型自主决定是否调用工具，不是每轮固定调用。安全、禁钓和许可未知时优先给规则提示，不使用模型推翻门控。单张照片只支持可见结构与水面外观，未知项继续保留未知。

## 浏览器复现与配置

1. 进入“正在作钓”，按真实情况确认许可与水情。只有确实核验允许当前方式时，才选择相应许可选项。
2. 上传一张自己有权使用的河岸照片，输入“我在乱石边钓鳜鱼，软饵试了半小时都没口”。查看视觉观察、当前行动和需要补充的信息；按真实情况回答追问。
3. 实际尝试后输入“我按你说的试了，还是没口”；再输入“我换了位置，发现鱼有跟饵但不咬”。查看动作记忆、实际工具与建议变化。
4. 查询天气时明确给出城市，例如“请查询南充现在的天气，再结合当前情况给建议”。天气工具不是每轮自动执行；未调用时页面如实显示。

真实模型需要服务端配置 \`DEEPSEEK_API_KEY\` 或 \`LLM_API_KEY\`，并开启图像与工具能力；模板见 [.env.deepseek.example](.env.deepseek.example)。Open-Meteo 天气与本次会话历史工具无需额外 API Key。记录保存在当前浏览器，原始照片不写入历史。
`;
const guide = `# 路探 AI｜AI 产品经理求职材料

更新：2026-11-17。当前为已接入真实 DeepSeek、可公开访问的 V1.2 体验版。

[在线体验](${live}) · [可独立分享的作品介绍页](路探AI_求职作品介绍.html)

## 可直接写进简历

**路探 AI｜淡水路亚 AI 现场助手（个人项目，已上线）**  
**角色：产品负责人｜AI 辅助开发**

${bullets.map(([label, text]) => `- **${label}**：${text}`).join('\n')}

项目时间按真实起止月份填写；可确认的公开上线时间为 **2026 年 11 月 16 日**。在简历中将项目名链接至在线体验地址即可。

## 简历篇幅紧张时，使用三条精简版

${short.map(text => `- ${text}`).join('\n')}

## 面试开场讲法

${intro}

${agentGuide}

## 两个值得展开的产品决策

**为什么做“下一步行动”，而不是鱼情预测？**  
用户真正面临的是缺少排查顺序；当前又没有可核验的鱼群、鱼种和水文数据库。因此 MVP 优先把观察、单项尝试和反馈串起来，不用无来源的概率替代判断。这是范围取舍与证据边界的产品决策。

**为什么限制模型，还要保留规则？**  
安全水情、禁钓和许可未知先由规则处理。普通场景下，模型可以读取提交的会话、辅助解释和选择行动，但动作及依据须符合规则契约；格式错误、越界或超时时回退并标明来源。模型接入本身不是终点，用户需要知道当前建议来自哪里、哪些信息还不确定。

## 一个可以讲清楚的迭代案例

本人试用时，输入“还是没有口啊”会得到相同回复。排查发现，必要信息尚未补齐、反馈是否代表实际尝试不清晰，追问也不够显眼。迭代后，将关键追问放到输入框旁，提供按真实情况填写的快捷回复，并区分“未尝试”和“已尝试无改善”。真实四轮联调记录显示：持续无口先补问水层；用户明确补全条件后推进；明确尝试失败后选择另一方向。**这是试用问题驱动的流程改进，没有外部用户留存或效率提升数据。**

## 我的贡献与 AI 工具的分工

个人项目中，负责场景定义、MVP 范围、交互流程、AI 能力边界、迭代优先级与发布推进；代码实现、测试脚本和部分材料整理借助 Codex 完成。面试时可以直接说明 AI 辅助开发方式，并重点解释产品取舍、问题如何被发现、改动依据和实际执行记录。

## 成果证据，供面试备查

| 已有成果 | 依据与口径 |
| --- | --- |
| 13 条公开案例材料 | [二手需求分析](LutanAI_Secondary_Research.md)；是公开帖子的定性研究，不是 13 次用户访谈 |
| PRD 与交互原型 | [早期 PRD](LutanAI_PRD_V1.0.md)、[早期可交互原型](LutanAI_Prototype_V1.0.html)；两者保留当时的阶段说明 |
| 真实五场景联调 | D03、D04、D06 普通场景调用模型；D01 危险、P05 许可未知验证零调用；[原始记录](docs/verification/live-deepseek/run-20261116T125023929Z.json)，均为合成场景 |
| 真实四轮连续反馈 | [浏览器原始记录](docs/verification/followup-live-browser.json)；是合成对话联调，不是钓友实测 |
| 公开上线与文字回复 | [发布记录](docs/verification/online-publication.json)、[已上线阶段浏览器记录](docs/verification/online-smoke-20261116T140230436Z.json)；记录是阶段证据，不代表平均速度 |
${existsSync(proofPath) ? '| 本轮图片、工具与三轮 Agent | [真实联调原始记录](docs/verification/agent-showcase-live.json)；区分模型输出、规则回退、实际工具结果和耗时 |' : ''}
| 工程验证 | 常规自动测试以模拟供应商为主，真实 API 联调单独留档。本轮检查结果以最终执行汇报为准；历史物种库尚未实现，场景回归不能写成模型准确率 |

## 当前阶段与下一步

已完成可运行 MVP 和公开体验。${capabilityText}下一步是邀请目标钓友完成真实任务，观察信息填写、建议理解和连续反馈是否顺畅。目前没有外部用户规模、留存、付费或渔获改善数据；历史物种资料库尚未实现，GitHub 仓库尚未公开发布。

技术栈作为补充即可：React、TypeScript、Express、Zod；真实 DeepSeek API、会话快照工具、有界工具调用与失败回退。当前没有模型训练、RAG 知识库或多 Agent 系统。
`;
writeFileSync('LutanAI_Portfolio_Guide.md', guide);

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const picture = name => `data:image/png;base64,${readFileSync(`docs/assets/${name}`).toString('base64')}`;
const shot = (filename, title, confirmed) => confirmed && existsSync(filename)
  ? `<button class="agent-shot" type="button" data-enlarge aria-label="放大查看：${esc(title)}"><img src="data:image/png;base64,${readFileSync(filename).toString('base64')}" alt="${esc(title)}"><span>点击放大真实截图 ↗</span></button>`
  : '<div class="agent-pending">真实联调截图待生成</div>';
const weatherValue = (value, unit = '') => value === undefined || value === null ? '见原始记录' : `${esc(value)}${unit}`;
const agentStyles = `.agent-proof-title{display:flex;align-items:center;justify-content:space-between;gap:15px}.agent-status{display:inline-block;font-size:10px;padding:4px 9px;border-radius:20px;background:#e4f2e9;color:#216546}.agent-status.pending{background:#fff2d7;color:#806027}.agent-proof-card{padding:19px;background:#fff;border:1px solid #dce8e1;border-radius:13px;min-width:0}.agent-proof-card>p{font-size:12px;color:#5d7869}.agent-proof-card h3{margin-bottom:12px}.agent-shot{position:relative;border:1px solid #dce8e1;background:#f6faf7;border-radius:10px;padding:0;width:100%;overflow:hidden;display:block}.agent-shot img{display:block;width:100%;max-height:540px;object-fit:contain;object-position:top}.agent-shot span{display:block;font-size:10px;padding:6px;color:#337b60;border-top:1px solid #e1ebe5;background:#f9fcfa}.agent-pending{display:grid;place-items:center;min-height:200px;background:#f4f7f3;border:1px dashed #c9dace;border-radius:10px;font-size:12px;color:#809084}.agent-weather-facts{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.agent-weather-facts span{font-size:11px;padding:5px 8px;background:#edf5ef;border-radius:6px}.agent-turns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px}.agent-turn-caption{font-size:11px;color:#5a7665;margin:12px 0}.agent-turn-caption b{color:#1b503b}.agent-architecture{background:#eaf3ee;border:1px solid #d7e5dc;border-radius:13px;padding:23px}.agent-architecture-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.agent-architecture-row>div{background:#fff;border:1px solid #d7e5dc;padding:16px;border-radius:9px}.agent-architecture strong{font-size:12px;display:block}.agent-architecture p{font-size:11px;color:#567260;margin:7px 0 0}.agent-architecture-arrow{text-align:center;font-size:20px;color:#719c84;margin:9px 0}.agent-proof-note{font-size:11px;color:#6d8373;margin-top:14px}.agent-dialog{width:min(1180px,calc(100vw - 32px));max-height:92vh;padding:16px;border:1px solid #d1dfd4;border-radius:14px;overflow:auto;color:#234c37}.agent-dialog::backdrop{background:#153c36a8}.agent-dialog-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;font-size:13px}.agent-dialog-top button{border:1px solid #cbdccf;background:#f0f7f1;color:#23603f;border-radius:6px;padding:5px 11px}.agent-dialog img{width:100%;display:block}@media(max-width:680px){.agent-turns,.agent-architecture-row{grid-template-columns:1fr}.agent-proof-title{flex-direction:column;align-items:flex-start;gap:0}.agent-proof-title .agent-status{margin-bottom:14px}.agent-shot img{max-height:680px}.agent-architecture{padding:16px}.agent-dialog{padding:11px}}@media print{.agent-shot span{display:none}.agent-turns{grid-template-columns:1fr 1fr 1fr}.agent-proof-card{break-inside:avoid}.agent-dialog{display:none}}`;
const agentShowcase = `<section><div class="agent-proof-title"><h2>真实 Agent 能力展示</h2><span class="agent-status ${allAgentReal ? '' : 'pending'}">${allAgentReal ? '真实图片 / 天气 / 会话工具已联调' : '以实际联调结果更新状态'}</span></div><p class="sub">${esc(capabilityText)}演示输入为合成作钓场景；图片是实际图像输入，天气为查询时的实时返回，截图与原始输出对应。</p><div class="grid"><article class="agent-proof-card"><h3>公开授权示例照片，非南充现场</h3>${shot(shots.vision, '真实多模态图片分析：照片、视觉观察与行动', visionReal)}<p>${visionReal ? esc(visible.join('；')) : '照片上传和模型视觉观察分别展示，等待真实图片联调记录。'}</p><p class="agent-proof-note">照片：U.S. Fish and Wildlife Service，公有领域；<a href="${photoSource}" target="_blank" rel="noopener">Wikimedia 原始来源 ↗</a>。不把单张照片无法确定的涨退水趋势、流速或水下鱼群写成已识别事实。</p></article><article class="agent-proof-card"><h3>模型按需调用真实天气工具</h3>${shot(shots.weather, '真实天气工具调用及关键结果', weatherReal)}<div class="agent-weather-facts">${weatherReal ? `<span>工具 ${esc(weatherEvent?.name ?? 'get_weather')}</span><span>温度 ${weatherValue(weather.temperature_c, ' ℃')}</span><span>降水 ${weatherValue(weather.precipitation_mm, ' mm')}${weather.precipitation_interval_seconds ? ` / ${weather.precipitation_interval_seconds / 60} 分钟` : ''}</span><span>风速 ${weatherValue(weather.wind_speed_kmh ?? weather.wind_kmh ?? weather.wind_kph, ' km/h')}</span>` : '<span>等待真实天气调用成功</span>'}</div><p>${weatherReal ? `数据时间：${esc(weather.data_time ?? weather.time ?? weather.observed_at ?? '见截图')} ${esc(weather.timezone ?? '')}；来源：${esc(weather.source ?? '见工具结果')}。` : '只有实际执行过的工具才会留下调用记录；未调用时如实显示。'}</p><p class="agent-proof-note">天气用于补充环境信息，不等同于现场水位或鱼口预测。</p></article></div></section>
<section><h2>连续三轮：看见记忆、工具和调整依据</h2><p class="sub">${conversationReal ? '三轮均来自真实模型请求；以下是同一次会话的连续输入与结果。' : '等待实际三轮联调截图；不以模拟回复代替真实演示。'}</p><div class="agent-turns">${[0, 1, 2].map(index => { const turn = turns[index]; const out = outputOf(turn); return `<article class="agent-proof-card"><h3>第 ${index + 1} 轮 · ${['初次排查', '反馈后调整', '新观察再决策'][index]}</h3>${shot(shots.turns[index], `真实连续诊断第 ${index + 1} 轮`, conversationReal)}<p class="agent-turn-caption"><b>用户：</b>${esc(turn?.message ?? turn?.input?.message ?? ['我在乱石边钓鳜鱼，软饵试了半小时都没口。', '我按你说的试了，还是没口。', '我换了位置，发现鱼有跟饵但不咬。'][index])}</p>${conversationReal ? `<p class="agent-turn-caption"><b>下一行动：</b>${esc(out.action)}</p><p class="agent-turn-caption"><b>实际工具：</b>${esc((out.tool_events ?? []).map(event => event.name).join('、') || '本轮未调用工具')}</p>` : ''}</article>`; }).join('')}</div><p class="agent-proof-note">会话历史来自当前浏览器明确提交的动作与反馈，不能读取其他设备的记录；没有实际尝试时不会替用户编造反馈或执行时长。</p></section>
<section><h2>AI Agent 技术架构</h2><div class="agent-architecture"><div class="agent-architecture-row"><div><strong>现场输入 · React / TypeScript</strong><p>一张环境照片、自然语言、城市、本次动作与反馈。照片压缩与脱敏后提交，原图不存历史。</p></div><div><strong>服务端安全门控 · TypeScript / Zod</strong><p>输入结构校验，安全 / 禁钓 / 许可未知规则优先。普通场景才进入 DeepSeek。</p></div><div><strong>图文 Agent · DeepSeek</strong><p>提取可见观察，在规则依据内选择一项行动，按问题自主决定是否调用工具。</p></div></div><div class="agent-architecture-arrow">↓</div><div class="agent-architecture-row"><div><strong>get_weather</strong><p>查询用户给出的城市；Open-Meteo 返回温度、降水、风速、时间与来源。</p></div><div><strong>get_session_history</strong><p>读取客户端提交的本次尝试与反馈，辅助解释为何保持或调整下一行动。</p></div><div><strong>校验、回退与记录</strong><p>输出 Schema 和事实边界校验；失败时标明规则回退；页面呈现实际工具、记忆与建议，本机保存。</p></div></div></div><p class="agent-proof-note">本地 Express 与线上轻量 Worker 入口复用原有 DeepSeek 适配器、Agent 服务与会话状态。没有新增 RAG 或多 Agent；工具调用有轮次与执行次数上限，保留预算和超时回退。</p></section>`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>路探 AI｜AI 产品经理作品介绍</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#153536;background:#f2f6f5;line-height:1.7;font-synthesis:none}*{box-sizing:border-box}body{margin:0}a{color:#0c7767;text-decoration:none}button{font:inherit;cursor:pointer}.wrap{max-width:1120px;margin:auto;padding:26px 32px 50px}header{display:flex;justify-content:space-between;gap:20px;align-items:center;padding:12px 0 26px;border-bottom:1px solid #dce7e2}header strong{font-size:21px}header small{font-size:11px;color:#5d7e73;margin-left:12px}.link{border:1px solid #b4cec2;border-radius:9px;padding:9px 15px;font-size:12px}.hero{padding:49px 0 30px}.tag{font-size:11px;letter-spacing:2px;color:#177661}.hero h1{font-size:43px;letter-spacing:-1px;line-height:1.3;margin:12px 0 20px;max-width:900px}.hero>p{max-width:770px;color:#5e776c;font-size:15px;margin:0 0 20px}.tags{display:flex;gap:8px;flex-wrap:wrap}.tags span{font-size:11px;border:1px solid #d5e5dc;background:#e7f1ec;padding:5px 10px;border-radius:20px}.numbers{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#dfe9e3;border:1px solid #dfe9e3;border-radius:12px;overflow:hidden;margin:26px 0 32px}.numbers>div{background:#fff;padding:18px 20px}.numbers strong{font-size:23px;display:block;color:#116b57}.numbers small{font-size:11px;color:#647c70}.screens{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:20px;align-items:start}.desktop,.phone{margin:0;border:1px solid #d8e4dd;background:#fff;border-radius:13px;overflow:hidden}.desktop img{width:100%;display:block}.phone img{width:100%;display:block}.caption{font-size:10px;color:#73877b;margin:10px 0 24px}section{margin:38px 0}h2{font-size:23px;margin:0 0 17px;letter-spacing:-.4px}h3{font-size:15px;margin:0 0 9px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:17px}.card{background:#fff;border:1px solid #dde8e1;border-radius:13px;padding:23px}.card p{font-size:13px;color:#5e766b;margin:0}.step{display:flex;align-items:flex-start;gap:13px;margin:17px 0}.step>span{font-size:10px;padding:4px 8px;border-radius:6px;background:#e9f3ed;color:#28765c}.step strong{font-size:13px}.step p{font-size:12px;color:#64786d;margin:3px 0}.flow{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px}.flow div{padding:17px;border:1px solid #dce8de;border-radius:10px;background:#f8fcf9}.flow strong{font-size:12px;display:block;margin-bottom:7px}.flow span{font-size:11px;color:#5f796c}.result{background:#153c36;border-radius:13px;color:#fff;padding:25px}.result h3{font-size:18px}.result p{color:#c0d6c9;font-size:13px;margin-bottom:0}.result small{display:block;font-size:10px;color:#9cbdad;margin-top:12px}.sub{font-size:12px;color:#687d70}.resume{background:#fff;border:1px solid #dce7de;border-radius:14px;padding:25px}.resume-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.resume-top h2{margin:0}.copy{border:0;border-radius:8px;background:#13745e;color:#fff;font-size:12px;padding:9px 14px}textarea{display:block;width:100%;border:0;resize:vertical;min-height:365px;font-family:inherit;font-size:13px;line-height:1.9;color:#214339;margin-top:18px;padding:15px;background:#f5f9f6;border-radius:9px}.intro{border-left:3px solid #44876b;padding-left:20px;color:#4d6e5e;font-size:14px}.notes{font-size:11px;color:#6d8274;border-top:1px solid #d7e4da;padding-top:20px}footer{display:flex;justify-content:space-between;gap:15px;font-size:10px;color:#71887a;padding-top:24px}button:focus-visible,a:focus-visible{outline:3px solid #75bdb0;outline-offset:3px}
@media(max-width:680px){.wrap{padding:17px 18px 35px}header small{display:block;margin:0}.hero{padding-top:33px}.hero h1{font-size:29px}.hero>p{font-size:13px}.numbers{grid-template-columns:1fr 1fr}.numbers>div{padding:14px}.numbers strong{font-size:20px}.screens{grid-template-columns:1fr}.phone{display:none}.grid{grid-template-columns:1fr}.flow{grid-template-columns:1fr}.resume{padding:18px}h2{font-size:21px}.resume-top{align-items:flex-start}textarea{min-height:560px}footer{flex-direction:column}}
@media print{body{background:#fff}.wrap{max-width:none;padding:0}.link,.copy{display:none}.hero{padding-top:25px}.hero h1{font-size:29px}.numbers{margin:18px 0}.screens{grid-template-columns:1fr 125px}.grid{grid-template-columns:1fr 1fr}.card,.result{break-inside:avoid}.resume{break-before:page}textarea{min-height:350px;resize:none}.notes{break-inside:avoid}section{margin:25px 0}}
${agentStyles}
</style></head><body><main class="wrap"><header><div><strong>路探 AI</strong><small>AI 产品经理 · 个人作品</small></div><a class="link" href="${live}" target="_blank" rel="noopener">打开在线产品 ↗</a></header>
<div class="hero"><div class="tag">从需求判断，到真实 API 与公开上线</div><h1>把“下一步怎么做”，<br>变成可记录的现场决策。</h1><p>面向淡水路亚的 AI 现场助手。聚焦连续没口时的排查顺序，通过“观察 → 单项尝试 → 反馈 → 继续排查”积累经验。</p><div class="tags"><span>个人项目负责人</span><span>Codex 辅助开发</span><span>真实 DeepSeek</span><span>2026.11 公开上线</span></div></div>
<div class="numbers"><div><strong>13 条</strong><small>公开社区案例 · 二手需求分析</small></div><div><strong>3 个页面</strong><small>出钓准备 / 现场助手 / 我的记录</small></div><div><strong>真实 API</strong><small>${allAgentReal ? '图文理解与工具调用已联调' : 'DeepSeek 文字交互已完成联调'}</small></div><div><strong>可公开体验</strong><small>手机与桌面 · 无需注册</small></div></div>
<div class="screens"><figure class="desktop"><img src="${picture('product-desktop.png')}" alt="路探 AI 桌面首页：体验入口、使用示例和出钓准备"></figure><figure class="phone"><img src="${picture('online-ai-mobile.png')}" alt="手机端真实 DeepSeek 回复，显示来源与依据"></figure></div><p class="caption">真实产品界面；手机回复来自合成场景的公网联调，不代表真实钓友反馈或渔获结果。</p>
<section><h2>我解决了什么问题</h2><div class="grid"><article class="card"><h3>现场缺少明确的排查顺序</h3><p>用户会同时怀疑拟饵、位置、水层和手法，却难以知道应该先尝试哪一项。公开案例用于梳理痛点，未将个案经验当成通用鱼类知识。</p></article><article class="card"><h3>把 MVP 收敛到行动与反馈</h3><p>先做好准备、现场和复盘的闭环：每轮强调一项行动，记录尝试结果，再决定补问还是继续。鱼群预测和物种资料库留待有可靠证据后再评估。</p></article></div></section>
<section><h2>AI 产品方案</h2><div class="flow"><div><strong>01 · 规则先判断</strong><span>危险、禁钓、许可未知先给规则提示；普通且用户自述许可已核验时再进入模型。</span></div><div><strong>02 · 模型有明确边界</strong><span>DeepSeek 读取提交的观察与会话，动作和依据符合规则契约，结果通过 Zod 结构校验。</span></div><div><strong>03 · 失败仍能继续</strong><span>超时、越界或额度不足时回退规则，界面说明来源，反馈与记录仍可保存。</span></div></div></section>
${agentShowcase}
<section><h2>一次真实试用推动的迭代</h2><div class="card"><div class="step"><span>发现</span><div><strong>输入“还是没有口啊”，回复仍然一样</strong><p>本人试用发现重复回复，页面中的关键追问和模型状态也不够清楚。</p></div></div><div class="step"><span>判断</span><div><strong>补齐决策条件，区分反馈含义</strong><p>持续无口不代表上一项已经实际尝试；缺少水层信息时，用户需要先知道该补哪一项。</p></div></div><div class="step"><span>改动</span><div><strong>可见追问、快捷填写、会话状态与口语识别</strong><p>补全信息后推进下一项；明确尝试失败后选择另一方向；保持安全与来源提示。</p></div></div><div class="step"><span>验证</span><div><strong>真实四轮文字联调，确认连续排查流程</strong><p>保留原始请求与输出。这是合成对话联调，尚未形成真实钓友的行为或业务指标。</p></div></div></div></section>
<section><h2>我的工作与已交付成果</h2><div class="grid"><article class="card"><h3>产品负责人的工作</h3><p>场景定义、MVP 范围、PRD、交互流程、AI 能力边界、迭代优先级及上线推进。代码和测试脚本借助 Codex 完成，强调可解释的取舍与可检查的结果。</p></article><article class="result"><h3>公开产品，真实模型回复</h3><p>已完成需求与原型、三页面应用、真实 DeepSeek 接入和公网发布。${allAgentReal ? '本轮进一步完成真实图片理解、天气与会话工具调用、连续三轮决策演示。' : '本轮新增 Agent 能力的真实状态见上方证据区。'}</p><small>所有真实演示保留原始输出、来源和耗时；合成场景不代表真实用户或实钓效果，常规自动测试以模拟供应商为主。</small></article></div></section>
<section class="resume"><div class="resume-top"><h2>可直接复制的简历项目经历</h2><button class="copy" id="copy-resume" type="button">复制简历文字</button></div><p class="sub">适合 AI 产品经理方向；项目起止月份按真实时间补充。</p><textarea id="resume-text" aria-label="简历项目经历" readonly>${esc(resume)}</textarea><p class="sub" id="copy-status" role="status">角色表述：个人项目负责人，AI 辅助开发。</p></section>
<section><h2>面试开场</h2><p class="intro">${intro}</p></section>
<div class="notes">${esc(deploymentNote)}<br>阶段说明：公开体验版；${esc(capabilityText)}当前没有外部用户规模、留存、付费或渔获改善数据。历史物种资料库尚未实现，GitHub 仓库尚未公开发布。13 条材料为公开帖子二手研究，24 条评测场景为合成数据。</div>
<footer><span>路探 AI · AI 产品经理个人作品 · 2026-11-16</span><a href="${live}" target="_blank" rel="noopener">在线体验 ↗</a></footer></main><dialog class="agent-dialog" id="agent-screenshot"><div class="agent-dialog-top"><strong id="agent-screenshot-title">真实演示截图</strong><button type="button" id="agent-close">关闭</button></div></dialog><script>
document.getElementById('copy-resume').addEventListener('click',async()=>{const t=document.getElementById('resume-text');const s=document.getElementById('copy-status');try{await navigator.clipboard.writeText(t.value);s.textContent='已复制，可粘贴到简历。'}catch{t.focus();t.select();s.textContent='已选中文字，请按 Ctrl+C 复制。'}});
const zoom=document.getElementById('agent-screenshot');document.querySelectorAll('[data-enlarge]').forEach(button=>button.addEventListener('click',()=>{const source=button.querySelector('img');let image=document.getElementById('agent-screenshot-image');if(!image){image=document.createElement('img');image.id='agent-screenshot-image';zoom.append(image);}image.src=source.src;image.alt=source.alt;document.getElementById('agent-screenshot-title').textContent=source.alt;zoom.showModal();}));document.getElementById('agent-close').addEventListener('click',()=>zoom.close());zoom.addEventListener('click',event=>{if(event.target===zoom)zoom.close();});
</script></body></html>`;
writeFileSync('路探AI_求职作品介绍.html', html);
console.log(JSON.stringify({ guide: 'LutanAI_Portfolio_Guide.md', showcase: '路探AI_求职作品介绍.html', standalone: true }));
