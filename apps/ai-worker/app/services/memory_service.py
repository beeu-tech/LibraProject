import os
import json
import structlog
from typing import List, Dict, Optional
from .base_service import BaseService
import redis.asyncio as redis

logger = structlog.get_logger()

class MemoryService(BaseService):
    """메모리 서비스 - 대화 기록 관리 (Redis 기반)"""
    
    def __init__(self):
        super().__init__()
        self.database_url = os.getenv("DATABASE_URL", "")
        self.redis_url = os.getenv("REDIS_URL", "redis://redis:6379")
        self.redis_client = None
        self.max_history = 20  # 최대 대화 히스토리 개수
    
    async def initialize(self):
        """서비스 초기화"""
        try:
            logger.info("메모리 서비스 초기화", redis_url=self.redis_url)
            
            # Redis 연결
            self.redis_client = await redis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
            
            # 연결 테스트
            await self.redis_client.ping()
            
            self.set_initialized(True)
            logger.info("메모리 서비스 초기화 완료 (Redis 연결됨)")
        except Exception as e:
            logger.error("메모리 서비스 초기화 실패", error=str(e))
            # Redis 연결 실패해도 계속 진행 (히스토리 없이 동작)
            self.redis_client = None
            self.set_initialized(True)
    
    async def save_message(self, user_id: str, username: str, channel_id: str, content: str, message_id: str, role: str = "user"):
        """메시지 저장 (Redis)"""
        if not self.redis_client:
            return
        
        try:
            key = f"chat:history:{channel_id}:{user_id}"
            
            message = {
                "role": role,
                "content": content,
                "username": username,
                "message_id": message_id
            }
            
            # Redis List에 추가 (최신 메시지가 뒤에)
            await self.redis_client.rpush(key, json.dumps(message))
            
            # 오래된 메시지 삭제 (최대 개수 유지)
            await self.redis_client.ltrim(key, -self.max_history, -1)
            
            # TTL 설정 (1시간)
            await self.redis_client.expire(key, 3600)
            
            logger.debug("메시지 저장 완료", 
                        user_id=user_id, 
                        channel_id=channel_id,
                        role=role,
                        content_len=len(content))
        except Exception as e:
            logger.warning("메시지 저장 실패", error=str(e))
    
    async def get_conversation(self, user_id: str, channel_id: str, limit: int = 10) -> List[Dict]:
        """대화 기록 조회 (Redis)"""
        if not self.redis_client:
            return []
        
        try:
            key = f"chat:history:{channel_id}:{user_id}"
            
            # 최근 N개 메시지 조회
            messages_raw = await self.redis_client.lrange(key, -limit, -1)
            
            # JSON 파싱 및 필요한 필드만 추출
            conversation = []
            for msg_str in messages_raw:
                try:
                    msg = json.loads(msg_str)
                    conversation.append({
                        "role": msg.get("role", "user"),
                        "content": msg.get("content", "")
                    })
                except json.JSONDecodeError:
                    continue
            
            logger.debug("대화 기록 조회 완료", 
                        user_id=user_id, 
                        channel_id=channel_id, 
                        count=len(conversation))
            
            return conversation
        except Exception as e:
            logger.warning("대화 기록 조회 실패", error=str(e))
            return []
    
    async def cleanup(self):
        """서비스 정리"""
        if self.redis_client:
            await self.redis_client.close()
        logger.info("메모리 서비스 정리 완료")
