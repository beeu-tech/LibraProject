import os
import json
import httpx
import structlog
from typing import List, Dict, AsyncGenerator
from .base_service import BaseService

logger = structlog.get_logger()

class GroqService(BaseService):
    """Groq API 전용 서비스 - 로컬 추론 없음"""
    
    def __init__(self):
        super().__init__()
        self.api_key = os.getenv("OPENAI_API_KEY", "")
        self.base_url = os.getenv("OPENAI_BASE_URL", "https://api.groq.com/openai/v1")
        self.model = os.getenv("DEFAULT_MODEL", "llama-3.1-8b-instant")
        self.max_tokens = int(os.getenv("MAX_TOKENS", "256"))
        self.temperature = float(os.getenv("LLM_TEMPERATURE", "0.5"))
        self.timeout = float(os.getenv("LLM_TIMEOUT_SEC", "30"))
        
        # API 키 검증
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY가 설정되지 않았습니다!")
        
        if not self.api_key.startswith("gsk_"):
            logger.warning("API 키가 Groq 형식이 아닙니다", key_prefix=self.api_key[:10])
    
    async def initialize(self):
        """서비스 초기화 - 로컬 모델 로딩 없음"""
        try:
            logger.info("🌩️ Groq API 서비스 초기화",
                       base_url=self.base_url,
                       model=self.model)
            
            # API 연결 테스트
            await self._test_connection()
            
            self.set_initialized(True)
            logger.info("✅ Groq API 서비스 초기화 완료")
            
        except Exception as e:
            logger.error("❌ Groq API 서비스 초기화 실패", error=str(e))
            raise
    
    async def _test_connection(self):
        """Groq API 연결 테스트"""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/models",
                    headers={"Authorization": f"Bearer {self.api_key}"}
                )
                
                if response.status_code == 200:
                    models = response.json().get("data", [])
                    model_names = [m.get("id") for m in models]
                    logger.info("Groq API 연결 성공", models=model_names[:5])  # 처음 5개만
                else:
                    logger.warning("Groq API 연결 실패", status=response.status_code)
                    
        except Exception as e:
            logger.warning("Groq API 연결 테스트 실패", error=str(e))
    
    async def stream_response(self, messages: List[Dict], channel_id: str = "default") -> AsyncGenerator[Dict, None]:
        """Groq API 스트리밍 응답"""
        try:
            logger.info("🚀 Groq API 요청 시작",
                       model=self.model,
                       messages_count=len(messages),
                       channel_id=channel_id)
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                request_data = {
                    "model": self.model,
                    "messages": messages,
                    "stream": True,
                    "max_tokens": self.max_tokens,
                    "temperature": self.temperature,
                    "top_p": 0.9,
                    "frequency_penalty": 0.1,
                    "presence_penalty": 0.1,
                }
                
                print(f"[Groq] 요청 URL: {self.base_url}/chat/completions")
                print(f"[Groq] 요청 데이터: {request_data}")
                print(f"[Groq] API 키: {self.api_key[:10]}...")
                
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=request_data,
                )
                
                print(f"[Groq] 응답 상태: {response.status_code}")
                print(f"[Groq] 응답 헤더: {dict(response.headers)}")
                print(f"[Groq] 요청한 모델: {self.model}")
                print(f"[Groq] Temperature: {self.temperature}")
                print(f"[Groq] Max Tokens: {self.max_tokens}")
                
                if response.status_code != 200:
                    error_text = await response.aread()
                    print(f"[Groq] 에러 응답: {error_text.decode()}")
                    logger.error("Groq API 오류", 
                               status=response.status_code,
                               error=error_text.decode())
                    yield {"error": f"API 오류: {response.status_code}", "finished": True}
                    return
                
                # 응답 본문 확인
                print(f"[Groq] 응답 본문 길이: {len(response.content) if hasattr(response, 'content') else 'unknown'}")
                
                # SSE (Server-Sent Events) 스트리밍 처리
                line_count = 0
                content_count = 0
                total_content = ""  # 전체 응답 누적
                
                print(f"[Groq] 스트리밍 라인 처리 시작...")
                print(f"[Groq] Response has content: {hasattr(response, 'content')}")
                
                async for line in response.aiter_lines():
                    line_count += 1
                    if line_count <= 5 or content_count <= 5:
                        print(f"[Groq] 라인 #{line_count}: {line[:150]}")  # 처음 5개 라인만 상세 로그
                    
                    if not line.strip():
                        continue
                    
                    # SSE 형식: "data: {...}"
                    if line.startswith("data: "):
                        data_str = line[6:]  # "data: " 제거
                        
                        if data_str == "[DONE]":
                            print(f"[Groq] 스트리밍 완료: {content_count}개 청크, {line_count}줄 처리, 총 {len(total_content)}자")
                            logger.info(f"Groq 스트리밍 완료: {content_count}개 청크, {line_count}줄 처리, 총 {len(total_content)}자")
                            
                            # 빈 응답인 경우 fallback 메시지 전송
                            if content_count == 0 or len(total_content.strip()) == 0:
                                print("⚠️ Groq가 빈 응답 반환 → fallback 메시지 전송")
                                logger.warning("⚠️ Groq가 빈 응답 반환 → fallback 메시지 전송")
                                yield {
                                    "content": "네, 알겠습니다.",
                                    "finished": False,
                                    "model": self.model
                                }
                            
                            yield {"finished": True, "model": self.model}
                            break
                        
                        try:
                            data = json.loads(data_str)
                            
                            # 응답 청크 처리
                            choices = data.get("choices", [])
                            
                            if content_count <= 3:
                                print(f"[Groq] 청크 파싱: choices={len(choices)}, data keys={list(data.keys())}")
                            
                            if choices:
                                delta = choices[0].get("delta", {})
                                print(f"[Groq] delta: {delta}")
                                
                                content = delta.get("content", "")
                                print(f"[Groq] content: '{content}'")
                                
                                if content:
                                    content_count += 1
                                    total_content += content  # 전체 응답 누적
                                    print(f"[Groq] 청크 #{content_count}: '{content}' ({len(content)}자)")
                                    logger.info(f"Groq 청크 #{content_count}: {len(content)}자")
                                    yield {
                                        "content": content,
                                        "finished": False,
                                        "model": self.model
                                    }
                                else:
                                    print(f"[Groq] 빈 content, 스킵")
                                
                                # 완료 확인
                                finish_reason = choices[0].get("finish_reason")
                                if finish_reason:
                                    print(f"[Groq] 완료: reason={finish_reason}")
                                    logger.info(f"Groq 완료: reason={finish_reason}, 총 {content_count}개 청크")
                                    yield {"finished": True, "model": self.model}
                            else:
                                print(f"[Groq] choices가 비어있음")
                                
                        except Exception as e:
                            print(f"[Groq] JSON 파싱 에러: {e}")
                            print(f"[Groq] 원본 데이터: {data_str}")
                            logger.error("Groq 청크 파싱 실패", error=str(e), line=line[:100])
                            continue
                            
        except Exception as e:
            logger.error("Groq API 스트리밍 실패", error=str(e))
            yield {"error": str(e), "finished": True}
    
    async def cleanup(self):
        """서비스 정리 - 로컬 리소스 없음"""
        logger.info("Groq API 서비스 정리 완료")
    
    def get_available_models(self) -> List[str]:
        """사용 가능한 모델 목록"""
        return [self.model]
