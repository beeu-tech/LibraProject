from abc import ABC, abstractmethod
import structlog

logger = structlog.get_logger()

class BaseService(ABC):
    """모든 서비스의 기본 클래스"""
    
    def __init__(self):
        self.initialized = False
    
    @abstractmethod
    async def initialize(self):
        """서비스 초기화"""
        pass
    
    @abstractmethod
    async def cleanup(self):
        """서비스 정리"""
        pass
    
    def is_initialized(self) -> bool:
        """초기화 상태 확인"""
        return self.initialized
    
    def set_initialized(self, status: bool = True):
        """초기화 상태 설정"""
        self.initialized = status
