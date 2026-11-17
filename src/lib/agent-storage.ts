import {
  agentStoreSchema,
  newAgentSession,
  type AgentSession,
} from "../../shared/agent.ts";
import type { DiagnosisInput } from "../../shared/schema.ts";

export const AGENT_SESSIONS_KEY = "lutan_agent_sessions_v1";
type AgentState = {
  sessions: AgentSession[];
  current_id: string | null;
  error: string | null;
};
export function readAgentSessions(): AgentState {
  try {
    const raw = localStorage.getItem(AGENT_SESSIONS_KEY);
    if (!raw) return { sessions: [], current_id: null, error: null };
    const state = agentStoreSchema.parse(JSON.parse(raw));
    return {
      sessions: state.sessions,
      current_id: state.current_id,
      error: null,
    };
  } catch {
    return {
      sessions: [],
      current_id: null,
      error:
        "现场会话读取失败，原始数据未覆盖；仍可使用旧版诊断和导出当前会话。",
    };
  }
}
function write(state: Omit<AgentState, "error">): AgentState {
  try {
    const data = agentStoreSchema.parse({ schema_version: 1, ...state });
    localStorage.setItem(AGENT_SESSIONS_KEY, JSON.stringify(data));
    return {
      sessions: data.sessions,
      current_id: data.current_id,
      error: null,
    };
  } catch {
    return {
      ...readAgentSessions(),
      error: "会话保存失败，请导出本次会话备份。图片原图不会保存。",
    };
  }
}
export function saveAgentSession(session: AgentSession): AgentState {
  const current = readAgentSessions();
  if (current.error) return current;
  const sessions = [
    session,
    ...current.sessions.filter((item) => item.id !== session.id),
  ];
  if (sessions.length > 20)
    return {
      ...current,
      error: "已达到 20 个会话上限，请先导出并删除部分会话，再新建。",
    };
  return write({ sessions, current_id: session.id });
}
export function selectAgentSession(id: string): AgentState {
  const current = readAgentSessions();
  if (current.error) return current;
  if (!current.sessions.some((item) => item.id === id))
    return { ...current, error: "会话不存在或已删除。" };
  return write({ sessions: current.sessions, current_id: id });
}
export function deleteAgentSession(id: string): AgentState {
  const current = readAgentSessions();
  if (current.error) return current;
  const sessions = current.sessions.filter((item) => item.id !== id);
  return write({
    sessions,
    current_id:
      current.current_id === id
        ? (sessions[0]?.id ?? null)
        : current.current_id,
  });
}
export function clearAgentSessions(): AgentState {
  try {
    localStorage.removeItem(AGENT_SESSIONS_KEY);
    return { sessions: [], current_id: null, error: null };
  } catch {
    return {
      ...readAgentSessions(),
      error: "浏览器拒绝删除现场会话，记录仍保留。",
    };
  }
}
export function loadCurrentAgentSession(context: DiagnosisInput): AgentSession {
  const state = readAgentSessions();
  return (
    state.sessions.find((item) => item.id === state.current_id) ??
    newAgentSession(context)
  );
}
export function exportAgentSessions(sessions: AgentSession[]) {
  return {
    product: "路探 AI",
    agent_version: "lutan-agent-1.2.0",
    schema_version: 1,
    exported_at: new Date().toISOString(),
    note: "会话来自用户输入和已标记的模型/规则结果，不含图片原图；工具事件仅记录实际执行。",
    sessions,
  };
}
