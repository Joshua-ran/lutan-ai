import { useState } from "react";
import { ArrowLeft, ArrowRight, Info, RefreshCw } from "lucide-react";
import {
  adjustOptions,
  clarityOptions,
  durationOptions,
  flowOptions,
  layerOptions,
  legalityOptions,
  levelOptions,
  lureOptions,
  observationOptions,
  rainOptions,
  signalOptions,
  structureOptions,
  type Diagnosis,
  type DiagnosisInput,
} from "../../shared/schema.ts";
import {
  ChoiceField,
  MultiChoice,
  Notice,
  PageHeading,
  PanelHeading,
  PrimaryButton,
  ResultAnchor,
  Stepper,
} from "../components/ui.tsx";
import { legalLabels, levelLabels, rainLabels } from "./PretripPage.tsx";
import { FeedbackForm } from "./FeedbackForm.tsx";
import { AgentAssistant } from "../components/AgentAssistant.tsx";
import {
  diagnosisFallbackNotice,
  diagnosisSourceLabel,
} from "../../shared/presentation.ts";

export function DiagnosisPage({
  input,
  onChange,
  result,
  busy,
  onGenerate,
  onPretrip,
  onRevise,
  onHistory,
  onAgentContext,
}: {
  input: DiagnosisInput;
  onChange: <K extends keyof DiagnosisInput>(
    key: K,
    value: DiagnosisInput[K],
  ) => void;
  result: Diagnosis | null;
  busy: boolean;
  onGenerate: () => void;
  onPretrip: () => void;
  onRevise: () => void;
  onHistory: () => void;
  onAgentContext: (context: DiagnosisInput) => void;
}) {
  const [step, setStep] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const change = <K extends keyof DiagnosisInput>(
    key: K,
    value: DiagnosisInput[K],
  ) => {
    setFeedbackOpen(false);
    onChange(key, value);
  };
  return (
    <div className="page-enter">
      <PageHeading title="没口了？先排查一个变量。">
        沿用出钓计划，补充现场观察。根据你已经尝试的动作，整理下一步。
      </PageHeading>
      <AgentAssistant input={input} onContextChange={onAgentContext} />
      <div className="legacy-form-entry">也可以沿用下方的表单诊断</div>
      <section className="panel diagnosis-form">
        <div className="result-top">
          <PanelHeading number="02" title="当前作钓情况" />
          <button className="text-button" onClick={onPretrip}>
            修改出钓计划 <ArrowRight size={14} />
          </button>
        </div>
        <div className="context-bar">
          <span>{input.alias || "未命名水域"}</span>
          <span>{input.water}</span>
          <span>目标：{input.fish}</span>
          <span>水位：{input.waterlevel}</span>
        </div>
        <Stepper
          step={step}
          onSelect={(value) => {
            setStep(value);
            onRevise();
            setFeedbackOpen(false);
          }}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setFeedbackOpen(false);
            onGenerate();
          }}
        >
          <div className="step-content" key={step}>
            {step === 0 && (
              <>
                <div className="dual">
                  <ChoiceField
                    label="当前水位（现场观察）"
                    options={levelOptions}
                    value={input.waterlevel}
                    labels={levelLabels}
                    onChange={(value) => change("waterlevel", value)}
                  />
                  <ChoiceField
                    label="当前水流"
                    options={flowOptions}
                    value={input.flow}
                    labels={{ 很急: "明显很急", 未知: "不确定" }}
                    onChange={(value) => change("flow", value)}
                  />
                </div>
                <div className="dual">
                  <ChoiceField
                    label="现场水色"
                    options={clarityOptions}
                    value={input.clarity}
                    labels={{ 未知: "不确定" }}
                    onChange={(value) => change("clarity", value)}
                  />
                  <ChoiceField
                    label="上游近期降雨"
                    options={rainOptions}
                    value={input.rain}
                    labels={rainLabels}
                    onChange={(value) => change("rain", value)}
                  />
                </div>
                <ChoiceField
                  label="正在搜索的结构"
                  options={structureOptions}
                  value={input.structure}
                  onChange={(value) => change("structure", value)}
                />
                <ChoiceField
                  label="这个河段是否允许垂钓？"
                  options={legalityOptions}
                  value={input.legality}
                  labels={legalLabels}
                  onChange={(value) => change("legality", value)}
                />
              </>
            )}
            {step === 1 && (
              <>
                <ChoiceField
                  label="已经搜索多久？"
                  options={durationOptions}
                  value={input.duration}
                  onChange={(value) => change("duration", value)}
                />
                <MultiChoice
                  label="已尝试的拟饵"
                  options={lureOptions}
                  value={input.lures}
                  onChange={(value) => change("lures", value)}
                />
                <ChoiceField
                  label="已经搜索过的水层"
                  options={layerOptions}
                  value={input.layers}
                  onChange={(value) => change("layers", value)}
                />
                <ChoiceField
                  label="已经调整过什么？"
                  options={adjustOptions}
                  value={input.adjust}
                  labels={{
                    没有: "还没有调整",
                    手法: "调整过手法",
                    换位: "换过附近位置",
                    都试过: "手法和换位都试过",
                  }}
                  onChange={(value) => change("adjust", value)}
                />
              </>
            )}
            {step === 2 && (
              <>
                <ChoiceField
                  label="实际观察到的鱼口"
                  options={signalOptions}
                  value={input.signal}
                  labels={{
                    无口: "完全没口",
                    跟饵: "有跟饵但不攻击",
                    疑似触碰: "疑似咬口但未中鱼",
                    不清楚: "分辨不清",
                  }}
                  onChange={(value) => change("signal", value)}
                />
                <ChoiceField
                  label="其他现场观察"
                  options={observationOptions}
                  value={input.observed}
                  onChange={(value) => change("observed", value)}
                />
                <div className="input-summary">
                  <h3>本次输入摘要</h3>
                  <p>
                    {input.structure} · {input.duration} ·{" "}
                    {input.lures.join("、") || "拟饵未选"} · {input.layers}
                  </p>
                  <p>
                    已调整：{input.adjust} · 水色：{input.clarity} · 合法性：
                    {input.legality}
                  </p>
                </div>
              </>
            )}
          </div>
          {(input.waterlevel === "急变" || input.flow === "很急") && (
            <Notice danger>
              已报告急涨水或明显急流，请先离开危险岸边。可以直接生成安全提醒，无需填完所有步骤。
            </Notice>
          )}
          {input.legality === "禁止垂钓" && (
            <Notice danger>
              当前河段被标记为禁止垂钓，请停止作钓并遵守管理规定。
            </Notice>
          )}
          <div className="form-bottom step-actions">
            <div className="actions no-margin">
              {step > 0 && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft size={16} />
                  上一步
                </button>
              )}
              {step < 2 && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => setStep(step + 1)}
                >
                  下一步 <ArrowRight size={16} />
                </button>
              )}
              {step === 2 && (
                <PrimaryButton type="submit" busy={busy}>
                  {busy ? "正在整理建议…" : "生成下一步建议"}
                </PrimaryButton>
              )}
            </div>
            {step < 2 ? (
              <button type="submit" className="text-button" disabled={busy}>
                {busy ? "正在整理…" : "按已有信息直接诊断"}{" "}
                <ArrowRight size={14} />
              </button>
            ) : (
              <span className="quiet-note">
                <Info size={14} />
                未知项会如实保留
              </span>
            )}
          </div>
        </form>
      </section>
      {result && (
        <ResultAnchor title="诊断结果" key={result.id}>
          <div className="result-top">
            <span className="result-kicker">本次诊断</span>
            <span className="source-label">{diagnosisSourceLabel(result)}</span>
          </div>
          <h2 className="diagnosis-title">{result.title}</h2>
          {diagnosisFallbackNotice(result) && (
            <Notice neutral>{diagnosisFallbackNotice(result)}</Notice>
          )}
          <div
            className={`action-card ${result.risk !== "normal" ? "action-caution" : ""}`}
          >
            <div className="action-label">
              <span>1</span>建议先做这一项
            </div>
            <p>{result.priority_action}</p>
          </div>
          <div className="rationale">
            <h3>为什么是这一步？</h3>
            <p>{result.rationale}</p>
          </div>
          {result.follow_up_question && (
            <div className="follow-up">
              <Info size={17} />
              <span>还需要确认：{result.follow_up_question}</span>
            </div>
          )}
          <details className="result-details">
            <summary>
              查看输入依据与未知边界<span>用户观察 ≠ 实时监测</span>
            </summary>
            <h3>你提供的观察</h3>
            <ul>
              {result.observed_facts.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <h3>目前无法确认</h3>
            <ul>
              {result.unknowns.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <p className="source-note">
              规则版本：{result.rule_version}
              。建议用于验证排查顺序，不保证鱼口或渔获。
            </p>
            <p className="source-note">{result.generation.output_boundary}</p>
          </details>
          <Notice
            danger={result.risk === "danger" || result.risk === "restricted"}
          >
            {result.safety_or_legality_notice}
          </Notice>
          <div className="actions">
            <PrimaryButton onClick={() => setFeedbackOpen(true)}>
              记录结果反馈
            </PrimaryButton>
            <button
              className="button secondary"
              onClick={() => {
                onRevise();
                setFeedbackOpen(false);
              }}
            >
              <RefreshCw size={15} />
              修改输入
            </button>
          </div>
        </ResultAnchor>
      )}
      {result && feedbackOpen && (
        <FeedbackForm
          key={result.id}
          diagnosis={result}
          onHistory={onHistory}
        />
      )}
    </div>
  );
}
