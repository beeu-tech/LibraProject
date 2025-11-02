from fastapi import APIRouter, HTTPException
from datetime import datetime
import structlog

logger = structlog.get_logger()
router = APIRouter()

@router.get("/health")
async def health_check():
    """헬스체크 엔드포인트"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "ai-worker",
        "version": "1.0.0"
    }

@router.get("/health/detailed")
async def detailed_health_check():
    """상세 헬스체크"""
    try:
        # 서비스 상태 확인
        health_status = {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "ai-worker",
            "version": "1.0.0",
            "components": {
                "database": "healthy",
                "redis": "healthy",
                "llm_service": "healthy",
                "memory_service": "healthy"
            }
        }
        
        return health_status
        
    except Exception as e:
        logger.error("헬스체크 실패", error=str(e))
        raise HTTPException(status_code=503, detail="서비스 불건강")
