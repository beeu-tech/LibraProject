"""
LLM 응답 캐싱 서비스
동일한 요청에 대한 중복 LLM 호출 방지로 속도 향상 및 비용 절감
"""

import os
import hashlib
import json
from typing import Optional
from redis import asyncio as aioredis
import structlog

logger = structlog.get_logger(__name__)


class LLMCacheService:
    """LLM 응답 캐싱 서비스"""
    
    def __init__(self):
        self.redis = None
        self.enabled = os.getenv("LLM_CACHE_ENABLED", "1") == "1"
        self.ttl = int(os.getenv("LLM_CACHE_TTL", "300"))  # 기본 5분
        self.prefix = "llm:cache:"
    
    async def initialize(self):
        """Redis 연결 초기화"""
        if not self.enabled:
            logger.info("LLM 캐시 비활성화됨")
            return
        
        try:
            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            self.redis = await aioredis.from_url(
                redis_url,
                decode_responses=True,
                socket_connect_timeout=5
            )
            
            # 연결 테스트
            await self.redis.ping()
            logger.info("LLM 캐시 서비스 초기화 완료", ttl=self.ttl)
            
        except Exception as e:
            logger.warning("LLM 캐시 초기화 실패 (캐싱 비활성화)", error=str(e))
            self.enabled = False
            self.redis = None
    
    async def cleanup(self):
        """Redis 연결 종료"""
        if self.redis:
            await self.redis.close()
            logger.info("LLM 캐시 서비스 종료")
    
    def _generate_cache_key(self, messages: list, model: str, user_id: str = "") -> str:
        """
        메시지, 모델, 사용자 ID로 캐시 키 생성
        
        Args:
            messages: 대화 메시지 리스트
            model: 사용된 모델명
            user_id: 사용자 ID (선택, 사용자별 캐시 분리)
            
        Returns:
            캐시 키 문자열
        """
        # 시스템 프롬프트 제외 (사용자 메시지만 해싱)
        user_messages = [m for m in messages if m.get("role") != "system"]
        
        # JSON 직렬화 (정렬하여 일관성 유지)
        content = json.dumps({
            "messages": user_messages,
            "model": model,
            "user_id": user_id
        }, sort_keys=True, ensure_ascii=False)
        
        # SHA256 해싱
        hash_value = hashlib.sha256(content.encode('utf-8')).hexdigest()
        
        return f"{self.prefix}{hash_value}"
    
    async def get_cached_response(
        self, 
        messages: list, 
        model: str,
        user_id: str = ""
    ) -> Optional[str]:
        """
        캐시에서 응답 조회
        
        Args:
            messages: 대화 메시지 리스트
            model: 모델명
            user_id: 사용자 ID
            
        Returns:
            캐시된 응답 또는 None
        """
        if not self.enabled or not self.redis:
            return None
        
        try:
            key = self._generate_cache_key(messages, model, user_id)
            cached = await self.redis.get(key)
            
            if cached:
                logger.info("LLM 캐시 히트 🎯", 
                           key_prefix=key[:20], 
                           model=model,
                           length=len(cached))
                return cached
            
            logger.debug("LLM 캐시 미스", key_prefix=key[:20])
            return None
            
        except Exception as e:
            logger.error("캐시 조회 실패", error=str(e))
            return None
    
    async def cache_response(
        self,
        messages: list,
        model: str,
        response: str,
        user_id: str = "",
        ttl: Optional[int] = None
    ):
        """
        응답을 캐시에 저장
        
        Args:
            messages: 대화 메시지 리스트
            model: 모델명
            response: LLM 응답
            user_id: 사용자 ID
            ttl: 만료 시간 (초, 기본값은 self.ttl)
        """
        if not self.enabled or not self.redis or not response:
            return
        
        try:
            key = self._generate_cache_key(messages, model, user_id)
            expire_time = ttl or self.ttl
            
            await self.redis.setex(key, expire_time, response)
            
            logger.info("LLM 응답 캐시됨 💾", 
                       key_prefix=key[:20], 
                       model=model,
                       length=len(response),
                       ttl=expire_time)
            
        except Exception as e:
            logger.error("캐시 저장 실패", error=str(e))
    
    async def invalidate_user_cache(self, user_id: str):
        """
        특정 사용자의 캐시 무효화
        
        Args:
            user_id: 사용자 ID
        """
        if not self.enabled or not self.redis:
            return
        
        try:
            # 사용자 ID를 포함하는 모든 캐시 키 찾기
            pattern = f"{self.prefix}*{user_id}*"
            cursor = 0
            deleted_count = 0
            
            while True:
                cursor, keys = await self.redis.scan(cursor, match=pattern, count=100)
                if keys:
                    deleted_count += await self.redis.delete(*keys)
                
                if cursor == 0:
                    break
            
            logger.info("사용자 캐시 무효화", user_id=user_id, deleted=deleted_count)
            
        except Exception as e:
            logger.error("캐시 무효화 실패", error=str(e))
    
    async def clear_all_cache(self):
        """모든 LLM 캐시 삭제"""
        if not self.enabled or not self.redis:
            return
        
        try:
            pattern = f"{self.prefix}*"
            cursor = 0
            deleted_count = 0
            
            while True:
                cursor, keys = await self.redis.scan(cursor, match=pattern, count=100)
                if keys:
                    deleted_count += await self.redis.delete(*keys)
                
                if cursor == 0:
                    break
            
            logger.info("모든 LLM 캐시 삭제", deleted=deleted_count)
            
        except Exception as e:
            logger.error("캐시 삭제 실패", error=str(e))
    
    async def get_cache_stats(self) -> dict:
        """캐시 통계 조회"""
        if not self.enabled or not self.redis:
            return {"enabled": False}
        
        try:
            pattern = f"{self.prefix}*"
            cursor = 0
            total_keys = 0
            total_size = 0
            
            while True:
                cursor, keys = await self.redis.scan(cursor, match=pattern, count=100)
                total_keys += len(keys)
                
                for key in keys:
                    value = await self.redis.get(key)
                    if value:
                        total_size += len(value)
                
                if cursor == 0:
                    break
            
            return {
                "enabled": True,
                "total_keys": total_keys,
                "total_size_bytes": total_size,
                "ttl": self.ttl
            }
            
        except Exception as e:
            logger.error("캐시 통계 조회 실패", error=str(e))
            return {"enabled": True, "error": str(e)}


# 전역 캐시 서비스 인스턴스
cache_service = LLMCacheService()

