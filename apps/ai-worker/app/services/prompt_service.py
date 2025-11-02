import os
import structlog
from .base_service import BaseService

logger = structlog.get_logger()

class PromptService(BaseService):
    """프롬프트 서비스 - 시스템 프롬프트 관리"""
    
    def __init__(self):
        super().__init__()
        self.default_lang = os.getenv("DEFAULT_LANG", "ko")
    
    async def initialize(self):
        """서비스 초기화"""
        try:
            logger.info("프롬프트 서비스 초기화")
            self.set_initialized(True)
            logger.info("프롬프트 서비스 초기화 완료")
        except Exception as e:
            logger.error("프롬프트 서비스 초기화 실패", error=str(e))
            raise
    
    async def get_system_prompt(self) -> str:
        """시스템 프롬프트 조회"""
        return """당신은 리브라입니다. Discord의 친근한 AI 어시스턴트입니다.

답변 방식:
- 자연스러운 한국어로 대화하세요
- 질문에 직접적으로 답변하세요
- 이전 대화를 기억하고 참고하세요
- 간결하고 명확하게 답변하세요"""
    
    async def cleanup(self):
        """서비스 정리"""
        logger.info("프롬프트 서비스 정리 완료")
