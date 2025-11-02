"""
STT 전용 AI Worker
데이터베이스 없이 STT 기능만 테스트
"""

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
import tempfile
import structlog
from prometheus_fastapi_instrumentator import Instrumentator

# STT 서비스를 직접 임포트하지 않고 인라인으로 구현
import vosk
import json
import wave

# 로거 설정
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()

# STT 서비스 초기화
stt_model = None
model_path = os.getenv("VOSK_MODEL_PATH", "/app/models/vosk-model-small-en-us-0.15")
sample_rate = int(os.getenv("VOSK_SAMPLE_RATE", "16000"))

def init_stt_model():
    global stt_model
    try:
        if os.path.exists(model_path):
            stt_model = vosk.Model(model_path)
            logger.info("Vosk model loaded successfully", path=model_path)
        else:
            logger.error("Vosk model not found", path=model_path)
    except Exception as e:
        logger.error("Failed to load Vosk model", error=str(e), path=model_path)

def transcribe_audio_file(file_path: str) -> str:
    """WAV 파일을 텍스트로 변환"""
    if not stt_model:
        return None
    
    try:
        with wave.open(file_path, 'rb') as wf:
            rec = vosk.KaldiRecognizer(stt_model, wf.getframerate())
            rec.SetWords(True)
            
            while True:
                data = wf.readframes(4000)
                if len(data) == 0:
                    break
                if rec.AcceptWaveform(data):
                    result = json.loads(rec.Result())
                    return result.get('text', '').strip()
            
            # 부분 결과
            partial = json.loads(rec.PartialResult())
            return partial.get('partial', '').strip()
    except Exception as e:
        logger.error("STT transcription failed", error=str(e))
        return None

# FastAPI 앱 생성
app = FastAPI(
    title="Libra Bot STT Worker",
    description="STT 전용 AI 워커 서비스",
    version="1.0.0",
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health():
    """헬스체크"""
    return {"status": "ok", "service": "stt-worker"}

@app.get("/api/stt/health")
async def stt_health():
    """STT 서비스 헬스체크"""
    try:
        model_info = {
            "available": stt_model is not None,
            "model_path": model_path,
            "sample_rate": sample_rate,
            "vosk_installed": True
        }
        return {
            "status": "ok",
            "service": "stt",
            "model_info": model_info
        }
    except Exception as e:
        logger.error("STT health check failed", error=str(e))
        raise HTTPException(status_code=500, detail="STT service unavailable")

@app.post("/api/stt/transcribe")
async def transcribe_audio(audio_file: UploadFile = File(...)):
    """
    오디오 파일을 텍스트로 변환
    """
    if not stt_model:
        raise HTTPException(
            status_code=503, 
            detail="STT service not available. Check model installation."
        )
    
    # 파일 형식 검증
    if not audio_file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    
    allowed_extensions = ['.wav', '.mp3', '.ogg', '.flac']
    file_ext = os.path.splitext(audio_file.filename.lower())[1]
    
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400, 
            detail=f"Unsupported file format. Allowed: {allowed_extensions}"
        )
    
    # 임시 파일로 저장
    temp_file = None
    try:
        # 임시 파일 생성
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as temp_file:
            content = await audio_file.read()
            temp_file.write(content)
            temp_file_path = temp_file.name
        
        logger.info("Audio file uploaded", 
                   filename=audio_file.filename, 
                   size=len(content),
                   temp_path=temp_file_path)
        
        # STT 변환 수행
        text = transcribe_audio_file(temp_file_path)
        
        if text is None:
            raise HTTPException(
                status_code=500, 
                detail="Failed to transcribe audio"
            )
        
        logger.info("STT transcription successful", 
                   text_length=len(text),
                   text_preview=text[:100])
        
        return {
            "status": "success",
            "text": text,
            "confidence": 1.0,
            "language": "en",
            "duration": len(content) / 16000
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("STT transcription failed", error=str(e))
        raise HTTPException(status_code=500, detail="Internal STT error")
    
    finally:
        # 임시 파일 정리
        if temp_file and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
                logger.debug("Temporary file cleaned up", path=temp_file_path)
            except Exception as e:
                logger.warning("Failed to clean up temporary file", 
                             error=str(e), path=temp_file_path)

@app.get("/api/stt/models")
async def list_models():
    """사용 가능한 STT 모델 목록"""
    try:
        model_info = {
            "available": stt_model is not None,
            "model_path": model_path,
            "sample_rate": sample_rate,
            "vosk_installed": True
        }
        return {
            "status": "ok",
            "models": [model_info],
            "current_model": model_path
        }
    except Exception as e:
        logger.error("Failed to list STT models", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to list models")

@app.on_event("startup")
async def startup_event():
    """앱 시작 시 초기화"""
    logger.info("STT Worker 시작 중...")
    
    # STT 모델 초기화
    init_stt_model()
    
    # 메트릭 초기화 (비활성화)
    # Instrumentator().instrument(app).expose(app, endpoint="/metrics")
    
    logger.info("STT Worker 시작 완료")

@app.on_event("shutdown")
async def shutdown_event():
    """앱 종료 시 정리"""
    logger.info("STT Worker 종료 중...")
    logger.info("STT Worker 종료 완료")

if __name__ == "__main__":
    port = int(os.getenv("AI_WORKER_PORT", 8000))
    uvicorn.run(
        "app.stt_only_main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info"
    )
