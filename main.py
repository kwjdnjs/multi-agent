"""
LangGraph 멀티 에이전트 토론 시스템 (GPT 기반)
================================================

설치:
    pip install langgraph langchain-openai python-dotenv

환경변수 설정 (.env 파일 또는 shell export):
    OPENAI_API_KEY=sk-...
    OPENAI_MODEL=gpt-4o          # 선택사항 (기본값: gpt-4o)
    DEBATE_MAX_ROUND=3           # 선택사항 (기본값: 3)
    DEBATE_TOPIC=토론 주제       # 선택사항 (기본값: 하드코딩 주제)
"""

import os
import sys
from typing import Annotated, TypedDict
from dotenv import load_dotenv
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

# .env 파일 로드 (없으면 무시)
load_dotenv()

# ─────────────────────────────────────────────
# 환경변수 읽기
# ─────────────────────────────────────────────

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_MODEL   = os.environ.get("OPENAI_MODEL", "gpt-4o")
DEBATE_TOPIC   = os.environ.get("DEBATE_TOPIC", "AI가 인간의 창의적 일자리를 대체해야 하는가?")
DEBATE_MAX_ROUND = int(os.environ.get("DEBATE_MAX_ROUND", "3"))

if not OPENAI_API_KEY:
    print("[ERROR] OPENAI_API_KEY 환경변수가 설정되지 않았습니다.")
    print("  export OPENAI_API_KEY='sk-...'  또는  .env 파일에 추가하세요.")
    sys.exit(1)


# ─────────────────────────────────────────────
# 1. State 정의  (에이전트 간 공유 데이터)
# ─────────────────────────────────────────────

class DebateState(TypedDict):
    topic: str                                      # 토론 주제
    pro_arguments: Annotated[list, add_messages]    # 찬성 논거 누적
    con_arguments: Annotated[list, add_messages]    # 반대 논거 누적
    evidence: Annotated[list, add_messages]         # 조사 근거 누적
    debate_round: int                               # 현재 라운드
    max_round: int                                  # 최대 라운드
    final_decision: str                             # 최종 결론


# ─────────────────────────────────────────────
# 2. LLM 초기화 (GPT)
# ─────────────────────────────────────────────

llm = ChatOpenAI(
    model=OPENAI_MODEL,
    max_tokens=1024,
    api_key=OPENAI_API_KEY,
)

print(f"  LLM: {OPENAI_MODEL}")


# ─────────────────────────────────────────────
# 3. 노드(Node) 정의
# ─────────────────────────────────────────────

def input_node(state: DebateState) -> dict:
    """InputNode: 토론 주제를 분석하고 초기 상태를 설정"""
    print(f"\n{'='*60}")
    print(f"  LANGGRAPH DEBATE SYSTEM")
    print(f"{'='*60}")
    print(f"  주제: {state['topic']}")
    print(f"  라운드: {state['max_round']}회")
    print(f"{'='*60}\n")
    return {
        "debate_round": 0,
        "pro_arguments": [],
        "con_arguments": [],
        "evidence": [],
        "final_decision": "",
    }


def pro_agent(state: DebateState) -> dict:
    """ProAgent: 찬성 측 논거 생성"""
    round_num = state["debate_round"] + 1
    print(f"\n  [✦ ProAgent - Round {round_num}] 찬성 논거 생성 중...")

    prev_pro = "\n".join([m.content for m in state["pro_arguments"]]) if state["pro_arguments"] else "없음"
    prev_con = state["con_arguments"][-1].content if state["con_arguments"] else "없음"

    messages = [
        SystemMessage(content=(
            "당신은 토론의 찬성 측 에이전트입니다. "
            "주어진 주제에 대해 강력한 찬성 논거를 2-3개 제시하세요. "
            "이전 라운드를 참고해 더 발전된 주장을 하세요. "
            "간결하고 설득력 있게 작성하세요."
        )),
        HumanMessage(content=(
            f"주제: {state['topic']}\n"
            f"라운드: {round_num}/{state['max_round']}\n"
            f"이전 찬성 논거:\n{prev_pro}\n"
            f"반대 측 최신 주장:\n{prev_con}"
        )),
    ]

    response = llm.invoke(messages)
    print(f"\n  {response.content}\n")

    return {
        "pro_arguments": [HumanMessage(content=f"[R{round_num}] {response.content}", name="pro")],
        "debate_round": round_num,
    }


def con_agent(state: DebateState) -> dict:
    """ConAgent: 반대 측 반박 논거 생성"""
    round_num = state["debate_round"]
    print(f"\n  [✖ ConAgent - Round {round_num}] 반대 논거 생성 중...")

    latest_pro = state["pro_arguments"][-1].content if state["pro_arguments"] else "없음"
    prev_con = "\n".join([m.content for m in state["con_arguments"]]) if state["con_arguments"] else "없음"

    messages = [
        SystemMessage(content=(
            "당신은 토론의 반대 측 에이전트입니다. "
            "찬성 측 주장의 문제점과 리스크를 분석하고 반박하세요. "
            "2-3개의 핵심 반박 논거를 제시하세요. "
            "간결하고 날카롭게 작성하세요."
        )),
        HumanMessage(content=(
            f"주제: {state['topic']}\n"
            f"라운드: {round_num}/{state['max_round']}\n"
            f"찬성 측 최신 주장:\n{latest_pro}\n"
            f"이전 반대 논거:\n{prev_con}"
        )),
    ]

    response = llm.invoke(messages)
    print(f"\n  {response.content}\n")

    return {
        "con_arguments": [HumanMessage(content=f"[R{round_num}] {response.content}", name="con")],
    }


def research_agent(state: DebateState) -> dict:
    """ResearchAgent: 관련 사실·통계·사례 조사"""
    round_num = state["debate_round"]
    print(f"\n  [◎ ResearchAgent - Round {round_num}] 근거 조사 중...")

    latest_pro = state["pro_arguments"][-1].content if state["pro_arguments"] else "없음"
    latest_con = state["con_arguments"][-1].content if state["con_arguments"] else "없음"

    messages = [
        SystemMessage(content=(
            "당신은 리서치 에이전트입니다. "
            "토론 주제와 관련된 통계, 연구 결과, 실제 사례를 2-3개 제시하세요. "
            "객관적인 사실 기반으로 작성하고, 찬반 양측 모두에 관련된 근거를 포함하세요."
        )),
        HumanMessage(content=(
            f"주제: {state['topic']}\n"
            f"찬성 주장:\n{latest_pro}\n"
            f"반대 주장:\n{latest_con}"
        )),
    ]

    response = llm.invoke(messages)
    print(f"\n  {response.content}\n")

    return {
        "evidence": [HumanMessage(content=f"[R{round_num}] {response.content}", name="research")],
    }


def debate_controller(state: DebateState) -> str:
    """DebateController: 라운드 확인 후 분기 결정 (조건부 엣지)"""
    current = state["debate_round"]
    maximum = state["max_round"]
    print(f"\n  [⟳ DebateController] Round {current}/{maximum} 완료 → ", end="")

    if current < maximum:
        print("다음 라운드 진행\n")
        return "continue"
    else:
        print("최종 판정 단계\n")
        return "end"


def moderator(state: DebateState) -> dict:
    """Moderator: 토론 종합 및 최종 결론 도출"""
    print(f"\n  [⚖ Moderator] 토론 종합 분석 중...\n")

    all_pro = "\n\n".join([m.content for m in state["pro_arguments"]])
    all_con = "\n\n".join([m.content for m in state["con_arguments"]])
    all_evidence = "\n\n".join([m.content for m in state["evidence"]])

    messages = [
        SystemMessage(content=(
            "당신은 공정한 토론 진행자(Moderator)입니다. "
            "찬반 양측의 논거와 리서치 결과를 종합하여 균형 잡힌 최종 결론을 도출하세요.\n\n"
            "다음 형식으로 작성하세요:\n"
            "1. 핵심 쟁점 요약\n"
            "2. 찬성 측 강점\n"
            "3. 반대 측 강점\n"
            "4. 최종 종합 판단"
        )),
        HumanMessage(content=(
            f"주제: {state['topic']}\n\n"
            f"[찬성 논거 전체]\n{all_pro}\n\n"
            f"[반대 논거 전체]\n{all_con}\n\n"
            f"[리서치 근거 전체]\n{all_evidence}"
        )),
    ]

    response = llm.invoke(messages)

    print(f"\n{'='*60}")
    print("  ⚖ 최종 판정")
    print(f"{'='*60}")
    print(f"\n{response.content}\n")
    print(f"{'='*60}\n")

    return {"final_decision": response.content}


def output_node(state: DebateState) -> dict:
    """OutputNode: 최종 결과 출력"""
    print("  ■ 토론 완료!")
    print(f"  총 {state['debate_round']} 라운드 진행")
    print(f"  찬성 논거: {len(state['pro_arguments'])}개")
    print(f"  반대 논거: {len(state['con_arguments'])}개")
    print(f"  조사 근거: {len(state['evidence'])}개\n")
    return {}


# ─────────────────────────────────────────────
# 4. 그래프 빌드
# ─────────────────────────────────────────────

def build_debate_graph() -> StateGraph:
    graph = StateGraph(DebateState)

    # 노드 등록
    graph.add_node("InputNode",        input_node)
    graph.add_node("ProAgent",         pro_agent)
    graph.add_node("ConAgent",         con_agent)
    graph.add_node("ResearchAgent",    research_agent)
    graph.add_node("Moderator",        moderator)
    graph.add_node("OutputNode",       output_node)

    # 기본 엣지 (순차 흐름)
    graph.add_edge("InputNode",     "ProAgent")
    graph.add_edge("ProAgent",      "ConAgent")
    graph.add_edge("ConAgent",      "ResearchAgent")

    # 조건부 엣지 (DebateController)
    #   "continue" → ProAgent (루프)
    #   "end"      → Moderator (종료)
    graph.add_conditional_edges(
        "ResearchAgent",
        debate_controller,          # 라우팅 함수
        {
            "continue": "ProAgent",
            "end":      "Moderator",
        },
    )

    graph.add_edge("Moderator",  "OutputNode")
    graph.add_edge("OutputNode", END)

    # 시작 노드 지정
    graph.set_entry_point("InputNode")

    return graph.compile()


# ─────────────────────────────────────────────
# 5. 실행
# ─────────────────────────────────────────────

if __name__ == "__main__":
    debate_graph = build_debate_graph()

    # 초기 상태 (환경변수에서 주제·라운드 수 읽기)
    initial_state: DebateState = {
        "topic":          DEBATE_TOPIC,
        "pro_arguments":  [],
        "con_arguments":  [],
        "evidence":       [],
        "debate_round":   0,
        "max_round":      DEBATE_MAX_ROUND,
        "final_decision": "",
    }

    # 그래프 실행
    final_state = debate_graph.invoke(initial_state)

    # 결과 반환
    print("\n[최종 State 요약]")
    print(f"  debate_round  : {final_state['debate_round']}")
    print(f"  pro_arguments : {len(final_state['pro_arguments'])}개")
    print(f"  con_arguments : {len(final_state['con_arguments'])}개")
    print(f"  evidence      : {len(final_state['evidence'])}개")