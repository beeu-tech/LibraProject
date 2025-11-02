from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import uvicorn
import os
import time
import hmac
import hashlib
from dotenv import load_dotenv
import structlog
from prometheus_fastapi_instrumentator import Instrumentator

from .routes import chat, health, stt
from .services.groq_service import GroqService
from .services.memory_service import MemoryService
from .services.prompt_service import PromptService
from .services.cache_service import cache_service
from .database import init_db

# 환경변수 로드
load_dotenv()

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

# FastAPI 앱 생성
app = FastAPI(
    title="Libra Bot AI Worker",
    description="Discord 봇용 AI 워커 서비스 (Groq API 전용)",
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

# 서비스 초기화
groq_service = GroqService()
memory_service = MemoryService()
prompt_service = PromptService()

# 라우트 등록
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(stt.router, prefix="/api", tags=["stt"])

@app.on_event("startup")
async def startup_event():
    """앱 시작 시 초기화"""
    logger.info("🌩️ AI Worker 시작 중... (Groq API 전용)")
    
    # 데이터베이스 초기화
    await init_db()
    
    # 서비스 초기화
    await groq_service.initialize()
    await memory_service.initialize()
    await prompt_service.initialize()
    await cache_service.initialize()
    
    logger.info("✅ AI Worker 초기화 완료 - Groq API 모드")
    logger.info("🚀 로컬 추론 없음 - 모든 요청은 Groq API로 전달됩니다")

@app.on_event("shutdown")
async def shutdown_event():
    """앱 종료 시 정리"""
    logger.info("AI Worker 종료 중...")
    await groq_service.cleanup()
    await memory_service.cleanup()
    await prompt_service.cleanup()
    await cache_service.cleanup()
    logger.info("AI Worker 종료 완료")

# Prometheus 메트릭 설정
try:
    Instrumentator().instrument(app).expose(app)
    logger.info("Prometheus 메트릭 활성화")
except Exception as e:
    logger.warning("Prometheus 메트릭 설정 실패", error=str(e))

# 서명 검증 미들웨어
@app.middleware("http")
async def verify_signature(request: Request, call_next):
    """요청 서명 검증"""
    if request.url.path.startswith("/api/"):
        # 개발 환경에서는 서명 검증 건너뛰기
        auth_mode = os.getenv("AUTH_MODE", "simple")
        if auth_mode == "simple":
            response = await call_next(request)
            return response
        
        # 프로덕션 환경에서 서명 검증
        signature = request.headers.get("X-Signature")
        timestamp = request.headers.get("X-Timestamp")
        
        if not signature or not timestamp:
            return HTTPException(status_code=401, detail="서명이 필요합니다")
        
        # 타임스탬프 검증 (5분 이내)
        current_time = int(time.time())
        if abs(current_time - int(timestamp)) > 300:
            return HTTPException(status_code=401, detail="요청 시간이 만료되었습니다")
        
        # 서명 검증
        shared_secret = os.getenv("WORKER_SHARED_SECRET", "")
        if not shared_secret:
            logger.warning("WORKER_SHARED_SECRET이 설정되지 않음 - 개발 환경에서는 허용")
            response = await call_next(request)
            return response
        
        body = await request.body()
        expected_signature = hmac.new(
            shared_secret.encode(),
            f"{timestamp}:{body.decode()}".encode(),
            hashlib.sha256
        ).hexdigest()
        
        if not hmac.compare_digest(signature, expected_signature):
            return HTTPException(status_code=401, detail="잘못된 서명입니다")
    
    response = await call_next(request)
    return response

if __name__ == "__main__":
    port = int(os.getenv("AI_WORKER_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)