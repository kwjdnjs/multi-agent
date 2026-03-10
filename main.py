"""
main.py
───────
FastAPI 서버 — LangGraph 토론 시스템 API

엔드포인트:
  POST /debate          동기 실행 → 완료 후 전체 결과 반환
  POST /debate/stream   SSE 스트리밍 → 노드 완료마다 이벤트 전송
  GET  /health          헬스 체크
  GET  /docs            Swagger UI (자동 생성)

실행:
  uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

import asyncio
import json
import logging
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from debate_graph import build_debate_graph, state_to_dict, DebateState

# ─────────────────────────────────────────────
# 로깅 설정
# ─────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# FastAPI 앱 초기화
# ─────────────────────────────────────────────

app = FastAPI(
    title="LangGraph Debate API",
    description="GPT 기반 멀티 에이전트 토론 시스템 API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────
# 스키마
# ─────────────────────────────────────────────

class DebateRequest(BaseModel):
    topic:     str = Field(..., min_length=5, description="토론 주제")
    max_round: int = Field(default=3, ge=1, le=5, description="토론 라운드 수 (1~5)")

    model_config = {
        "json_schema_extra": {
            "example": {
                "topic":     "AI가 인간의 창의적 일자리를 대체해야 하는가?",
                "max_round": 2,
            }
        }
    }


class RoundSummary(BaseModel):
    round:    int
    pro:      str
    con:      str
    evidence: str


class DebateResponse(BaseModel):
    topic:          str
    debate_round:   int
    max_round:      int
    pro_arguments:  list[str]
    con_arguments:  list[str]
    evidence:       list[str]
    final_decision: str
    rounds:         list[RoundSummary]


# ─────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────

def build_initial_state(req: DebateRequest) -> DebateState:
    return {
        "topic":          req.topic,
        "pro_arguments":  [],
        "con_arguments":  [],
        "evidence":       [],
        "debate_round":   0,
        "max_round":      req.max_round,
        "final_decision": "",
    }


def build_rounds(state_dict: dict) -> list[RoundSummary]:
    """라운드별 찬성/반대/근거를 묶어서 반환"""
    pros      = state_dict["pro_arguments"]
    cons      = state_dict["con_arguments"]
    evidences = state_dict["evidence"]
    rounds    = []
    for i in range(state_dict["debate_round"]):
        rounds.append(RoundSummary(
            round    = i + 1,
            pro      = pros[i]      if i < len(pros)      else "",
            con      = cons[i]      if i < len(cons)      else "",
            evidence = evidences[i] if i < len(evidences) else "",
        ))
    return rounds


# ─────────────────────────────────────────────
# 엔드포인트
# ─────────────────────────────────────────────

@app.get("/health", tags=["System"])
async def health():
    """서버 상태 확인"""
    return {"status": "ok"}


@app.post("/debate", response_model=DebateResponse, tags=["Debate"])
async def run_debate(req: DebateRequest):
    """
    토론을 동기 방식으로 실행합니다.
    모든 라운드가 끝난 뒤 전체 결과를 한 번에 반환합니다.
    """
    logger.info("POST /debate | topic=%s | max_round=%d", req.topic, req.max_round)

    try:
        graph        = build_debate_graph()
        initial      = build_initial_state(req)
        final_state  = await asyncio.to_thread(graph.invoke, initial)
        state_dict   = state_to_dict(final_state)
    except Exception as e:
        logger.exception("그래프 실행 오류")
        raise HTTPException(status_code=500, detail=str(e))

    return DebateResponse(
        **state_dict,
        rounds=build_rounds(state_dict),
    )


@app.post("/debate/stream", tags=["Debate"])
async def stream_debate(req: DebateRequest):
    """
    토론을 SSE(Server-Sent Events) 스트리밍으로 실행합니다.
    각 노드가 완료될 때마다 이벤트를 전송합니다.

    클라이언트 수신 예시:
    ```js
    const es = new EventSource('/debate/stream');
    es.onmessage = (e) => console.log(JSON.parse(e.data));
    ```
    """
    logger.info("POST /debate/stream | topic=%s | max_round=%d", req.topic, req.max_round)

    async def event_generator() -> AsyncIterator[str]:
        try:
            graph   = build_debate_graph()
            initial = build_initial_state(req)

            # LangGraph .stream() 은 동기 제너레이터 → asyncio.to_thread 래핑
            def _stream():
                return list(graph.stream(initial))

            events = await asyncio.to_thread(_stream)

            for event in events:
                for node_name, node_state in event.items():
                    payload = {
                        "node": node_name,
                        "state": {
                            k: (
                                [m.content for m in v]
                                if isinstance(v, list) else v
                            )
                            for k, v in node_state.items()
                        },
                    }
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    await asyncio.sleep(0)   # 이벤트 루프 양보

            # 완료 이벤트
            yield f"data: {json.dumps({'node': '__end__', 'state': {}}, ensure_ascii=False)}\n\n"

        except Exception as e:
            logger.exception("스트리밍 오류")
            err = json.dumps({"error": str(e)}, ensure_ascii=False)
            yield f"data: {err}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":  "no-cache",
            "X-Accel-Buffering": "no",
        },
    )