# ⚖️ LangGraph 멀티 에이전트 토론 시스템

GPT 기반의 LangGraph 멀티 에이전트 토론 시스템입니다.
찬성·반대·리서치 에이전트가 라운드별로 토론을 진행하고, Moderator가 최종 결론을 도출합니다.

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
| `OutputNode` | 결과 출력 | 최종 State 요약 출력 |

---

## 📦 설치

```bash
pip install langgraph langchain-openai python-dotenv
```

---

## ⚙️ 환경변수 설정

### 방법 1 — `.env` 파일 (권장)

프로젝트 루트에 `.env` 파일을 생성합니다.

```env
# 필수
OPENAI_API_KEY=sk-...

# 선택 (기본값 사용 가능)
OPENAI_MODEL=gpt-4o
DEBATE_TOPIC=AI가 인간의 창의적 일자리를 대체해야 하는가?
DEBATE_MAX_ROUND=3
```

### 방법 2 — shell export

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_MODEL="gpt-4o"
export DEBATE_TOPIC="주 4일제 근무를 도입해야 하는가?"
export DEBATE_MAX_ROUND=2
```

### 환경변수 목록

| 변수명 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ | — | OpenAI API 키 |
| `OPENAI_MODEL` | ❌ | `gpt-4o` | 사용할 GPT 모델 |
| `DEBATE_TOPIC` | ❌ | `AI가 인간의 창의적 일자리를 대체해야 하는가?` | 토론 주제 |
| `DEBATE_MAX_ROUND` | ❌ | `3` | 최대 토론 라운드 수 |

---

## 🚀 실행

```bash
python langgraph_debate.py
```

### 실행 예시 출력

```
  LLM: gpt-4o

============================================================
  LANGGRAPH DEBATE SYSTEM
============================================================
  주제: AI가 인간의 창의적 일자리를 대체해야 하는가?
  라운드: 3회
============================================================

  [⟳ DebateController] ── Round 1 / 3 시작 ──

  [✦ ProAgent - Round 1] 찬성 논거 생성 중...
  1. AI는 반복적 작업을 자동화하여 인간이 더 고차원적 창의성에 집중할 수 있게 합니다.
  ...

  [✖ ConAgent - Round 1] 반대 논거 생성 중...
  1. 창의적 일자리의 대체는 인간의 자기표현 기회를 근본적으로 박탈합니다.
  ...

  [◎ ResearchAgent - Round 1] 근거 조사 중...
  ...

  [⟳ DebateController] Round 1/3 완료 → 다음 라운드 진행

  ...

============================================================
  ⚖ 최종 판정
============================================================
  1. 핵심 쟁점 요약: ...
  2. 찬성 측 강점: ...
  3. 반대 측 강점: ...
  4. 최종 종합 판단: ...
============================================================

[최종 State 요약]
  debate_round  : 3
  pro_arguments : 3개
  con_arguments : 3개
  evidence      : 3개
```

---

## 🗂️ State 구조

에이전트들이 공유하는 데이터 구조입니다.

```python
class DebateState(TypedDict):
    topic: str                                      # 토론 주제
    pro_arguments: Annotated[list, add_messages]    # 찬성 논거 누적 리스트
    con_arguments: Annotated[list, add_messages]    # 반대 논거 누적 리스트
    evidence: Annotated[list, add_messages]         # 리서치 근거 누적 리스트
    debate_round: int                               # 현재 라운드 번호
    max_round: int                                  # 최대 라운드 수
    final_decision: str                             # 최종 결론 (Moderator 출력)
```

`Annotated[list, add_messages]`를 사용해 라운드마다 논거가 덮어쓰이지 않고 **누적**됩니다.

---

## 🔁 루프 동작 원리

`DebateController`는 LangGraph의 **조건부 엣지(conditional edge)** 로 구현됩니다.

```python
graph.add_conditional_edges(
    "ResearchAgent",
    debate_controller,        # 라우팅 함수
    {
        "continue": "ProAgent",   # round < max_round → 루프
        "end":      "Moderator",  # round >= max_round → 종료
    },
)
```

---

## 🛠️ 확장 방법

### 모델 변경

`.env`의 `OPENAI_MODEL` 값을 바꾸면 됩니다.

```env
OPENAI_MODEL=gpt-4o-mini    # 빠르고 저렴
OPENAI_MODEL=gpt-4-turbo    # 더 강력한 추론
```

### 에이전트 추가

`build_debate_graph()` 안에 노드를 추가하고 엣지를 연결합니다.

```python
graph.add_node("EconomistAgent", economist_agent)
graph.add_edge("ProAgent", "EconomistAgent")
graph.add_edge("EconomistAgent", "ConAgent")
```

---

## 📁 프로젝트 구조

```
.
├── langgraph_debate.py   # 메인 실행 파일
├── .env                  # 환경변수 (git에 포함하지 마세요)
├── .env.example          # 환경변수 예시
└── README.md
```

> ⚠️ `.env` 파일은 절대 git에 커밋하지 마세요. `.gitignore`에 추가하세요.
> ```
> echo ".env" >> .gitignore
> ```

---

## 📋 요구사항

- Python 3.10 이상
- OpenAI API 키