import { useMemo, useState } from "react";
import { BookOpen, ChevronDown, Download, Search, Trash2 } from "lucide-react";
import { diagnosisSourceLabel } from "../../shared/presentation.ts";
import { AgentHistory } from "../components/AgentHistory.tsx";
import type { AgentSession } from "../../shared/agent.ts";
import { outcomeOptions, type TripRecord } from "../../shared/schema.ts";
import {
  ConfirmDialog,
  Notice,
  PageHeading,
  PanelHeading,
  PrimaryButton,
} from "../components/ui.tsx";
import {
  clearRecords,
  deleteRecord,
  downloadJson,
  exportRecords,
  getRawBackup,
  readRecords,
  recordSummary,
} from "../lib/records.ts";

export function HistoryPage({
  onStart,
  onReuse,
  onResumeAgent,
}: {
  onStart: () => void;
  onReuse: (record: TripRecord) => void;
  onResumeAgent: (session: AgentSession) => string | null;
}) {
  const [state, setState] = useState(readRecords);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("全部反馈");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const summary = recordSummary(state.records);
  const filtered = useMemo(
    () =>
      state.records.filter((record) => {
        const text = `${record.diagnosis.input.alias} ${record.diagnosis.input.fish} ${record.diagnosis.title} ${record.feedback.memo}`;
        return (
          text.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
          (filter === "全部反馈" || record.feedback.outcome === filter)
        );
      }),
    [state.records, search, filter],
  );
  function remove() {
    const result = confirm === "all" ? clearRecords() : deleteRecord(confirm!);
    setState(result);
    setConfirm(null);
    setMessage(
      result.error ??
        (confirm === "all"
          ? "已清空当前浏览器的全部路探 AI 记录。"
          : "已删除这条本机记录。"),
    );
  }
  return (
    <div className="page-enter">
      <PageHeading title="每次尝试，都有迹可循。">
        留住当时的条件、尝试和结果，让下一次出钓有自己的参照。
      </PageHeading>
      <AgentHistory onResume={onResumeAgent} />
      <div className="history-summary">
        <div>
          <strong>{summary.total}</strong>
          <span>本机记录</span>
        </div>
        <div>
          <strong>{summary.tried}</strong>
          <span>已尝试并反馈</span>
        </div>
        <p>
          “有改善”仅是个人主观反馈，
          <br />
          不能视为中鱼率或因果结论。
        </p>
      </div>
      <section className="panel history-panel">
        <div className="result-top">
          <PanelHeading title="我的尝试记录" />
          <span className="source-label">仅在当前浏览器</span>
        </div>
        {state.error && (
          <>
            <Notice>{state.error}</Notice>
            <button
              className="text-button"
              onClick={() => {
                const backup = getRawBackup();
                if (backup === null)
                  setMessage("无法读取原始备份，请检查浏览器的本地存储权限。");
                else downloadJson(backup, "路探AI_原始记录备份.json");
              }}
            >
              导出原始备份 <Download size={14} />
            </button>
          </>
        )}
        {state.records.length > 0 && (
          <div className="history-toolbar">
            <div className="search-input">
              <Search size={17} />
              <label className="sr-only" htmlFor="record-search">
                搜索本机记录
              </label>
              <input
                id="record-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索水域、目标鱼或备注"
                type="search"
              />
            </div>
            <div className="select-wrap">
              <label className="sr-only" htmlFor="outcome-filter">
                按反馈筛选
              </label>
              <select
                id="outcome-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option>全部反馈</option>
                {outcomeOptions.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
          </div>
        )}
        {filtered.length ? (
          <div className="record-list">
            {filtered.map((record) => (
              <RecordItem
                key={record.id}
                record={record}
                onDelete={() => setConfirm(record.id)}
                onReuse={() => onReuse(record)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              <BookOpen size={30} strokeWidth={1.3} />
            </div>
            <h3>
              {state.records.length
                ? "没有找到匹配的记录"
                : state.error
                  ? "本机记录暂时无法读取"
                  : "你的第一条经验，从这里开始。"}
            </h3>
            <p>
              {state.records.length
                ? "试着换个关键词，或选择其他反馈状态。"
                : "完成一次作钓诊断，记录实际反馈，就会出现在这里。"}
            </p>
            {state.records.length ? (
              <button
                className="button secondary"
                onClick={() => {
                  setSearch("");
                  setFilter("全部反馈");
                }}
              >
                重置筛选
              </button>
            ) : (
              <PrimaryButton onClick={onStart}>开始一次诊断</PrimaryButton>
            )}
          </div>
        )}
        <div className="history-bottom">
          <button
            className="button secondary"
            disabled={!state.records.length}
            onClick={() =>
              downloadJson(exportRecords(state.records), "路探AI_本机记录.json")
            }
          >
            <Download size={16} />
            导出全部 JSON
          </button>
          <button
            className="text-button danger-text"
            disabled={!state.records.length && !state.error}
            onClick={() => setConfirm("all")}
          >
            <Trash2 size={15} />
            清空全部记录
          </button>
        </div>
        <p className="hint" role="status" aria-live="polite">
          {message}
        </p>
      </section>
      <Notice neutral>
        你的水域备注与个人反馈留在本机。导出文件不附加
        GPS；删除操作仅针对当前浏览器，不代表其他设备的数据状态。
      </Notice>
      {confirm && (
        <ConfirmDialog
          title={confirm === "all" ? "清空全部本机记录？" : "删除这条记录？"}
          onCancel={() => setConfirm(null)}
          onConfirm={remove}
        >
          {confirm === "all"
            ? "这会删除当前浏览器里的全部路探 AI 记录，无法撤销。建议先导出 JSON 备份。"
            : "这条记录将从当前浏览器移除，无法撤销。"}
        </ConfirmDialog>
      )}
    </div>
  );
}

function RecordItem({
  record,
  onDelete,
  onReuse,
}: {
  record: TripRecord;
  onDelete: () => void;
  onReuse: () => void;
}) {
  const { diagnosis, feedback } = record;
  return (
    <article className="record-item">
      <div className="record-top">
        <time dateTime={record.created_at}>
          {new Date(record.created_at).toLocaleString("zh-CN", {
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        <span
          className={`outcome-tag ${feedback.outcome === "有改善" ? "positive" : ""}`}
        >
          {feedback.outcome}
        </span>
      </div>
      <h3>
        {diagnosis.input.alias || "未命名水域"}
        <span> / {diagnosis.input.fish}</span>
      </h3>
      <p className="record-title">{diagnosis.title}</p>
      <div className="record-meta">
        {diagnosis.input.water} · 水位{diagnosis.input.waterlevel} ·{" "}
        {diagnosis.input.duration}
      </div>
      {feedback.memo && <p className="record-memo">{feedback.memo}</p>}
      <details className="record-detail">
        <summary>查看当时的建议与依据</summary>
        <p>{diagnosis.priority_action}</p>
        <p className="muted">{diagnosis.rationale}</p>
        <ul>
          {diagnosis.unknowns.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <p className="source-note">
          {diagnosis.rule_version} · {diagnosisSourceLabel(diagnosis)}
        </p>
        <p className="source-note">{diagnosis.generation.output_boundary}</p>
      </details>
      <div className="record-actions">
        <button className="text-button" onClick={onReuse}>
          沿用条件，再诊断 →
        </button>
        <button className="text-button danger-text" onClick={onDelete}>
          <Trash2 size={14} />
          删除本条
        </button>
      </div>
    </article>
  );
}
