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
    description="Discord 봇용 AI 워커 서비스",
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

# 메트릭 초기화
Instrumentator().instrument(app).expose(app, endpoint="/metrics")

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
    logger.info("AI Worker 시작 중...")
    
    # 데이터베이스 초기화
    await init_db()
    
    # 서비스 초기화
    await groq_service.initialize()
    await memory_service.initialize()
    await prompt_service.initialize()
    
    # 메트릭 초기화 (startup 이벤트에서는 미들웨어 추가 불가)
    # Instrumentator().instrument(app).expose(app, endpoint="/metrics")
    
    logger.info("AI Worker 시작 완료")

@app.on_event("shutdown")
async def shutdown_event():
    """앱 종료 시 정리"""
    logger.info("AI Worker 종료 중...")
    
    # 서비스 정리
    await groq_service.cleanup()
    await memory_service.cleanup()
    
    logger.info("AI Worker 종료 완료")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    """요청 로깅 미들웨어"""
    start_time = time.time()
    
    response = await call_next(request)
    
    process_time = time.time() - start_time
    
    logger.info(
        "HTTP 요청 처리 완료",
        method=request.method,
        url=str(request.url),
        status_code=response.status_code,
        process_time=process_time
    )
    
    return response

@app.middleware("http")
async def verify_shared_secret(request: Request, call_next):
    """간단한 Shared Secret 인증 미들웨어 (BFF 제거 후 단순화)"""
    # 헬스체크와 메트릭은 인증 제외
    if request.url.path.startswith("/health") or request.url.path.startswith("/metrics") or request.url.path.startswith("/api/health"):
        return await call_next(request)
    
    try:
        logger.info("AI Worker 요청 수신", method=request.method, path=request.url.path)
        
        # Shared Secret 확인
        secret = os.getenv("WORKER_SHARED_SECRET", "default")
        provided_secret = request.headers.get("X-Shared-Secret")
        
        # 개발 환경에서는 secret이 없어도 허용 (선택적)
        if not provided_secret:
            logger.warning("X-Shared-Secret 헤더 없음 - 개발 환경에서는 허용")
            # 프로덕션에서는 아래 주석 해제
            # raise HTTPException(status_code=401, detail="Missing X-Shared-Secret header")
        elif provided_secret != secret:
            logger.error("잘못된 Shared Secret")
            raise HTTPException(status_code=401, detail="Invalid shared secret")
        
        logger.info("AI Worker 인증 성공")
        return await call_next(request)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("인증 미들웨어 오류", error=str(e))
        raise HTTPException(status_code=500, detail="Authentication middleware error")

if __name__ == "__main__":
    port = int(os.getenv("AI_WORKER_PORT", 8000))
    uvicorn.run(
        "app.libraAiWorker:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info"
    )
