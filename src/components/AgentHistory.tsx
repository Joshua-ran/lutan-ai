import { useState } from "react";
import { Download, MessageCircle, Trash2 } from "lucide-react";
import type { AgentSession } from "../../shared/agent.ts";
import {
  clearAgentSessions,
  deleteAgentSession,
  exportAgentSessions,
  readAgentSessions,
} from "../lib/agent-storage.ts";
import { downloadJson } from "../lib/records.ts";
import { ConfirmDialog, Notice, PanelHeading } from "./ui.tsx";

export function AgentHistory({
  onResume,
}: {
  onResume: (session: AgentSession) => string | null;
}) {
  const [state, setState] = useState(readAgentSessions);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const remove = () => {
    const result =
      confirm === "all" ? clearAgentSessions() : deleteAgentSession(confirm!);
    setState(result);
    setConfirm(null);
    setMessage(result.error ?? "已删除选定的本机现场会话。");
  };
  return (
    <section className="panel agent-history" aria-label="现场助手会话记录">
      <div className="result-top">
        <PanelHeading title="现场助手会话" />
        <span className="source-label">
          {state.sessions.length} / 20 · 不保存原图
        </span>
      </div>
      {state.error && <Notice>{state.error}</Notice>}
      {!state.sessions.length ? (
        <p className="agent-empty">
          <MessageCircle size={18} />
          在现场助手完成对话后，会话和反馈会保存在这里。
        </p>
      ) : (
        state.sessions.map((session) => (
          <article className="record-item" key={session.id}>
            <div className="record-top">
              <time dateTime={session.updated_at}>
                {new Date(session.updated_at).toLocaleString("zh-CN")}
              </time>
              <span className="outcome-tag">
                {session.actions.length} 条动作
              </span>
            </div>
            <h3>
              {session.messages
                .find((item) => item.role === "user")
                ?.text.slice(0, 48) || "新建现场会话"}
            </h3>
            <p className="record-title">
              {session.last_result?.action || "尚未完成一轮建议"}
            </p>
            <p className="source-note">
              {session.last_result?.answer_source === "agent"
                ? `Agent · ${session.last_result.model_name}`
                : "规则建议或未完成"}{" "}
              · 最近反馈：{session.actions.at(-1)?.feedback || "暂无"}
            </p>
            <div className="record-actions">
              <button
                className="text-button"
                onClick={() => {
                  const error = onResume(session);
                  if (error) setMessage(error);
                }}
              >
                恢复本次会话 →
              </button>
              <button
                className="text-button danger-text"
                onClick={() => setConfirm(session.id)}
              >
                <Trash2 size={14} />
                删除会话
              </button>
            </div>
          </article>
        ))
      )}
      <div className="history-bottom">
        <button
          className="button secondary"
          disabled={!state.sessions.length}
          onClick={() =>
            downloadJson(
              exportAgentSessions(state.sessions),
              "路探AI_现场会话记录.json",
            )
          }
        >
          <Download size={15} />
          导出现场会话
        </button>
        <button
          className="text-button danger-text"
          disabled={!state.sessions.length && !state.error}
          onClick={() => setConfirm("all")}
        >
          清空现场会话
        </button>
      </div>
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      {confirm && (
        <ConfirmDialog
          title={
            confirm === "all" ? "清空全部现场会话？" : "删除这个现场会话？"
          }
          onCancel={() => setConfirm(null)}
          onConfirm={remove}
        >
          仅删除当前浏览器的现场会话，无法撤销；原有表单诊断记录单独保留。
        </ConfirmDialog>
      )}
    </section>
  );
}
