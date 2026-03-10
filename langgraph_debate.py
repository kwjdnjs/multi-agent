"""
langgraph_debate.py
────────────────────
CLI 실행 진입점.
debate_graph 모듈을 import해서 터미널에서 직접 토론을 실행합니다.

실행:
    python langgraph_debate.py
    DEBATE_TOPIC="주 4일제 도입해야 하는가?" DEBATE_MAX_ROUND=2 python langgraph_debate.py
"""

import os
import sys
from dotenv import load_dotenv
from debate_graph import build_debate_graph, state_to_dict

load_dotenv()

DEBATE_TOPIC     = os.environ.get("DEBATE_TOPIC", "AI가 인간의 창의적 일자리를 대체해야 하는가?")
DEBATE_MAX_ROUND = int(os.environ.get("DEBATE_MAX_ROUND", "3"))
OPENAI_MODEL     = os.environ.get("OPENAI_MODEL", "gpt-4o")


def main():
    print(f"\n{'='*60}")
    print("  LANGGRAPH DEBATE SYSTEM  (CLI)")
    print(f"{'='*60}")
    print(f"  모델   : {OPENAI_MODEL}")
    print(f"  주제   : {DEBATE_TOPIC}")
    print(f"  라운드 : {DEBATE_MAX_ROUND}회")
    print(f"{'='*60}\n")

    graph = build_debate_graph()

    initial_state = {
        "topic":          DEBATE_TOPIC,
        "pro_arguments":  [],
        "con_arguments":  [],
        "evidence":       [],
        "debate_round":   0,
        "max_round":      DEBATE_MAX_ROUND,
        "final_decision": "",
    }

    # 노드별 실시간 출력
    for event in graph.stream(initial_state):
        for node_name, node_state in event.items():
            print(f"\n  ── {node_name} ──")
            if "pro_arguments" in node_state and node_state["pro_arguments"]:
                print(f"  [✦ 찬성] {node_state['pro_arguments'][-1].content}")
            if "con_arguments" in node_state and node_state["con_arguments"]:
                print(f"  [✖ 반대] {node_state['con_arguments'][-1].content}")
            if "evidence" in node_state and node_state["evidence"]:
                print(f"  [◎ 근거] {node_state['evidence'][-1].content}")
            if "final_decision" in node_state and node_state["final_decision"]:
                print(f"\n{'='*60}")
                print("  ⚖ 최종 판정")
                print(f"{'='*60}")
                print(f"\n{node_state['final_decision']}\n")
                print(f"{'='*60}")

    print("\n  ■ 토론 완료\n")


if __name__ == "__main__":
    main()
