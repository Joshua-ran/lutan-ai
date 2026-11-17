import {
  ArrowUpRight,
  BookOpen,
  Compass,
  Fish,
  MapPinned,
  ShieldCheck,
  Waves,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

export type Page = "pretrip" | "diagnose" | "history";
const navigation: {
  page: Page;
  label: string;
  short: string;
  icon: LucideIcon;
  number: string;
}[] = [
  {
    page: "pretrip",
    label: "出钓前参考",
    short: "出钓前",
    icon: Compass,
    number: "01",
  },
  {
    page: "diagnose",
    label: "正在作钓",
    short: "正在作钓",
    icon: Fish,
    number: "02",
  },
  {
    page: "history",
    label: "我的记录",
    short: "我的记录",
    icon: BookOpen,
    number: "03",
  },
];

export function Shell({
  page,
  onNavigate,
  children,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  children: ReactNode;
}) {
  return (
    <>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <div className="layout">
        <aside className="sidebar">
          <a
            href="#pretrip"
            className="brand"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("pretrip");
            }}
            aria-label="路探 AI 首页"
          >
            <span className="brand-mark">
              <Waves size={25} strokeWidth={2.3} />
            </span>
            <span>
              路探 <b>AI</b>
            </span>
          </a>
          <p className="brand-sub">把每一次尝试，变成经验。</p>
          <div className="nav-caption">你的作钓旅程</div>
          <nav className="side-nav" aria-label="主导航">
            {navigation.map((item) => (
              <button
                key={item.page}
                onClick={() => onNavigate(item.page)}
                className={`nav-item ${item.page === page ? "active" : ""}`}
                aria-current={item.page === page ? "page" : undefined}
              >
                <item.icon size={19} strokeWidth={1.7} aria-hidden="true" />
                <span>{item.label}</span>
                <small>{item.number}</small>
              </button>
            ))}
          </nav>
          <div className="side-note">
            <MapPinned size={20} strokeWidth={1.5} />
            <h3>留住经验，保护钓点。</h3>
            <p>
              个人记录保存在当前浏览器。
              <br />
              水域备注不会发送到服务端，
              <br />
              无需提供精确位置。
            </p>
          </div>
          <div className="side-footer">
            <span className="version-dot" /> V1.2 · 公开体验版
            <ArrowUpRight size={13} />
            <p>规则辅助决策 · 结果有据可查</p>
          </div>
        </aside>
        <main id="main" className="main" tabIndex={-1}>
          <div className="topline">
            <span className="eyebrow">LUTAN · FISHING DECISION LAB</span>
            <span className="status-pill">
              <span />
              辅助诊断 · 本机记录
            </span>
          </div>
          {children}
          <footer className="page-footer">
            <ShieldCheck size={14} />
            <span>明确已知，承认未知。非实时鱼情预测，非垂钓许可判断。</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="移动端导航">
        {navigation.map((item) => (
          <button
            key={item.page}
            onClick={() => onNavigate(item.page)}
            className={item.page === page ? "active" : ""}
            aria-current={item.page === page ? "page" : undefined}
          >
            <item.icon size={20} strokeWidth={1.7} aria-hidden="true" />
            <span>{item.short}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
