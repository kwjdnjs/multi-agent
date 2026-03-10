"""
debate_graph.py
───────────────
LangGraph 토론 그래프 핵심 로직.
FastAPI(main.py) 및 CLI(langgraph_debate.py) 양쪽에서 임포트해서 사용합니다.
"""

import os
import logging
from typing import Annotated, TypedDict

from dotenv import load_dotenv
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

load_dotenv()

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# 환경변수
# ─────────────────────────────────────────────

OPENAI_API_KEY   = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL     = os.environ.get("OPENAI_MODEL", "gpt-4o")

if not OPENAI_API_KEY:
    raise EnvironmentError(
        "OPENAI_API_KEY 환경변수가 설정되지 않았습니다. "
        ".env 파일 또는 shell export로 설정해 주세요."
    )

# ─────────────────────────────────────────────
# 1. State
# ─────────────────────────────────────────────

class DebateState(TypedDict):
    topic:          str
    pro_arguments:  Annotated[list, add_messages]
    con_arguments:  Annotated[list, add_messages]
    evidence:       Annotated[list, add_messages]
    debate_round:   int
    max_round:      int
    final_decision: str


# ─────────────────────────────────────────────
# 2. LLM
# ─────────────────────────────────────────────

def get_llm(model: str = OPENAI_MODEL) -> ChatOpenAI:
    return ChatOpenAI(model=model, max_tokens=1024, api_key=OPENAI_API_KEY)


# ─────────────────────────────────────────────
# 3. 노드
# ─────────────────────────────────────────────

def input_node(state: DebateState) -> dict:
    logger.info("[InputNode] topic=%s  max_round=%d", state["topic"], state["max_round"])
    return {
        "debate_round":   0,
        "pro_arguments":  [],
        "con_arguments":  [],
        "evidence":       [],
        "final_decision": "",
    }


def pro_agent(state: DebateState) -> dict:
    llm      = get_llm()
    round_num = state["debate_round"] + 1
    logger.info("[ProAgent] round=%d", round_num)

    prev_pro = "\n".join(m.content for m in state["pro_arguments"]) or "없음"
    prev_con = state["con_arguments"][-1].content if state["con_arguments"] else "없음"

    resp = llm.invoke([
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
    ])
    return {
        "pro_arguments": [HumanMessage(content=f"[R{round_num}] {resp.content}", name="pro")],
        "debate_round":  round_num,
    }


def con_agent(state: DebateState) -> dict:
    llm       = get_llm()
    round_num  = state["debate_round"]
    logger.info("[ConAgent] round=%d", round_num)

    latest_pro = state["pro_arguments"][-1].content if state["pro_arguments"] else "없음"
    prev_con   = "\n".join(m.content for m in state["con_arguments"]) or "없음"

    resp = llm.invoke([
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
    ])
    return {
        "con_arguments": [HumanMessage(content=f"[R{round_num}] {resp.content}", name="con")],
    }


def research_agent(state: DebateState) -> dict:
    llm       = get_llm()
    round_num  = state["debate_round"]
    logger.info("[ResearchAgent] round=%d", round_num)

    latest_pro = state["pro_arguments"][-1].content if state["pro_arguments"] else "없음"
    latest_con = state["con_arguments"][-1].content if state["con_arguments"] else "없음"

    resp = llm.invoke([
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
    ])
    return {
        "evidence": [HumanMessage(content=f"[R{round_num}] {resp.content}", name="research")],
    }


def debate_controller(state: DebateState) -> str:
    current = state["debate_round"]
    maximum = state["max_round"]
    result  = "continue" if current < maximum else "end"
    logger.info("[DebateController] round=%d/%d → %s", current, maximum, result)
    return result


def moderator(state: DebateState) -> dict:
    llm = get_llm()
    logger.info("[Moderator] 토론 종합 중...")

    all_pro      = "\n\n".join(m.content for m in state["pro_arguments"])
    all_con      = "\n\n".join(m.content for m in state["con_arguments"])
    all_evidence = "\n\n".join(m.content for m in state["evidence"])

    resp = llm.invoke([
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
    ])
    return {"final_decision": resp.content}


def output_node(state: DebateState) -> dict:
    logger.info(
        "[OutputNode] 완료 | round=%d | pro=%d con=%d evidence=%d",
        state["debate_round"],
        len(state["pro_arguments"]),
        len(state["con_arguments"]),
        len(state["evidence"]),
    )
    return {}


# ─────────────────────────────────────────────
# 4. 그래프 빌드 (싱글턴 캐싱)
# ─────────────────────────────────────────────

_graph = None

def build_debate_graph():
    global _graph
    if _graph is not None:
        return _graph

    g = StateGraph(DebateState)

    g.add_node("InputNode",     input_node)
    g.add_node("ProAgent",      pro_agent)
    g.add_node("ConAgent",      con_agent)
    g.add_node("ResearchAgent", research_agent)
    g.add_node("Moderator",     moderator)
    g.add_node("OutputNode",    output_node)

    g.add_edge("InputNode",  "ProAgent")
    g.add_edge("ProAgent",   "ConAgent")
    g.add_edge("ConAgent",   "ResearchAgent")

    g.add_conditional_edges(
        "ResearchAgent",
        debate_controller,
        {"continue": "ProAgent", "end": "Moderator"},
    )

    g.add_edge("Moderator",  "OutputNode")
    g.add_edge("OutputNode", END)

    g.set_entry_point("InputNode")

    _graph = g.compile()
    return _graph


# ─────────────────────────────────────────────
# 5. 헬퍼 — State → dict (JSON 직렬화용)
# ─────────────────────────────────────────────

def state_to_dict(state: DebateState) -> dict:
    """Message 객체를 문자열로 변환해 JSON-serializable dict 반환"""
    return {
        "topic":          state["topic"],
        "debate_round":   state["debate_round"],
        "max_round":      state["max_round"],
        "final_decision": state["final_decision"],
        "pro_arguments":  [m.content for m in state["pro_arguments"]],
        "con_arguments":  [m.content for m in state["con_arguments"]],
        "evidence":       [m.content for m in state["evidence"]],
    }
