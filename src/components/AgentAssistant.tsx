import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Download,
  Eye,
  History,
  MessageCircle,
  Plus,
  Send,
  Wrench,
  X,
} from "lucide-react";
import {
  newAgentSession,
  redactPrivateText,
  type AgentSession,
  type AgentResult,
  type SessionAction,
} from "../../shared/agent.ts";
import { fishOptions, layerOptions, lureOptions, type DiagnosisInput } from "../../shared/schema.ts";
import { getRisk } from "../../shared/engine.ts";
import { sanitizeAgentInput } from "../../shared/agent-fallback.ts";
import { compressAgentImage, requestAgentAvailability, requestAgentTurn, type AgentAvailability } from "../lib/agent-api.ts";
import {
  exportAgentSessions,
  loadCurrentAgentSession,
  saveAgentSession,
} from "../lib/agent-storage.ts";
import { downloadJson } from "../lib/records.ts";
import { ChoiceField, MultiChoice, Notice } from "./ui.tsx";

const clean = (context: DiagnosisInput) => ({ ...context, alias: "" });
const isWeatherTool = (name: string) => ["get_weather", "get_weather_by_city"].includes(name);
const isHistoryTool = (name: string) => ["get_session_history", "read_session_actions"].includes(name);
const sourceLabel = (result: AgentResult) =>
  result.answer_source === "agent"
    ? `Agent · ${result.model_name}`
    : getRisk(result.context) !== "normal" && result.model_calls === 0
      ? "安全规则 · 本次未调用 AI"
    : result.answer_source === "local_rule"
      ? "本机规则回退"
      : "服务端规则回退";
function gateExplanation(context: DiagnosisInput) {
  switch (getRisk(context)) {
    case "verify_first": return {
      title: "还未核实作钓许可，本轮暂不调用 AI",
      detail: "先核对当地官方公告的日期、河段和作钓方式，再按真实情况填写许可。暂不清楚时保留“尚未核对公告”。",
      button: "先确认作钓条件",
    };
    case "danger": return {
      title: "已报告危险水情，先停止作钓",
      detail: "先远离急涨、急流或危险岸边，在安全位置核对官方预警。当前使用安全规则，不调用模型给出作钓建议。",
      button: "查看安全条件",
    };
    case "restricted": return {
      title: "当前标记为禁钓，暂停作钓建议",
      detail: "停止在该河段作钓并遵守适用管理规定。当前使用安全规则，不调用模型给出继续作钓的建议。",
      button: "查看禁钓状态",
    };
    default: return null;
  }
}
export function AgentAssistant({
  input,
  onContextChange,
}: {
  input: DiagnosisInput;
  onContextChange: (context: DiagnosisInput) => void;
}) {
  const [session, setSession] = useState(() => {
    const saved = loadCurrentAgentSession(clean(input));
    const matches =
      JSON.stringify(clean(input)) === JSON.stringify(saved.context);
    return {
      ...saved,
      context: clean(input),
      last_result: matches ? saved.last_result : null,
    };
  });
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<string | null>(null);
  // This preview stays in memory only, and is never written to session storage.
  const [analyzedImage, setAnalyzedImage] = useState<{ turnId: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const [availability, setAvailability] = useState<AgentAvailability>({ state: "checking" });
  const [contextOpen, setContextOpen] = useState(false);
  const contextRef = useRef<HTMLDetailsElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const latest = session.last_result,
    currentAction = session.actions.at(-1),
    previousAction = session.actions.at(-2);
  const gate = gateExplanation(session.context);
  const latestIsGated = latest && getRisk(latest.context) !== "normal";
  const latestMessageId = session.messages.at(-1)?.id;
  const latestUserMessage = session.messages.filter((message) => message.role === "user").at(-1);
  const rememberedActions = session.actions.filter((action) => action.turn_id !== latest?.turn_id).slice(-4);
  const needsAnswer = latest && !latestIsGated && latest.follow_up_question;
  const isInformationStep = Boolean(needsAnswer && latest?.action_kind === "confirm_observation");
  const answerOptions = !needsAnswer ? []
    : /水层/.test(needsAnswer) ? ["已确认主要搜索一个水层", "已确认搜索了多个水层", "仍不清楚覆盖水层"]
    : /拟饵/.test(needsAnswer) ? ["当前使用软饵", "当前使用米诺", "当前使用铁板", "当前使用其他拟饵"]
    : /有改善.*没有改善/.test(needsAnswer) ? ["已尝试，有改善", "已尝试，没有改善", "已尝试，但暂时无法判断"]
    : /尝试/.test(needsAnswer) ? ["上一步还没尝试", "上一步已经试过，仍没有改善"] : [];
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [latestMessageId]);
  useEffect(() => {
    const check = new AbortController();
    void requestAgentAvailability(check.signal).then((value) => {
      if (!check.signal.aborted) setAvailability(value);
    });
    return () => check.abort();
  }, []);
  useEffect(() => {
    const next = clean(input);
    if (JSON.stringify(next) !== JSON.stringify(session.context)) {
      controller.current?.abort();
      setBusy(false);
      setSession((current) => ({
        ...current,
        context: next,
        last_result: null,
      }));
    }
  }, [input]);
  function persist(next: AgentSession) {
    setSession(next);
    const stored = saveAgentSession(next);
    if (stored.error) setError(stored.error);
  }
  function contextChange<K extends keyof DiagnosisInput>(
    key: K,
    value: DiagnosisInput[K],
  ) {
    const context = { ...session.context, [key]: value, alias: "" };
    controller.current?.abort();
    setBusy(false);
    persist({ ...session, context, last_result: null });
    onContextChange(context);
    if (key === "legality" && getRisk(context) === "normal") {
      setContextOpen(false);
      window.requestAnimationFrame(() => document.getElementById("agent-message")?.focus());
    }
  }
  function openContext() {
    setContextOpen(true);
    window.requestAnimationFrame(() => {
      contextRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      contextRef.current?.querySelector("summary")?.focus({ preventScroll: true });
    });
  }
  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy || imageBusy || !draft.trim()) return;
    const text = redactPrivateText(draft);
    if (!text) {
      setError("请输入可用的现场描述。");
      return;
    }
    const preview = sanitizeAgentInput({
      session_id: session.id, message: text, context: clean(session.context),
      session_snapshot: { messages: session.messages, actions: session.actions, observations: session.observations, city: session.city },
    });
    if (getRisk(preview.context) !== "normal") {
      // 保留草稿和原会话；不重复写入相同安全回复，也不发送图片或模型请求。
      if (JSON.stringify(preview.context) !== JSON.stringify(session.context)) {
        persist({ ...session, context: preview.context, last_result: null });
        onContextChange(preview.context);
      }
      openContext();
      return;
    }
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(true);
    setError("");
    const before = session;
    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      text,
      created_at: new Date().toISOString(),
      had_image: Boolean(image),
    };
    setSession({
      ...before,
      messages: [...before.messages, userMessage].slice(-20),
    });
    try {
      const result = await requestAgentTurn(
        {
          session_id: before.id,
          message: text,
          ...(image ? { image } : {}),
          context: clean(before.context),
          session_snapshot: {
            messages: before.messages,
            actions: before.actions,
            observations: before.observations,
            city: before.city,
          },
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      setAnalyzedImage(image ? { turnId: result.turn_id, url: image } : null);
      const action: SessionAction = {
        id: crypto.randomUUID(),
        turn_id: result.turn_id,
        kind: result.action_kind,
        text: result.action,
        created_at: result.created_at,
        applied_at: null,
        feedback: "暂未尝试",
        feedback_at: null,
        source: result.answer_source,
      };
      const assistant = {
        id: result.turn_id,
        role: "assistant" as const,
        text: `${result.follow_up_question ? `先确认：${result.follow_up_question}\n` : ""}${result.action}\n依据：${result.reason}\n观察：${result.check}`.slice(
          0,
          1400,
        ),
        created_at: result.created_at,
        had_image: false,
      };
      persist({
        ...before,
        updated_at: new Date().toISOString(),
        context: result.context,
        messages: [...before.messages, userMessage, assistant].slice(-20),
        observations: result.observations,
        actions: [...result.reported_actions, action].slice(-20),
        tool_events: [...before.tool_events, ...result.tool_events].slice(-30),
        last_result: result,
      });
      if (JSON.stringify(clean(input)) !== JSON.stringify(result.context))
        onContextChange(result.context);
      if (result.follow_up_question) window.requestAnimationFrame(() => questionRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
      setDraft("");
      setImage(null);
    } catch (err) {
      if (!abort.signal.aborted) {
        setSession(before);
        setError(err instanceof Error ? err.message : "发送失败，请重试。");
      }
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  function feedback(status: SessionAction["feedback"]) {
    if (!currentAction || busy) return;
    const now = new Date().toISOString();
    persist({
      ...session,
      updated_at: now,
      actions: session.actions.map((action) =>
        action.id === currentAction.id
          ? {
              ...action,
              feedback: status,
              feedback_at: now,
              // The feedback time is known; the exact action execution time is not.
              applied_at: action.applied_at,
            }
          : action,
      ),
    });
  }
  async function chooseImage(file: File | undefined) {
    if (!file) return;
    setImageBusy(true);
    setError("");
    try {
      setImage(await compressAgentImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片处理失败。");
    } finally {
      setImageBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <section className="panel agent-panel" aria-label="AI 现场助手">
      <div className="result-top">
        <div className="agent-heading">
          <MessageCircle size={21} />
          <div>
            <h2>AI 现场助手</h2>
            <p>描述现场，可附一张照片。接着上一次尝试，判断下一步。</p>
          </div>
        </div>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            controller.current?.abort();
            setError("");
            setDraft("");
            setImage(null);
            setAnalyzedImage(null);
            persist(newAgentSession(clean(input)));
          }}
        >
          <Plus size={14} />
          新建会话
        </button>
      </div>
      <div className="agent-capability-strip" aria-label="现场助手能力">
        <span><Eye size={13} /> 看现场</span>
        <span><Wrench size={13} /> 按需查工具</span>
        <span><History size={13} /> 接着上次排查</span>
      </div>
      <p className="agent-model-status" role="status" aria-label="模型配置状态">
        {availability.state === "ready" ? `AI 已配置：${availability.model}`
          : availability.state === "checking" ? "正在检查本机模型配置…"
          : availability.state === "disabled" ? "当前服务未启用模型，发送后使用规则建议。"
          : "暂时无法读取模型配置，发送失败时仍可使用规则。"}
        {availability.state === "ready" && <span>配置检查不发送模型请求；实际结果会标明来源。</span>}
      </p>
      <details className="agent-context" ref={contextRef} open={contextOpen} onToggle={(event) => setContextOpen(event.currentTarget.open)}>
        <summary>
          作钓条件与安全确认{" "}
          <span>
            {session.context.fish} · 水位{session.context.waterlevel} ·{" "}
            {session.context.legality}
          </span>
        </summary>
        <ChoiceField label="助手使用的目标鱼" options={fishOptions} value={session.context.fish} onChange={(value) => contextChange("fish", value)} />
        <MultiChoice label="当前使用的拟饵" options={lureOptions} value={session.context.lures} onChange={(value) => contextChange("lures", value)} />
        <ChoiceField label="实际搜索的水层" options={layerOptions} value={session.context.layers} onChange={(value) => contextChange("layers", value)} hint="只填写能确认的覆盖范围；单张照片不能确认水下搜索水层。" />
        <ChoiceField
          label="助手使用的合法性条件"
          options={["未知", "用户已核实允许", "禁止垂钓"] as const}
          value={session.context.legality}
          labels={{
            未知: "尚未核对公告",
            用户已核实允许: "已核对公告，允许当前方式",
            禁止垂钓: "此处已明确禁钓",
          }}
          onChange={(value) => contextChange("legality", value)}
        />
        <ChoiceField
          label="助手使用的水位观察"
          options={["未知", "稳定", "涨水", "退水", "急变"] as const}
          value={session.context.waterlevel}
          labels={{
            未知: "水位尚不清楚",
            稳定: "目前看起来稳定",
            涨水: "观察到涨水",
            退水: "观察到退水",
            急变: "发现水情急变",
          }}
          onChange={(value) => contextChange("waterlevel", value)}
        />
        <ChoiceField
          label="助手使用的水流观察"
          options={["未知", "普通", "缓慢", "很急"] as const}
          value={session.context.flow}
          labels={{
            未知: "流速不确定",
            普通: "水流一般",
            缓慢: "水流缓慢",
            很急: "水流已明显很急",
          }}
          onChange={(value) => contextChange("flow", value)}
        />
        <p className="hint">
          未核实允许、急涨或急流时，先给规则安全提醒，不调用模型。
        </p>
      </details>
      <div className="agent-context-chips" aria-label="当前作钓条件">
        <span>目标：{session.context.fish}</span>
        <span>拟饵：{session.context.lures.join("、") || "尚未说明"}</span>
        <span>搜索：{session.context.layers}</span>
      </div>
      {rememberedActions.length > 0 && <details className="agent-memory" open aria-label="本次会话记忆">
        <summary><History size={15} /><strong>记住了哪些尝试</strong><span>最近 {rememberedActions.length} 条建议与反馈</span></summary>
        <ol>
          {rememberedActions.map((action) => <li key={action.id}>
            <span className={`agent-memory-feedback ${action.feedback === "没有改善" ? "needs-change" : ""}`}>{action.feedback}</span>
            <p>{action.text}</p>
          </li>)}
        </ol>
        <p className="source-note">来自你在本次会话提交的记录；未尝试的建议不会当作失败。工具是否读取记录，会在本轮结果中显示。</p>
      </details>}
      {session.messages.length > 0 && (
        <div className="agent-chat" aria-label="本次会话消息" ref={chatRef}>
          {session.messages.slice(-6).map((message) => (
            <div className={`agent-message ${message.role}`} key={message.id}>
              <span>
                {message.role === "user" ? "你" : "现场助手"}
                {message.had_image ? " · 附图（原图不留存）" : ""}
              </span>
              <p>{message.text}</p>
              {message.role === "assistant" && message.id === latest?.turn_id && latest.follow_up_question && !message.text.includes(latest.follow_up_question) && (
                <p className="agent-chat-question">先确认：{latest.follow_up_question}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {gate && (
        <div className="agent-gate" role="status" aria-label="本轮暂不调用 AI 的原因" id="agent-gate-reason">
          <strong>{gate.title}</strong>
          <p>{gate.detail} 已输入的描述会保留，确认后可继续发送。</p>
          <button className="text-button" type="button" onClick={openContext}>展开作钓条件与安全确认</button>
        </div>
      )}
      {needsAnswer && (
        <div className="agent-pending-question" role="note" aria-label="这轮先补充的信息" ref={questionRef}>
          <strong>这轮先补充这一项</strong>
          <p>{needsAnswer}</p>
          {answerOptions.length > 0 && <div className="agent-answer-options">
            {answerOptions.map((answer) => <button key={answer} type="button" className="choice" disabled={busy}
              onClick={() => { setDraft(answer); document.getElementById("agent-message")?.focus(); }}>{answer}</button>)}
          </div>}
          <span>按真实情况选一句填入，或直接描述；点击后不会自动发送。</span>
        </div>
      )}
      <form onSubmit={send} className="agent-composer">
        <label htmlFor="agent-message" className="agent-input-label">
          现场描述或后续反馈
        </label>
        <textarea
          id="agent-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={1200}
          rows={3}
          disabled={busy}
          placeholder="例如：软饵试了半小时没口，感觉在退水。或：我换了位置，还是没口。"
          aria-describedby={gate ? "agent-gate-reason" : undefined}
        />
        {image && (
          <div className="agent-photo">
            <img src={image} alt="待分析的现场照片" />
            <button
              type="button"
              className="icon-button"
              aria-label="移除现场照片"
              onClick={() => setImage(null)}
            >
              <X size={16} />
            </button>
            <span><strong>这张照片会和文字一起分析</strong>仅供本轮推理，不保存原图</span>
          </div>
        )}
        <div className="agent-city">
          <label htmlFor="agent-city">
            城市<span>选填，仅用于查询天气</span>
          </label>
          <input
            id="agent-city"
            maxLength={48}
            value={session.city}
            disabled={busy}
            placeholder="例如：南充"
            onChange={(event) =>
              setSession((current) => ({
                ...current,
                city: event.target.value,
              }))
            }
          />
        </div>
        <div className="agent-compose-actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              void chooseImage(event.target.files?.[0]);
            }}
            aria-label="选择一张现场照片"
          />
          <button
            type="button"
            className="button secondary"
            onClick={() => fileRef.current?.click()}
            disabled={busy || imageBusy}
          >
            <Camera size={16} />
            {imageBusy ? "处理照片中…" : "添加现场照片"}
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={busy || imageBusy || !draft.trim()}
          >
            <Send size={15} />
            {busy ? "正在分析，请稍候…" : gate?.button ?? "发送给现场助手"}
          </button>
          {busy && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                controller.current?.abort();
                setBusy(false);
                setError("已取消本轮请求，未保存未完成的建议。");
              }}
            >
              取消
            </button>
          )}
        </div>
        <p className="hint">
          图片会在浏览器缩至最长边 1280
          px；请勿上传私密钓点或精确坐标。图片原图不写入记录。
        </p>
        <p className="agent-demo-photo"><a href="/demo-river.jpg" download="路探AI_公开河岸示例.jpg">下载河岸示例照片</a><span>公开示例，非本次现场 · <a href="/demo-river-source.txt" target="_blank" rel="noreferrer">查看来源</a></span></p>
      </form>
      {error && <Notice>{error}</Notice>}
      {latest && (
        <div
          className="agent-result"
          role="region"
          aria-label="现场助手结果"
          aria-live="polite"
        >
          <div className="result-top">
            <h3>当前建议</h3>
            <span className="source-label">{sourceLabel(latest)}</span>
          </div>
          <div className="agent-run-meta" aria-label="本轮执行情况">
            <span>耗时 {(latest.duration_ms / 1000).toFixed(1)} 秒</span>
            <span>{latest.model_calls} 次模型请求</span>
            <span>{latest.tool_events.length} 次工具调用</span>
          </div>
          <div className="agent-observations">
          {(latest.observations.visible.length > 0 || analyzedImage?.turnId === latest.turn_id) && <div className="agent-photo-analysis" role="region" aria-label="照片分析结果">
            {analyzedImage?.turnId === latest.turn_id && <img src={analyzedImage.url} alt="本轮提交的现场照片" />}
            <div>
              <h3><Eye size={16} /> 照片分析结果</h3>
              <span className="agent-vision-origin">{latestUserMessage?.had_image ? "本轮图片的模型解读" : "沿用此前照片的可见观察"} · 请核对</span>
              {latest.observations.visible.length > 0 ? <ul>{latest.observations.visible.map((text) => <li key={text}>{text}</li>)}</ul> : <p>本轮未获得可用的视觉分析，请以标明来源的建议为准。</p>}
              <p className="source-note">仅描述可见岸线、结构和水面；不能据此确认涨退水趋势、实际流速或水下鱼群。</p>
            </div>
          </div>}
          <div className="action-card">
            <div className="action-label">
              <span>1</span>先做这一项
            </div>
            <p>{latest.action}</p>
          </div>
          <div className="agent-explanation">
            <h3>{previousAction ? "为什么这轮这样调整" : "为什么"}</h3>
            <p>{latest.reason}</p>
            <h3>如何判断是否有效</h3>
            <p>{latest.check}</p>
          </div>
          <div className="agent-context-observations">
            <div>
              <h3>本轮使用的条件</h3>
              <ul><li>目标鱼：{latest.context.fish}（用户条件）</li><li>当前拟饵：{latest.context.lures.join("、") || "未知"}</li><li>搜索水层：{latest.context.layers}</li></ul>
              {latest.observations.visible.length === 0 && <p className="source-note">本轮没有新增可用的照片观察。</p>}
            </div>
            <div>
              <h3>用户描述</h3>
              <ul>
                {latest.observations.reported.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          </div>
          </div>
          <div className="agent-tools">
            <h3>
              <Wrench size={15} />
              本轮工具
            </h3>
            {latest.tool_events.length ? (
              latest.tool_events.map((tool) => (
                <div key={tool.id} className="agent-tool-event">
                  <strong>
                    {isHistoryTool(tool.name)
                      ? "读取本次尝试"
                      : "查询城市天气"}{" · "}
                    <span className={`agent-tool-status ${tool.status}`}>{tool.status === "ok" ? "已执行" : "未取得结果"}</span>
                  </strong>
                  <div className="agent-tool-id"><code>{tool.name}</code><span>{(tool.duration_ms / 1000).toFixed(1)} 秒</span></div>
                  <p>{tool.summary}</p>
                  {isWeatherTool(tool.name) &&
                    tool.result.status === "ok" && (
                      <WeatherSummary result={tool.result} />
                    )}
                  {isHistoryTool(tool.name) && tool.result.status === "ok" && <HistorySummary result={tool.result} />}
                </div>
              ))
            ) : (
              <p>本轮未调用工具。</p>
            )}
          </div>
          {previousAction && (
            <div className="agent-previous">
              <CheckCircle2 size={15} />
              <span>
                上一步反馈：{previousAction.feedback} · {previousAction.text}
              </span>
            </div>
          )}
          {!latestIsGated && !isInformationStep && <div className="agent-feedback" aria-label="当前建议的反馈">
            {(["已尝试", "有改善", "没有改善", "暂未尝试"] as const).map(
              (status) => (
                <button
                  key={status}
                  type="button"
                  disabled={busy}
                  aria-pressed={currentAction?.feedback === status}
                  className={`choice ${currentAction?.feedback === status ? "selected" : ""}`}
                  onClick={() => feedback(status)}
                >
                  {status === "没有改善" ? "没改善" : status}
                </button>
              ),
            )}
          </div>}
          {currentAction?.feedback === "没有改善" && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setDraft(
                  "刚才建议的动作已经实际试过，仍没有改善。请根据已尝试记录继续。",
                )
              }
            >
              补充无改善反馈，继续下一步 →
            </button>
          )}
          {latest.follow_up_question && (
            <p className="follow-up">需要确认：{latest.follow_up_question}</p>
          )}
          <details className="result-details">
            <summary>未知边界与提醒</summary>
            <ul>
              {latest.observations.unknown.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            {latest.warnings.map((text, index) => (
              <p className="source-note" key={index}>
                {text}
              </p>
            ))}
            <p className="source-note">
              {latest.agent_version} · {latest.duration_ms} ms ·{" "}
              {latest.model_calls} 次模型请求
            </p>
          </details>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              downloadJson(
                exportAgentSessions([session]),
                "路探AI_现场会话.json",
              )
            }
          >
            <Download size={14} />
            导出本次会话 JSON
          </button>
        </div>
      )}
      {!latest && !session.messages.length && (
        <p className="agent-empty">
          照片里的岸线，与描述中的退水，会分别标明依据；工具只显示实际执行的结果。
        </p>
      )}
    </section>
  );
}

function WeatherSummary({ result }: { result: Record<string, unknown> }) {
  const number = (value: unknown, unit: string) => typeof value === "number" && Number.isFinite(value) ? `${value} ${unit}` : "未提供";
  return (
    <div className="weather-summary">
      <strong>{typeof result.city === "string" ? result.city : "用户提供地区"}{typeof result.region === "string" ? ` · ${result.region}` : ""}</strong>
      <div className="agent-weather-metrics">
        <div><span>温度</span><strong>{number(result.temperature_c, "°C")}</strong></div>
        <div><span>降水</span><strong>{number(result.precipitation_mm, "mm")}</strong></div>
        <div><span>风速</span><strong>{number(result.wind_kmh, "km/h")}</strong></div>
      </div>
      <p>
        数据时刻 {typeof result.data_time === "string" ? result.data_time : "未提供"}（{typeof result.timezone === "string" ? result.timezone : "时区未提供"}）
      </p>
      {typeof result.retrieved_at === "string" && <p>查询时间 {result.retrieved_at}{result.cached === true ? " · 使用有效期内缓存" : ""}</p>}
      <p className="source-note">
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{" "}
        / GeoNames · CC BY 4.0 · 城市网格天气，不是河道水位
      </p>
    </div>
  );
}

function HistorySummary({ result }: { result: Record<string, unknown> }) {
  const actions = Array.isArray(result.actions) ? result.actions.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && typeof item.text === "string" && typeof item.feedback === "string") : [];
  return <div className="agent-history-summary">
    {actions.length ? <ul>{actions.slice(-4).map((action, index) => <li key={index}><span>{String(action.feedback)}</span><p>{String(action.text)}</p></li>)}</ul> : <p>本次会话还没有可回读的动作记录。</p>}
    <span className="source-note">读取范围：本次会话提交的动作与反馈，不是其他设备或服务器的个人记录。</span>
  </div>;
}
