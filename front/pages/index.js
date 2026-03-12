import { useState, useRef, useEffect } from "react";
import Head from "next/head";
import ReactMarkdown from "react-markdown";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── 상수 ──────────────────────────────────────────────────────
const NODE_META = {
  InputNode:        { icon: "▶", label: "Input",      color: "#e8e0c8" },
  ProAgent:         { icon: "✦", label: "Pro",         color: "#00d4aa" },
  ConAgent:         { icon: "✖", label: "Con",         color: "#ff4d6d" },
  ResearchAgent:    { icon: "◎", label: "Research",    color: "#7c6af7" },
  DebateController: { icon: "⟳", label: "Controller", color: "#3d9cf0" },
  Moderator:        { icon: "⚖", label: "Moderator",  color: "#f0a500" },
  OutputNode:       { icon: "■", label: "Output",      color: "#e8e0c8" },
  __end__:          { icon: "✓", label: "Done",        color: "#00d4aa" },
};

const EXAMPLE_TOPICS = [
  "AI가 인간의 창의적 일자리를 대체해야 하는가?",
  "주 4일제 근무를 전면 도입해야 하는가?",
  "대학 입시에서 수능을 폐지해야 하는가?",
  "암호화폐는 법정화폐를 대체할 수 있는가?",
];

// ── 유틸 ──────────────────────────────────────────────────────
function cls(...args) {
  return args.filter(Boolean).join(" ");
}

function DebateCard({ role, content, round, visible }) {
  const meta = NODE_META[role] || {};
  return (
    <div
      className={cls("debate-card", role === "ProAgent" && "card-pro", role === "ConAgent" && "card-con", role === "ResearchAgent" && "card-research", visible && "card-visible")}
    >
      <div className="card-header">
        <span className="card-icon" style={{ color: meta.color }}>{meta.icon}</span>
        <span className="card-label" style={{ color: meta.color }}>{meta.label}</span>
        {round && <span className="card-round">Round {round}</span>}
      </div>
      <div className="card-body"><ReactMarkdown>{content}</ReactMarkdown></div>
    </div>
  );
}

function NodePill({ name, active, done }) {
  const meta = NODE_META[name] || {};
  return (
    <div className={cls("node-pill", active && "node-active", done && "node-done")}>
      <span className="node-icon" style={{ color: active || done ? meta.color : "#444466" }}>
        {meta.icon}
      </span>
      <span className="node-name">{meta.label}</span>
      {active && <span className="node-dot" style={{ background: meta.color }} />}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function Home() {
  const [topic, setTopic]           = useState("");
  const [maxRound, setMaxRound]     = useState(2);
  const [mode, setMode]             = useState("stream"); // stream | sync
  const [phase, setPhase]           = useState("idle");   // idle | running | done | error
  const [events, setEvents]         = useState([]);        // 스트림 이벤트 목록
  const [activeNode, setActiveNode] = useState(null);
  const [doneNodes, setDoneNodes]   = useState([]);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError]           = useState("");
  const feedRef                     = useRef(null);
  const abortRef                    = useRef(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events]);

  // ── 스트리밍 실행 ───────────────────────────────────────────
  async function runStream() {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("running");
    setEvents([]);
    setDoneNodes([]);
    setActiveNode(null);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/debate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, max_round: maxRound }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`서버 오류: ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          const ev = JSON.parse(raw);

          setActiveNode(ev.node === "__end__" ? null : ev.node);
          if (ev.node !== "__end__") {
            setDoneNodes((p) => [...new Set([...p, ev.node])]);
          }
          setEvents((p) => [...p, ev]);

          if (ev.node === "__end__") setPhase("done");
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setError(e.message);
        setPhase("error");
      }
    }
  }

  // ── 동기 실행 ───────────────────────────────────────────────
  async function runSync() {
    setPhase("running");
    setSyncResult(null);
    setError("");

    // 노드 순서를 순차적으로 흉내내며 UI 업데이트
    const order = ["InputNode","ProAgent","ConAgent","ResearchAgent","DebateController","Moderator","OutputNode"];
    let i = 0;
    const ticker = setInterval(() => {
      if (i < order.length) setActiveNode(order[i++]);
    }, 1800);

    try {
      const res  = await fetch(`${API_BASE}/debate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, max_round: maxRound }),
      });
      if (!res.ok) throw new Error(`서버 오류: ${res.status}`);
      const data = await res.json();
      clearInterval(ticker);
      setSyncResult(data);
      setActiveNode(null);
      setDoneNodes(order);
      setPhase("done");
    } catch (e) {
      clearInterval(ticker);
      setError(e.message);
      setPhase("error");
    }
  }

  function handleStart() {
    if (!topic.trim()) return;
    mode === "stream" ? runStream() : runSync();
  }

  function handleStop() {
    abortRef.current?.abort();
    setPhase("idle");
    setActiveNode(null);
  }

  function handleReset() {
    abortRef.current?.abort();
    setPhase("idle");
    setEvents([]);
    setDoneNodes([]);
    setActiveNode(null);
    setSyncResult(null);
    setError("");
    setTopic("");
  }

  // ── 스트림 이벤트에서 카드 데이터 추출 ─────────────────────
  function extractCards(evs) {
    const cards = [];
    for (const ev of evs) {
      const s = ev.state || {};
      if (ev.node === "ProAgent" && s.pro_arguments?.length) {
        const last = s.pro_arguments[s.pro_arguments.length - 1];
        cards.push({ id: `pro-${cards.length}`, role: "ProAgent", content: last, round: s.debate_round });
      }
      if (ev.node === "ConAgent" && s.con_arguments?.length) {
        const last = s.con_arguments[s.con_arguments.length - 1];
        cards.push({ id: `con-${cards.length}`, role: "ConAgent", content: last, round: s.debate_round });
      }
      if (ev.node === "ResearchAgent" && s.evidence?.length) {
        const last = s.evidence[s.evidence.length - 1];
        cards.push({ id: `res-${cards.length}`, role: "ResearchAgent", content: last, round: s.debate_round });
      }
    }
    return cards;
  }

  const streamFinal = events.find((e) => e.node === "Moderator")?.state?.final_decision;
  const cards       = extractCards(events);
  const nodes       = ["InputNode","ProAgent","ConAgent","ResearchAgent","DebateController","Moderator","OutputNode"];

  // ── 동기 결과용 라운드 카드 ─────────────────────────────────
  function syncCards() {
    if (!syncResult) return [];
    const out = [];
    const total = syncResult.debate_round;
    for (let r = 0; r < total; r++) {
      if (syncResult.pro_arguments[r])
        out.push({ id: `s-pro-${r}`, role: "ProAgent",      content: syncResult.pro_arguments[r], round: r + 1 });
      if (syncResult.con_arguments[r])
        out.push({ id: `s-con-${r}`, role: "ConAgent",      content: syncResult.con_arguments[r], round: r + 1 });
      if (syncResult.evidence[r])
        out.push({ id: `s-res-${r}`, role: "ResearchAgent", content: syncResult.evidence[r],       round: r + 1 });
    }
    return out;
  }

  const displayCards  = mode === "stream" ? cards : syncCards();
  const finalDecision = mode === "stream" ? streamFinal : syncResult?.final_decision;

  // ── 렌더 ────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Debate Arena — LangGraph</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet" />
      </Head>

      <div className="root">
        {/* ── 헤더 ── */}
        <header className="header">
          <div className="header-left">
            <div className="logo">
              <span className="logo-icon">⚖</span>
              <div>
                <div className="logo-title">DEBATE ARENA</div>
                <div className="logo-sub">LangGraph · Multi-Agent System</div>
              </div>
            </div>
          </div>
          <div className="header-right">
            {phase === "running" && (
              <div className="status-badge">
                <span className="status-dot" />
                토론 진행 중
              </div>
            )}
            {phase === "done" && (
              <div className="status-badge done">✓ 완료</div>
            )}
          </div>
        </header>

        <div className="layout">
          {/* ── 사이드바 ── */}
          <aside className="sidebar">
            <div className="sidebar-section">
              <div className="section-label">GRAPH NODES</div>
              <div className="node-list">
                {nodes.map((n) => (
                  <NodePill
                    key={n}
                    name={n}
                    active={activeNode === n}
                    done={doneNodes.includes(n)}
                  />
                ))}
              </div>
            </div>

            {phase !== "idle" && (
              <div className="sidebar-section">
                <div className="section-label">PROGRESS</div>
                <div className="progress-info">
                  <div className="prog-row">
                    <span>라운드</span>
                    <span>{Math.min(doneNodes.filter(n => n === "ResearchAgent").length, maxRound)} / {maxRound}</span>
                  </div>
                  <div className="prog-row">
                    <span>찬성 논거</span>
                    <span>{displayCards.filter(c => c.role === "ProAgent").length}개</span>
                  </div>
                  <div className="prog-row">
                    <span>반대 논거</span>
                    <span>{displayCards.filter(c => c.role === "ConAgent").length}개</span>
                  </div>
                  <div className="prog-row">
                    <span>조사 근거</span>
                    <span>{displayCards.filter(c => c.role === "ResearchAgent").length}개</span>
                  </div>
                </div>
              </div>
            )}
          </aside>

          {/* ── 메인 ── */}
          <main className="main">
            {/* 입력 패널 */}
            <div className="input-panel">
              <div className="input-top">
                <div className="input-group">
                  <label className="field-label">토론 주제</label>
                  <textarea
                    className="topic-input"
                    placeholder="주제를 직접 입력하거나 아래 예시를 선택하세요"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    disabled={phase === "running"}
                    rows={2}
                  />
                  <div className="example-chips">
                    {EXAMPLE_TOPICS.map((t) => (
                      <button
                        key={t}
                        className={cls("chip", topic === t && "chip-active")}
                        onClick={() => setTopic(t)}
                        disabled={phase === "running"}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="controls-row">
                  <div className="control-group">
                    <label className="field-label">라운드 수</label>
                    <div className="round-btns">
                      {[1, 2, 3].map((r) => (
                        <button
                          key={r}
                          className={cls("round-btn", maxRound === r && "round-active")}
                          onClick={() => setMaxRound(r)}
                          disabled={phase === "running"}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="control-group">
                    <label className="field-label">실행 방식</label>
                    <div className="mode-toggle">
                      <button
                        className={cls("mode-btn", mode === "stream" && "mode-active")}
                        onClick={() => setMode("stream")}
                        disabled={phase === "running"}
                      >
                        ⚡ 실시간
                      </button>
                      <button
                        className={cls("mode-btn", mode === "sync" && "mode-active")}
                        onClick={() => setMode("sync")}
                        disabled={phase === "running"}
                      >
                        ⏳ 동기
                      </button>
                    </div>
                  </div>

                  <div className="action-btns">
                    {phase === "idle" || phase === "error" || phase === "done" ? (
                      <>
                        <button
                          className="btn-start"
                          onClick={handleStart}
                          disabled={!topic.trim()}
                        >
                          토론 시작
                        </button>
                        {phase !== "idle" && (
                          <button className="btn-reset" onClick={handleReset}>
                            초기화
                          </button>
                        )}
                      </>
                    ) : (
                      <button className="btn-stop" onClick={handleStop}>
                        중단
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 에러 */}
            {error && (
              <div className="error-box">
                <span>⚠</span> {error}
                <br/>
                <small>FastAPI 서버({API_BASE})가 실행 중인지 확인하세요.</small>
              </div>
            )}

            {/* 대기 화면 */}
            {phase === "idle" && (
              <div className="empty-state">
                <div className="empty-icon">⚖</div>
                <div className="empty-title">토론을 시작하세요</div>
                <div className="empty-desc">
                  주제를 입력하면 AI 에이전트들이<br />찬성·반대·리서치 역할로 토론을 진행합니다
                </div>
              </div>
            )}

            {/* 토론 피드 */}
            {(phase === "running" || phase === "done") && (
              <div className="feed" ref={feedRef}>
                {/* 라운드별 카드 */}
                {displayCards.map((card, i) => (
                  <DebateCard
                    key={card.id}
                    role={card.role}
                    content={card.content}
                    round={card.round}
                    visible={true}
                  />
                ))}

                {/* 진행 중 스피너 */}
                {phase === "running" && activeNode && (
                  <div className="thinking-row">
                    <span className="thinking-icon" style={{ color: NODE_META[activeNode]?.color }}>
                      {NODE_META[activeNode]?.icon}
                    </span>
                    <span className="thinking-label" style={{ color: NODE_META[activeNode]?.color }}>
                      {NODE_META[activeNode]?.label}
                    </span>
                    <span className="thinking-dots">
                      <span /><span /><span />
                    </span>
                  </div>
                )}

                {/* 최종 판정 */}
                {finalDecision && (
                  <div className="verdict-box">
                    <div className="verdict-header">
                      <span className="verdict-icon">⚖</span>
                      <span className="verdict-title">최종 판정</span>
                    </div>
                    <div className="verdict-body"><ReactMarkdown>{finalDecision}</ReactMarkdown></div>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg:        #09090e;
          --surface:   #111118;
          --surface2:  #16161f;
          --border:    #1e1e2c;
          --border2:   #2a2a3a;
          --pro:       #00d4aa;
          --con:       #ff4d6d;
          --research:  #7c6af7;
          --gold:      #f0a500;
          --blue:      #3d9cf0;
          --text:      #d8d4c8;
          --muted:     #55556a;
          --muted2:    #3a3a4a;
        }

        html, body { height: 100%; background: var(--bg); color: var(--text); }

        body {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          line-height: 1.6;
          -webkit-font-smoothing: antialiased;
        }

        /* ── Root ── */
        .root {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        /* ── Header ── */
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 28px;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .header-left { display: flex; align-items: center; }

        .logo { display: flex; align-items: center; gap: 14px; }

        .logo-icon {
          font-size: 28px;
          color: var(--gold);
          line-height: 1;
          filter: drop-shadow(0 0 8px #f0a50066);
        }

        .logo-title {
          font-family: 'DM Serif Display', serif;
          font-size: 20px;
          letter-spacing: 3px;
          color: #fff;
        }

        .logo-sub {
          font-size: 9px;
          letter-spacing: 2px;
          color: var(--muted);
          margin-top: 2px;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: 20px;
          border: 1px solid var(--border2);
          font-size: 11px;
          letter-spacing: 1px;
          color: var(--text);
          background: var(--surface2);
        }

        .status-badge.done { border-color: var(--pro); color: var(--pro); }

        .status-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--gold);
          animation: blink 1s ease-in-out infinite;
        }

        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }

        /* ── Layout ── */
        .layout {
          flex: 1;
          display: grid;
          grid-template-columns: 220px 1fr;
          min-height: 0;
        }

        /* ── Sidebar ── */
        .sidebar {
          border-right: 1px solid var(--border);
          padding: 24px 16px;
          background: var(--surface);
          display: flex;
          flex-direction: column;
          gap: 28px;
        }

        .sidebar-section { display: flex; flex-direction: column; gap: 10px; }

        .section-label {
          font-size: 9px;
          letter-spacing: 2.5px;
          color: var(--muted);
          padding-bottom: 4px;
          border-bottom: 1px solid var(--border);
        }

        .node-list { display: flex; flex-direction: column; gap: 2px; }

        .node-pill {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: 7px;
          border: 1px solid transparent;
          transition: all .25s;
          cursor: default;
        }

        .node-pill.node-active {
          border-color: var(--border2);
          background: var(--surface2);
        }

        .node-pill.node-done { opacity: .7; }

        .node-icon { font-size: 13px; transition: color .25s; color: var(--muted); }
        .node-name { font-size: 11px; color: var(--muted); flex: 1; transition: color .25s; }

        .node-pill.node-active .node-name { color: var(--text); }

        .node-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          animation: blink .8s ease-in-out infinite;
        }

        /* ── Progress ── */
        .progress-info { display: flex; flex-direction: column; gap: 8px; }

        .prog-row {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: var(--muted);
        }

        .prog-row span:last-child { color: var(--text); }

        /* ── Main ── */
        .main {
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        /* ── Input Panel ── */
        .input-panel {
          padding: 24px 28px;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
        }

        .input-top { display: flex; flex-direction: column; gap: 16px; }

        .input-group { display: flex; flex-direction: column; gap: 8px; }

        .field-label {
          font-size: 9px;
          letter-spacing: 2px;
          color: var(--muted);
        }

        .topic-input {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border2);
          border-radius: 8px;
          color: var(--text);
          font-family: 'DM Serif Display', serif;
          font-size: 15px;
          padding: 12px 16px;
          resize: none;
          transition: border-color .2s;
          line-height: 1.5;
        }

        .topic-input::placeholder { color: var(--muted2); font-family: 'DM Mono', monospace; font-size: 12px; }
        .topic-input:focus { outline: none; border-color: var(--gold); }
        .topic-input:disabled { opacity: .5; }

        .example-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .chip {
          padding: 4px 12px;
          border-radius: 20px;
          border: 1px solid var(--border2);
          background: transparent;
          color: var(--muted);
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          cursor: pointer;
          transition: all .2s;
          white-space: nowrap;
        }

        .chip:hover { border-color: var(--gold); color: var(--gold); }
        .chip.chip-active { border-color: var(--gold); color: var(--gold); background: #f0a50011; }
        .chip:disabled { opacity: .4; cursor: not-allowed; }

        .controls-row {
          display: flex;
          align-items: flex-end;
          gap: 20px;
          flex-wrap: wrap;
        }

        .control-group { display: flex; flex-direction: column; gap: 8px; }

        .round-btns { display: flex; gap: 6px; }

        .round-btn {
          width: 36px; height: 36px;
          border-radius: 8px;
          border: 1px solid var(--border2);
          background: transparent;
          color: var(--muted);
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          cursor: pointer;
          transition: all .2s;
        }

        .round-btn:hover { border-color: var(--gold); color: var(--gold); }
        .round-btn.round-active { border-color: var(--gold); color: var(--gold); background: #f0a50015; }
        .round-btn:disabled { opacity: .4; cursor: not-allowed; }

        .mode-toggle { display: flex; gap: 0; border: 1px solid var(--border2); border-radius: 8px; overflow: hidden; }

        .mode-btn {
          padding: 8px 16px;
          background: transparent;
          border: none;
          color: var(--muted);
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          cursor: pointer;
          transition: all .2s;
          border-right: 1px solid var(--border2);
        }

        .mode-btn:last-child { border-right: none; }
        .mode-btn:hover { color: var(--text); background: var(--surface2); }
        .mode-btn.mode-active { background: var(--surface2); color: var(--gold); }
        .mode-btn:disabled { opacity: .4; cursor: not-allowed; }

        .action-btns { display: flex; gap: 8px; margin-left: auto; }

        .btn-start, .btn-stop, .btn-reset {
          padding: 10px 24px;
          border-radius: 8px;
          border: none;
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          letter-spacing: 1px;
          cursor: pointer;
          transition: all .2s;
        }

        .btn-start {
          background: var(--gold);
          color: #000;
          font-weight: 500;
        }

        .btn-start:hover { filter: brightness(1.1); }
        .btn-start:disabled { opacity: .4; cursor: not-allowed; filter: none; }

        .btn-stop {
          background: var(--con);
          color: #fff;
        }

        .btn-reset {
          background: transparent;
          border: 1px solid var(--border2);
          color: var(--muted);
        }

        .btn-reset:hover { border-color: var(--text); color: var(--text); }

        /* ── Error ── */
        .error-box {
          margin: 20px 28px 0;
          padding: 14px 18px;
          border-radius: 8px;
          border: 1px solid #ff4d6d55;
          background: #ff4d6d0a;
          color: #ff4d6d;
          font-size: 12px;
          line-height: 1.8;
        }

        .error-box small { color: var(--muted); font-size: 11px; }

        /* ── Empty State ── */
        .empty-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 60px;
        }

        .empty-icon {
          font-size: 56px;
          color: var(--gold);
          filter: drop-shadow(0 0 20px #f0a50044);
          animation: float 3s ease-in-out infinite;
        }

        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }

        .empty-title {
          font-family: 'DM Serif Display', serif;
          font-size: 24px;
          color: #fff;
          letter-spacing: 1px;
        }

        .empty-desc {
          font-size: 12px;
          color: var(--muted);
          text-align: center;
          line-height: 2;
        }

        /* ── Feed ── */
        .feed {
          flex: 1;
          overflow-y: auto;
          padding: 24px 28px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .feed::-webkit-scrollbar { width: 4px; }
        .feed::-webkit-scrollbar-track { background: var(--bg); }
        .feed::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

        /* ── Debate Card ── */
        .debate-card {
          padding: 16px 20px;
          border-radius: 10px;
          border-left: 3px solid var(--border2);
          background: var(--surface);
          border: 1px solid var(--border);
          border-left-width: 3px;
          opacity: 0;
          transform: translateY(10px);
          transition: opacity .4s, transform .4s;
        }

        .debate-card.card-visible {
          opacity: 1;
          transform: translateY(0);
        }

        .card-pro    { border-left-color: var(--pro);      background: #00d4aa08; }
        .card-con    { border-left-color: var(--con);      background: #ff4d6d08; }
        .card-research { border-left-color: var(--research); background: #7c6af708; }

        .card-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }

        .card-icon  { font-size: 14px; }
        .card-label { font-size: 10px; font-weight: 500; letter-spacing: 1.5px; }
        .card-round { margin-left: auto; font-size: 9px; color: var(--muted); letter-spacing: 1px; }

        .card-body {
          font-size: 12px;
          color: var(--text);
          line-height: 1.8;
        }

        .card-body p { margin-bottom: 8px; }
        .card-body p:last-child { margin-bottom: 0; }
        .card-body h1, .card-body h2, .card-body h3,
        .card-body h4, .card-body h5, .card-body h6 {
          font-family: 'DM Serif Display', serif;
          color: #fff;
          margin: 12px 0 6px;
          line-height: 1.3;
        }
        .card-body h1 { font-size: 16px; }
        .card-body h2 { font-size: 14px; }
        .card-body h3 { font-size: 13px; }
        .card-body ul, .card-body ol {
          padding-left: 18px;
          margin-bottom: 8px;
        }
        .card-body li { margin-bottom: 4px; }
        .card-body strong { color: #fff; font-weight: 600; }
        .card-body em { color: var(--muted); font-style: italic; }
        .card-body code {
          font-family: 'DM Mono', monospace;
          background: var(--bg);
          border: 1px solid var(--border2);
          border-radius: 4px;
          padding: 1px 6px;
          font-size: 11px;
        }
        .card-body pre {
          background: var(--bg);
          border: 1px solid var(--border2);
          border-radius: 6px;
          padding: 12px;
          overflow-x: auto;
          margin-bottom: 8px;
        }
        .card-body pre code {
          background: none;
          border: none;
          padding: 0;
          font-size: 11px;
        }
        .card-body blockquote {
          border-left: 3px solid var(--border2);
          padding-left: 12px;
          color: var(--muted);
          margin: 8px 0;
        }
        .card-body hr {
          border: none;
          border-top: 1px solid var(--border2);
          margin: 10px 0;
        }

        /* ── Thinking ── */
        .thinking-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 0;
        }

        .thinking-icon  { font-size: 14px; }
        .thinking-label { font-size: 11px; letter-spacing: 1px; }

        .thinking-dots {
          display: flex;
          gap: 4px;
        }

        .thinking-dots span {
          width: 5px; height: 5px;
          border-radius: 50%;
          background: var(--muted);
          animation: dotpulse 1.2s ease-in-out infinite;
        }

        .thinking-dots span:nth-child(2) { animation-delay: .2s; }
        .thinking-dots span:nth-child(3) { animation-delay: .4s; }

        @keyframes dotpulse { 0%,100%{opacity:.2;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }

        /* ── Verdict ── */
        .verdict-box {
          padding: 24px;
          border-radius: 12px;
          border: 1px solid #f0a50044;
          background: #f0a5000a;
          margin-top: 8px;
        }

        .verdict-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
        }

        .verdict-icon  { font-size: 20px; color: var(--gold); filter: drop-shadow(0 0 6px #f0a50066); }
        .verdict-title { font-family: 'DM Serif Display', serif; font-size: 18px; color: var(--gold); letter-spacing: 1px; }

        .verdict-body {
          font-size: 13px;
          color: var(--text);
          line-height: 2;
        }

        .verdict-body p { margin-bottom: 10px; }
        .verdict-body p:last-child { margin-bottom: 0; }
        .verdict-body h1, .verdict-body h2, .verdict-body h3 {
          font-family: 'DM Serif Display', serif;
          color: var(--gold);
          margin: 12px 0 6px;
        }
        .verdict-body ul, .verdict-body ol {
          padding-left: 18px;
          margin-bottom: 8px;
        }
        .verdict-body li { margin-bottom: 4px; }
        .verdict-body strong { color: var(--gold); font-weight: 600; }
        .verdict-body em { color: var(--muted); font-style: italic; }
        .verdict-body code {
          font-family: 'DM Mono', monospace;
          background: var(--bg);
          border: 1px solid var(--border2);
          border-radius: 4px;
          padding: 1px 6px;
          font-size: 12px;
        }
        .verdict-body blockquote {
          border-left: 3px solid #f0a50044;
          padding-left: 12px;
          color: var(--muted);
          margin: 8px 0;
        }

        /* ── Responsive ── */
        @media (max-width: 768px) {
          .layout { grid-template-columns: 1fr; }
          .sidebar { display: none; }
          .controls-row { flex-direction: column; }
          .action-btns { margin-left: 0; }
        }
      `}</style>
    </>
  );
}
