import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";

export function ChoiceField<T extends string>({
  label,
  options,
  value,
  onChange,
  labels,
  hint,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labels?: Partial<Record<T, string>>;
  hint?: string;
}) {
  return (
    <fieldset className="choice-field">
      <legend>{label}</legend>
      <div className="choices">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`choice ${value === option ? "selected" : ""}`}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {value === option && <Check size={14} aria-hidden="true" />}
            {labels?.[option] ?? option}
          </button>
        ))}
      </div>
      {hint && <p className="hint">{hint}</p>}
    </fieldset>
  );
}

export function MultiChoice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: readonly T[];
  onChange: (value: T[]) => void;
}) {
  return (
    <fieldset className="choice-field">
      <legend>
        {label}
        <span className="optional">可多选</span>
      </legend>
      <div className="choices">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value.includes(option)}
            className={`choice ${value.includes(option) ? "selected" : ""}`}
            onClick={() =>
              onChange(
                value.includes(option)
                  ? value.filter((item) => item !== option)
                  : [...value, option],
              )
            }
          >
            {value.includes(option) && <Check size={14} aria-hidden="true" />}
            {option}
          </button>
        ))}
      </div>
      <p className="hint">尚未选择也可以继续，结果会注明缺少这项信息。</p>
    </fieldset>
  );
}

export function PrimaryButton({
  children,
  busy,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  busy?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      className="button primary"
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
    >
      {busy ? (
        <LoaderCircle className="spin" size={17} aria-hidden="true" />
      ) : null}
      {children}
      {!busy && <ArrowRight size={17} aria-hidden="true" />}
    </button>
  );
}

export function Notice({
  children,
  danger = false,
  neutral = false,
}: {
  children: ReactNode;
  danger?: boolean;
  neutral?: boolean;
}) {
  return (
    <div
      className={`notice ${danger ? "danger" : ""} ${neutral ? "neutral-notice" : ""}`}
    >
      {neutral ? (
        <ShieldCheck size={18} aria-hidden="true" />
      ) : (
        <AlertTriangle size={18} aria-hidden="true" />
      )}
      <div>{children}</div>
    </div>
  );
}

export function PageHeading({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <header className="page-heading">
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}

export function PanelHeading({
  number,
  title,
  children,
}: {
  number?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      {number && <span className="section-number">{number}</span>}
      <div>
        <h2>{title}</h2>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}

export function ResultAnchor({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  }, []);
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={title}
      className={`panel result-panel ${className}`}
    >
      {children}
    </section>
  );
}

export function Stepper({
  step,
  onSelect,
}: {
  step: number;
  onSelect: (step: number) => void;
}) {
  const labels = ["现场水情", "搜索记录", "鱼口反馈"];
  return (
    <nav className="stepper" aria-label="诊断步骤">
      {labels.map((label, index) => (
        <div key={label} className="step-wrap">
          <button
            className={`step ${step === index ? "current" : ""} ${step > index ? "complete" : ""}`}
            onClick={() => onSelect(index)}
            aria-current={step === index ? "step" : undefined}
          >
            <span>
              {step > index ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                index + 1
              )}
            </span>
            {label}
          </button>
          {index < 2 && (
            <ChevronRight
              size={14}
              className="step-divider"
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </nav>
  );
}

export function ConfirmDialog({
  title,
  children,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={id}
      onCancel={onCancel}
      onClick={(event) => {
        if (event.target === ref.current) onCancel();
      }}
    >
      <div className="dialog-top">
        <div className="dialog-icon">
          <AlertTriangle size={23} />
        </div>
        <button
          className="icon-button"
          onClick={onCancel}
          aria-label="关闭确认框"
        >
          <X size={19} />
        </button>
      </div>
      <h2 id={id}>{title}</h2>
      <p>{children}</p>
      <div className="actions dialog-actions">
        <button className="button secondary" onClick={onCancel} autoFocus>
          取消
        </button>
        <button className="button destructive" onClick={onConfirm}>
          确认删除
        </button>
      </div>
    </dialog>
  );
}
