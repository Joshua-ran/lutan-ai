import {
  ArrowRight,
  ClipboardCheck,
  CloudOff,
  Fish,
  ShieldQuestion,
} from "lucide-react";
import {
  fishOptions,
  legalityOptions,
  levelOptions,
  rainOptions,
  waterOptions,
  type DiagnosisInput,
  type Pretrip,
  type Trip,
} from "../../shared/schema.ts";
import {
  ChoiceField,
  Notice,
  PanelHeading,
  PrimaryButton,
  ResultAnchor,
} from "../components/ui.tsx";
import { ProductIntro } from "../components/ProductIntro.tsx";

export const levelLabels = {
  稳定: "相对稳定",
  涨水: "近期涨水",
  退水: "近期退水",
  急变: "明显急涨 / 急流",
  未知: "还不清楚",
};
export const legalLabels = {
  未知: "尚未核实",
  用户已核实允许: "我已核对官方公告，允许",
  禁止垂钓: "已知禁止垂钓",
};
export const rainLabels = { 有: "观察到降雨", 无: "未观察到", 未知: "不知道" };

export function PretripPage({
  input,
  onChange,
  result,
  busy,
  onGenerate,
  onDiagnose,
  onRevise,
}: {
  input: Trip;
  onChange: <K extends keyof DiagnosisInput>(
    key: K,
    value: DiagnosisInput[K],
  ) => void;
  result: Pretrip | null;
  busy: boolean;
  onGenerate: () => void;
  onDiagnose: () => void;
  onRevise: () => void;
}) {
  return (
    <div className="page-enter">
      <ProductIntro onStart={onDiagnose} />
      <section className="panel">
        <PanelHeading number="01" title="创建出钓计划">
          不索取 GPS，也不需要公开自己的精确标点。
        </PanelHeading>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onGenerate();
          }}
        >
          <div className="dual">
            <ChoiceField
              label="准备去什么水域？"
              options={waterOptions}
              value={input.water}
              onChange={(value) => onChange("water", value)}
            />
            <ChoiceField
              label="这次的目标鱼"
              options={fishOptions}
              value={input.fish}
              onChange={(value) => onChange("fish", value)}
            />
          </div>
          <div className="text-field">
            <label htmlFor="water-alias">
              水域备注<span className="optional">选填</span>
            </label>
            <input
              id="water-alias"
              maxLength={36}
              value={input.alias}
              onChange={(event) => onChange("alias", event.target.value)}
              placeholder="例如：常去的小河道"
              autoComplete="off"
              aria-describedby="alias-hint"
            />
            <p className="hint" id="alias-hint">
              只保存在本机，请勿填写精确坐标或他人的私密钓点。
            </p>
          </div>
          <ChoiceField
            label="你目前了解的水情"
            options={levelOptions}
            value={input.waterlevel}
            labels={levelLabels}
            onChange={(value) => onChange("waterlevel", value)}
            hint="来自你的观察，不作为水文监测数据。不了解时请保留“还不清楚”。"
          />
          <ChoiceField
            label="是否观察到上游近期降雨？"
            options={rainOptions}
            value={input.rain}
            labels={rainLabels}
            onChange={(value) => onChange("rain", value)}
          />
          <ChoiceField
            label="这个河段是否允许垂钓？"
            options={legalityOptions}
            value={input.legality}
            labels={legalLabels}
            onChange={(value) => onChange("legality", value)}
            hint="请按适用日期、河段和作钓方式核对官方公告；未核实前暂停作钓。"
          />
          {input.waterlevel === "急变" && (
            <Notice danger>
              观察到急涨水或急流时，先离开危险岸边，在安全位置核对官方预警。
            </Notice>
          )}
          <div className="form-bottom">
            <PrimaryButton type="submit" busy={busy}>
              {busy ? "正在整理参考信息…" : "生成出钓参考卡"}
            </PrimaryButton>
            <span className="quiet-note">
              <ClipboardCheck size={14} />
              只整理依据，不预测鱼口
            </span>
          </div>
        </form>
      </section>
      {result && (
        <ResultAnchor
          title="你的出钓参考卡"
          key={`${result.source}-${JSON.stringify(result.input)}`}
        >
          <div className="result-top">
            <PanelHeading title="你的出钓参考卡" />
            <span className="source-label">
              {result.source === "server_rules"
                ? "服务端规则"
                : "本机规则 · 服务不可用时降级"}
            </span>
          </div>
          <div className="tags">
            <span>{input.alias || "未命名水域"}</span>
            <span>{input.water}</span>
            <span>目标：{input.fish}</span>
          </div>
          <div className="evidence-strip">
            <div>
              <Fish size={18} />
              <span>
                目标鱼是否存在<strong>证据不足</strong>
              </span>
            </div>
            <div>
              <CloudOff size={18} />
              <span>
                实时水位 / 天气<strong>未接入</strong>
              </span>
            </div>
            <div>
              <ShieldQuestion size={18} />
              <span>
                合法垂钓状态
                <strong>
                  {input.legality === "用户已核实允许"
                    ? "用户自述已核实"
                    : input.legality === "禁止垂钓"
                      ? "用户报告禁钓"
                      : "待官方核实"}
                </strong>
              </span>
            </div>
          </div>
          <div className="evidence-sections">
            <div className="evidence-section">
              <h3>
                <span className="tiny-dot" />
                你的输入
              </h3>
              <ul>
                {result.known.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
            <div className="evidence-section">
              <h3>
                <span className="tiny-dot muted-dot" />
                仍然未知
              </h3>
              <ul>
                {result.unknowns.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
            <div className="evidence-section">
              <h3>
                <span className="tiny-dot amber-dot" />
                建议核实
              </h3>
              <ul>
                {result.verification.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="preparation">
            <h3>这次先准备什么</h3>
            <p>{result.preparation}</p>
          </div>
          <Notice
            danger={result.risk === "danger" || result.risk === "restricted"}
          >
            {result.notice}
          </Notice>
          <div className="actions">
            <PrimaryButton onClick={onDiagnose}>开始作钓诊断</PrimaryButton>
            <button className="button secondary" onClick={onRevise}>
              修改计划
            </button>
          </div>
        </ResultAnchor>
      )}
      {!result && (
        <div className="intro-note">
          <ShieldQuestion size={20} strokeWidth={1.5} />
          <div>
            <h3>没有记录，不等于没有鱼。</h3>
            <p>
              暂未接入目标水域的物种、天气及水文资料。我们会明确展示数据缺口，不给没有依据的鱼情分数。
            </p>
          </div>
          <ArrowRight size={17} />
        </div>
      )}
    </div>
  );
}
