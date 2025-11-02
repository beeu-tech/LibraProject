"""
faster-whisper 기반 실시간 ASR 서비스
RTX 2070 최적화 (medium + int8_float16)
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import structlog
from typing import Optional, AsyncIterator
import asyncio

from .asr_engine import ASREngine

# 로거 설정
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()

# FastAPI 앱
app = FastAPI(
    title="Libra ASR Service",
    description="faster-whisper 기반 실시간 음성 인식",
    version="1.0.0",
)

# ASR 엔진 (전역 singleton)
asr_engine: Optional[ASREngine] = None


@app.on_event("startup")
async def startup_event():
    """앱 시작 시 ASR 엔진 초기화"""
    global asr_engine
    
    logger.info("ASR 서비스 시작 중...")
    
    # 환경변수 로드
    config = {
        "model_name": os.getenv("MODEL_NAME", "medium"),
        "compute_type": os.getenv("COMPUTE_TYPE", "int8_float16"),
        "device": os.getenv("DEVICE", "cuda"),
        "beam_size": int(os.getenv("BEAM_SIZE", "2")),
        "lang_hint": os.getenv("LANG_HINT", "ko"),
        "vad": os.getenv("VAD", "silero"),
        "vad_frame_ms": int(os.getenv("VAD_FRAME_MS", "30")),
        "window_s": float(os.getenv("WINDOW_S", "1.0")),
        "window_overlap_ms": int(os.getenv("WINDOW_OVERLAP_MS", "120")),
        "no_speech_threshold": float(os.getenv("NO_SPEECH_THRESHOLD", "0.6")),
        "condition_on_prev": os.getenv("CONDITION_ON_PREV", "true").lower() == "true",
    }
    
    logger.info("ASR 설정", config=config)
    
    # ASR 엔진 초기화
    try:
        asr_engine = ASREngine(config)
        await asr_engine.initialize()
        logger.info("ASR 엔진 초기화 완료")
    except Exception as e:
        logger.error("ASR 엔진 초기화 실패", error=str(e))
        raise


@app.on_event("shutdown")
async def shutdown_event():
    """앱 종료 시 정리"""
    global asr_engine
    
    logger.info("ASR 서비스 종료 중...")
    
    if asr_engine:
        await asr_engine.cleanup()
    
    logger.info("ASR 서비스 종료 완료")


class TranscribeRequest(BaseModel):
    """동기 변환 요청"""
    language: Optional[str] = "ko"
    beam_size: Optional[int] = None
    temperature: Optional[float] = 0.0


class TranscribeResponse(BaseModel):
    """변환 응답"""
    text: str
    language: str
    duration: float
    segments: list = []


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    audio_file: UploadFile = File(...),
    language: Optional[str] = "ko",
    beam_size: Optional[int] = None
):
    """
    음성 파일을 텍스트로 변환 (동기)
    
    - **audio_file**: 오디오 파일 (WAV, MP3, OGG 등)
    - **language**: 언어 힌트 (ko, en, auto 등)
    - **beam_size**: 빔 크기 (기본값: 설정값)
    """
    if not asr_engine:
        raise HTTPException(status_code=503, detail="ASR 엔진이 초기화되지 않았습니다")
    
    try:
        logger.info("동기 변환 시작", filename=audio_file.filename, language=language)
        
        # 파일 읽기
        audio_data = await audio_file.read()
        
        # 변환
        result = await asr_engine.transcribe_sync(
            audio_data,
            language=language,
            beam_size=beam_size
        )
        
        logger.info("동기 변환 완료", text_length=len(result["text"]))
        
        return TranscribeResponse(**result)
        
    except Exception as e:
        logger.error("동기 변환 실패", error=str(e))
        raise HTTPException(status_code=500, detail=f"변환 실패: {str(e)}")


@app.post("/transcribe-stream")
async def transcribe_stream(
    audio_file: UploadFile = File(...),
    language: Optional[str] = "ko"
):
    """
    음성 파일을 실시간 스트리밍으로 변환
    
    - **audio_file**: 오디오 파일
    - **language**: 언어 힌트
    
    Returns: Server-Sent Events (SSE) 스트림
    """
    if not asr_engine:
        raise HTTPException(status_code=503, detail="ASR 엔진이 초기화되지 않았습니다")
    
    try:
        logger.info("스트리밍 변환 시작", filename=audio_file.filename)
        
        # 파일 읽기
        audio_data = await audio_file.read()
        
        # 스트리밍 변환
        async def event_generator() -> AsyncIterator[str]:
            async for chunk in asr_engine.transcribe_stream(audio_data, language=language):
                # SSE 형식
                yield f"data: {chunk}\n\n"
            
            # 완료 신호
            yield "data: [DONE]\n\n"
        
        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        )
        
    except Exception as e:
        logger.error("스트리밍 변환 실패", error=str(e))
        raise HTTPException(status_code=500, detail=f"변환 실패: {str(e)}")


@app.get("/health")
async def health_check():
    """헬스체크"""
    if not asr_engine or not asr_engine.is_ready():
        raise HTTPException(status_code=503, detail="ASR 엔진이 준비되지 않았습니다")
    
    return {
        "status": "ok",
        "model": asr_engine.config.get("model_name"),
        "device": asr_engine.config.get("device"),
        "compute_type": asr_engine.config.get("compute_type"),
    }


@app.get("/models")
async def get_models():
    """사용 가능한 모델 목록"""
    return {
        "models": [
            {"name": "tiny", "size": "~75MB", "vram": "~1GB", "speed": "fastest", "accuracy": "low"},
            {"name": "base", "size": "~142MB", "vram": "~1GB", "speed": "fast", "accuracy": "medium"},
            {"name": "small", "size": "~466MB", "vram": "~2GB", "speed": "fast", "accuracy": "good"},
            {"name": "medium", "size": "~1.5GB", "vram": "~3GB", "speed": "balanced", "accuracy": "high"},
            {"name": "large-v3", "size": "~2.9GB", "vram": "~5GB", "speed": "slow", "accuracy": "highest"},
        ],
        "current": asr_engine.config.get("model_name") if asr_engine else None
    }


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("ASR_PORT", "5005"))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
        reload=False
    )

