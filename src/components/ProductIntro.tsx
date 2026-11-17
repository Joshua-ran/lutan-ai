import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Compass, MessageCircle, Play, Waves, X } from "lucide-react";
import { diagnose } from "../../shared/engine.ts";
import { defaultInput, type DiagnosisInput } from "../../shared/schema.ts";
import { PageHeading } from "./ui.tsx";

const examples: { label: string; message: string; patch: Partial<DiagnosisInput> }[] = [
  { label: "有跟饵，没咬", message: "米诺试了半小时，看到有跟饵，但还没有咬口。", patch: { signal: "跟饵", lures: ["米诺"] } },
  { label: "试了很久没口", message: "多个拟饵和水层都试过了，超过 40 分钟，手法、换位都试过，仍然没口。", patch: { signal: "无口", duration: "40 分钟以上", layers: "多个水层", lures: ["软饵", "米诺"], adjust: "都试过" } },
  { label: "水情突然变化", message: "突然发现水位急涨，水流也明显变急了。", patch: { waterlevel: "急变", flow: "很急" } },
];

function ExampleDialog({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(0);
  const example = examples[selected];
  const result = diagnose({ ...defaultInput, alias: "", legality: "用户已核实允许", waterlevel: "稳定", flow: "普通", duration: "20–40 分钟", layers: "主要一个水层", ...example.patch }, "local_rules");
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return <dialog ref={ref} className="experience-dialog" aria-labelledby="experience-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="experience-header">
      <span className="eyebrow">30 秒了解路探 AI</span>
      <button className="icon-button" aria-label="关闭使用示例" onClick={onClose}><X size={20} /></button>
    </div>
    <h2 id="experience-title">一次只验证一个改变。</h2>
    <p className="experience-disclaimer">虚构场景 · 使用当前规则实时生成，不调用模型，也不写入你的记录。示例中的许可为假设条件。</p>
    <div className="experience-choices" aria-label="选择体验场景">
      {examples.map((item, index) => <button key={item.label} className={`choice ${selected === index ? "selected" : ""}`} aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.label}</button>)}
    </div>
    <div className="experience-input"><MessageCircle size={18} /><p>{example.message}</p></div>
    <div className="experience-result" aria-live="polite">
      <div className="experience-source"><span>当前规则输出</span><span>{result.risk === "normal" ? "普通场景" : "安全优先"}</span></div>
      <h3>{result.priority_action}</h3>
      <p>{result.rationale}</p>
      {result.follow_up_question && <p className="experience-question">先补充：{result.follow_up_question}</p>}
    </div>
    <div className="experience-next"><Check size={16} /><span>实际尝试后反馈结果，现场助手会接着排查；没有改善也有记录价值。</span></div>
    <button className="button primary" onClick={onStart}>进入现场助手 <ArrowRight size={16} /></button>
    <p className="hint">进入后按真实情况确认许可与水情；示例条件不会带入。</p>
  </dialog>;
}

export function ProductIntro({ onStart }: { onStart: () => void }) {
  const [exampleOpen, setExampleOpen] = useState(false);
  return <>
    <section className="product-intro" aria-label="认识路探 AI">
      <div className="product-intro-copy">
        <span className="product-intro-tag"><Waves size={13} /> 为路亚现场的下一步而做</span>
        <PageHeading title="出发前，先把信息理清楚。">没口的时候，少一点盲试。描述现场、确认下一步，再把每次尝试留成经验。</PageHeading>
        <div className="product-intro-actions">
          <button className="button primary" onClick={onStart}>直接进入现场助手 <ArrowRight size={16} /></button>
          <button className="button secondary" onClick={() => setExampleOpen(true)}><Play size={14} /> 先看使用示例</button>
        </div>
        <p className="product-intro-note">无需注册 · 本机保存 · 每条建议标明来源</p>
      </div>
      <div className="product-intro-art" aria-hidden="true">
        <div className="water-contour contour-one" /><div className="water-contour contour-two" /><div className="water-contour contour-three" />
        <Compass className="intro-compass" size={54} strokeWidth={1} />
        <span className="intro-coordinate">OBSERVE / TRY / LEARN</span>
        <div className="intro-field-card"><span className="intro-field-dot" /><span>下一步，有迹可循</span><ArrowRight size={16} /></div>
      </div>
    </section>
    <ol className="product-journey" aria-label="使用的三个步骤">
      <li><span>01</span><div><strong>说说现场</strong><small>描述观察，保留未知</small></div></li>
      <li><span>02</span><div><strong>先做一项</strong><small>安全确认后，给出下一步</small></div></li>
      <li><span>03</span><div><strong>留下经验</strong><small>反馈结果，下次接着用</small></div></li>
    </ol>
    {exampleOpen && <ExampleDialog onClose={() => setExampleOpen(false)} onStart={() => { setExampleOpen(false); onStart(); }} />}
  </>;
}
