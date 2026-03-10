# ⚖️ LangGraph 멀티 에이전트 토론 시스템

GPT 기반 LangGraph 멀티 에이전트 토론 시스템입니다.
찬성·반대·리서치 에이전트가 라운드별로 토론하고, Moderator가 최종 결론을 도출합니다.
**FastAPI**로 REST API 및 SSE 스트리밍을 제공하며, CLI로도 실행할 수 있습니다.

---

## 📁 프로젝트 구조

```
.
├── debate_graph.py       # LangGraph 핵심 로직 (State, 노드, 그래프)
├── main.py               # FastAPI 서버
├── langgraph_debate.py   # CLI 실행 진입점
├── .env                  # 환경변수 (git 제외)
├── .env.example          # 환경변수 예시
└── README.md
```

---

## 📐 아키텍처

```
InputNode
    │
    ▼
ProAgent        ← 찬성 논거 생성
    │
    ▼
ConAgent        ← 반대 논거 생성
    │
    ▼
ResearchAgent   ← 관련 근거 조사
    │
    ▼
DebateController
    │
    ├── round < max_round ──→ ProAgent  (루프 반복)
    │
    └── round >= max_round ──→ Moderator
                                    │
                                    ▼
                               OutputNode → END
```

---

## 🤖 에이전트 역할

| 에이전트 | 역할 | 동작 |
|---|---|---|
| `InputNode` | 초기화 | 주제 출력, 상태 초기화 |
| `ProAgent` | 찬성 측 | 강력한 찬성 논거 2-3개 생성 |
| `ConAgent` | 반대 측 | 찬성 주장 반박, 리스크 지적 |
| `ResearchAgent` | 리서치 | 통계·사례·연구 결과 제시 |
| `DebateController` | 라우터 | 라운드 수 확인 후 루프/종료 분기 |
| `Moderator` | 진행자 | 전체 토론 종합, 최종 결론 도출 |
| `OutputNode` | 결과 출력 | 최종 State 로깅 |

---

## 📦 설치

```bash
pip install langgraph langchain-openai fastapi uvicorn python-dotenv
```

---

## ⚙️ 환경변수 설정

`.env` 파일을 프로젝트 루트에 생성합니다.

```env
# 필수
OPENAI_API_KEY=sk-...

# 선택 (기본값 사용 가능)
OPENAI_MODEL=gpt-4o
DEBATE_TOPIC=AI가 인간의 창의적 일자리를 대체해야 하는가?
DEBATE_MAX_ROUND=3
```

| 변수명 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ | — | OpenAI API 키 |
| `OPENAI_MODEL` | ❌ | `gpt-4o` | 사용할 GPT 모델 |
| `DEBATE_TOPIC` | ❌ | AI 일자리 주제 | 토론 주제 (CLI 전용) |
| `DEBATE_MAX_ROUND` | ❌ | `3` | 최대 토론 라운드 수 (CLI 전용) |

> ⚠️ `.env` 파일은 절대 git에 커밋하지 마세요.
> ```bash
> echo ".env" >> .gitignore
> ```

---

## 🚀 실행

### 방법 1 — FastAPI 서버

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

서버 시작 후 Swagger UI: **http://localhost:8000/docs**

---

### 방법 2 — CLI

```bash
python langgraph_debate.py

# 환경변수로 주제·라운드 변경
DEBATE_TOPIC="주 4일제를 도입해야 하는가?" DEBATE_MAX_ROUND=2 python langgraph_debate.py
```

---

## 🌐 API 엔드포인트

### `GET /health`

서버 상태를 확인합니다.

```bash
curl http://localhost:8000/health
```

```json
{ "status": "ok" }
```

---

### `POST /debate` — 동기 실행

모든 라운드가 끝난 뒤 전체 결과를 한 번에 반환합니다.

**Request**

```bash
curl -X POST http://localhost:8000/debate \
  -H "Content-Type: application/json" \
  -d '{"topic": "AI가 인간의 창의적 일자리를 대체해야 하는가?", "max_round": 2}'
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `topic` | string | ✅ | — | 토론 주제 (최소 5자) |
| `max_round` | int | ❌ | `3` | 라운드 수 (1~5) |

**Response**

```json
{
  "topic": "AI가 인간의 창의적 일자리를 대체해야 하는가?",
  "debate_round": 2,
  "max_round": 2,
  "pro_arguments": ["[R1] ...", "[R2] ..."],
  "con_arguments": ["[R1] ...", "[R2] ..."],
  "evidence":      ["[R1] ...", "[R2] ..."],
  "final_decision": "1. 핵심 쟁점 요약\n...\n4. 최종 종합 판단\n...",
  "rounds": [
    { "round": 1, "pro": "[R1] ...", "con": "[R1] ...", "evidence": "[R1] ..." },
    { "round": 2, "pro": "[R2] ...", "con": "[R2] ...", "evidence": "[R2] ..." }
  ]
}
```

---

### `POST /debate/stream` — SSE 스트리밍

각 노드가 완료될 때마다 이벤트를 실시간으로 전송합니다.

**curl**

```bash
curl -X POST http://localhost:8000/debate/stream \
  -H "Content-Type: application/json" \
  -d '{"topic": "AI가 인간의 창의적 일자리를 대체해야 하는가?", "max_round": 2}'
```

**JavaScript (EventSource는 POST 미지원 → fetch 사용)**

```js
const response = await fetch("http://localhost:8000/debate/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ topic: "AI 일자리 대체", max_round: 2 }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  const lines = decoder.decode(value).split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const event = JSON.parse(line.slice(6));
      console.log(event.node, event.state);
    }
  }
}
```

**스트림 이벤트 형식**

```
data: {"node": "InputNode",     "state": {...}}
data: {"node": "ProAgent",      "state": {"pro_arguments": ["..."], "debate_round": 1}}
data: {"node": "ConAgent",      "state": {"con_arguments": ["..."]}}
data: {"node": "ResearchAgent", "state": {"evidence": ["..."]}}
data: {"node": "ProAgent",      "state": {"pro_arguments": ["..."], "debate_round": 2}}
...
data: {"node": "Moderator",     "state": {"final_decision": "..."}}
data: {"node": "OutputNode",    "state": {}}
data: {"node": "__end__",       "state": {}}
```

---

## 🗂️ State 구조

```python
class DebateState(TypedDict):
    topic:          str                                   # 토론 주제
    pro_arguments:  Annotated[list, add_messages]         # 찬성 논거 누적
    con_arguments:  Annotated[list, add_messages]         # 반대 논거 누적
    evidence:       Annotated[list, add_messages]         # 리서치 근거 누적
    debate_round:   int                                   # 현재 라운드 번호
    max_round:      int                                   # 최대 라운드 수
    final_decision: str                                   # 최종 결론
```

`Annotated[list, add_messages]`를 사용해 라운드마다 논거가 **누적**됩니다.

---

## 🔁 루프 동작 원리

```python
graph.add_conditional_edges(
    "ResearchAgent",
    debate_controller,               # 라우팅 함수
    {
        "continue": "ProAgent",      # round < max_round → 루프
        "end":      "Moderator",     # round >= max_round → 종료
    },
)
```

---

## 🛠️ 확장 방법

### 모델 변경

```env
OPENAI_MODEL=gpt-4o-mini    # 빠르고 저렴
OPENAI_MODEL=gpt-4-turbo    # 더 강력한 추론
```

### 에이전트 추가

`debate_graph.py`의 `build_debate_graph()` 안에 노드를 추가합니다.

```python
graph.add_node("EconomistAgent", economist_agent)
graph.add_edge("ProAgent", "EconomistAgent")
graph.add_edge("EconomistAgent", "ConAgent")
```

---

## 📋 요구사항

- Python 3.10 이상
- OpenAI API 키