import { useState } from "react";
import { CheckCircle2, Download } from "lucide-react";
import {
  outcomeOptions,
  type Diagnosis,
  type Feedback,
} from "../../shared/schema.ts";
import {
  ChoiceField,
  Notice,
  PanelHeading,
  PrimaryButton,
  ResultAnchor,
} from "../components/ui.tsx";
import {
  createRecord,
  downloadJson,
  exportRecords,
  saveRecord,
} from "../lib/records.ts";

export function FeedbackForm({
  diagnosis,
  onHistory,
}: {
  diagnosis: Diagnosis;
  onHistory: () => void;
}) {
  const [feedback, setFeedback] = useState<Feedback>({
    outcome: "暂未尝试",
    memo: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  function save() {
    const state = saveRecord(createRecord(diagnosis, feedback));
    setSaved(!state.error);
    setMessage(
      state.error ??
        "已保存到当前浏览器。同一次诊断重复保存会更新反馈，不会生成重复记录。",
    );
  }
  return (
    <ResultAnchor title="记录结果反馈" className="feedback-panel">
      <PanelHeading number="03" title="这条建议，实际怎么样？">
        无改善也值得记录。尚未尝试时，请如实保留状态。
      </PanelHeading>
      <ChoiceField
        label="实际结果"
        options={outcomeOptions}
        value={feedback.outcome}
        onChange={(outcome) => {
          setFeedback({ ...feedback, outcome });
          setSaved(false);
          setMessage(null);
        }}
      />
      <div className="text-field">
        <label htmlFor="feedback-note">
          简短备注<span className="optional">选填</span>
        </label>
        <textarea
          id="feedback-note"
          rows={3}
          maxLength={240}
          value={feedback.memo}
          onChange={(event) => {
            setFeedback({ ...feedback, memo: event.target.value });
            setSaved(false);
            setMessage(null);
          }}
          placeholder="例如：比较了两个水层，仍然没口。"
          aria-describedby="feedback-note-count"
        />
        <p className="hint text-right" id="feedback-note-count">
          {feedback.memo.length} / 240
        </p>
      </div>
      <div className="actions">
        <PrimaryButton onClick={save}>
          {saved ? "更新本机记录" : "保存到本机记录"}
        </PrimaryButton>
        <button
          className="button secondary"
          onClick={() =>
            downloadJson(
              exportRecords([createRecord(diagnosis, feedback)]),
              "路探AI_本次诊断.json",
            )
          }
        >
          <Download size={16} />
          导出本次 JSON
        </button>
      </div>
      <div role="status" aria-live="polite">
        {message &&
          (saved ? (
            <div className="save-success">
              <CheckCircle2 size={18} />
              <span>{message}</span>
              <button className="text-button" onClick={onHistory}>
                查看记录 →
              </button>
            </div>
          ) : (
            <Notice>{message}</Notice>
          ))}
      </div>
      <p className="source-note">
        仅保存到当前浏览器，不上传记录。清理浏览器数据会移除记录，建议定期导出。个人反馈不等于渔获提升。
      </p>
    </ResultAnchor>
  );
}
