from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List
import json
import structlog
import asyncio

from ..services.groq_service import GroqService
from ..services.memory_service import MemoryService
from ..services.prompt_service import PromptService

logger = structlog.get_logger()
router = APIRouter()

# 서비스 인스턴스 - Groq API만 사용
groq_service = GroqService()
memory_service = MemoryService()
prompt_service = PromptService()

# 서비스 초기화 상태
_services_initialized = False

async def ensure_services_initialized():
    """서비스가 초기화되었는지 확인하고 필요시 초기화"""
    global _services_initialized
    if not _services_initialized:
        try:
            print("[Chat] 🌩️ Groq API 서비스 초기화 시작")
            await groq_service.initialize()
            await memory_service.initialize()
            await prompt_service.initialize()
            _services_initialized = True
            print("[Chat] ✅ Groq API 서비스 초기화 완료")
        except Exception as e:
            print(f"[Chat] ❌ 서비스 초기화 실패: {str(e)}")
            raise

class ChatRequest(BaseModel):
    # Bot 호환성을 위해 content와 messages 모두 Optional
    content: Optional[str] = Field(None, description="메시지 내용 (Bot 형식)")
    messages: Optional[List[dict]] = Field(None, description="대화 메시지 목록 (표준 형식)")
    userId: str = Field(..., description="사용자 ID")
    username: str = Field(..., description="사용자명")
    channelId: str = Field(..., description="채널 ID")
    guildId: Optional[str] = Field(None, description="길드 ID")
    messageId: str = Field(..., description="메시지 ID")

@router.post("/chat/completions")
async def chat_completions(request: ChatRequest):
    """Groq API를 통한 채팅 완성"""
    try:
        # Bot 형식 (content)과 표준 형식 (messages) 모두 지원
        user_message = ""
        if request.content:
            # Bot 형식: content 필드 사용
            user_message = request.content
        elif request.messages and len(request.messages) > 0:
            # 표준 형식: messages 배열 사용
            user_message = request.messages[-1].get("content", "")
        else:
            raise HTTPException(status_code=400, detail="content 또는 messages 필드가 필요합니다")
        
        print("=== AI Worker 채팅 엔드포인트 호출됨 ===")
        print(f"사용자: {request.username} ({request.userId})")
        print(f"메시지: {user_message}")
        print(f"채널: {request.channelId}")
        print("=====================================")
        
        # 서비스 초기화 확인
        await ensure_services_initialized()
        
        # 메시지 저장
        await memory_service.save_message(
            user_id=request.userId,
            username=request.username,
            channel_id=request.channelId,
            content=user_message,
            message_id=request.messageId
        )
        
        # 대화 기록 조회
        conversation = await memory_service.get_conversation(
            user_id=request.userId,
            channel_id=request.channelId,
            limit=10
        )
        
        # 프롬프트 생성
        system_prompt = await prompt_service.get_system_prompt()
        
        # 메시지 배열 구성 (system → 과거 대화 → 현재 사용자 메시지)
        messages = [{"role": "system", "content": system_prompt}]
        
        # 과거 대화 히스토리 추가
        if conversation:
            messages.extend(conversation)
        
        # ✅ 현재 사용자 메시지 추가 (이게 핵심!)
        messages.append({"role": "user", "content": user_message})
        
        print(f"[Stream] 📨 메시지 구성 완료: {len(messages)}개 메시지")
        print(f"[Stream] 시스템: 1개, 히스토리: {len(conversation)}개, 현재: 1개")
        print(f"[Stream] 사용자 질문: {user_message[:100]}")
        
        # 디버깅: 전체 메시지 출력
        print("\n=== Groq에 전달되는 전체 메시지 ===")
        for i, msg in enumerate(messages):
            role = msg.get('role', 'unknown')
            content = msg.get('content', '')[:100]
            print(f"{i+1}. [{role}] {content}")
        print("=" * 50 + "\n")
        
        print("[Stream] 🚀 Groq API 스트리밍 응답 시작")
        
        async def generate_response():
            try:
                chunk_count = 0
                full_response = ""  # AI 응답 전체 누적
                
                async for chunk in groq_service.stream_response(messages, request.channelId):
                    chunk_count += 1
                    print(f"[Stream] 청크 #{chunk_count}: error={chunk.get('error')}, content={chunk.get('content')[:20] if chunk.get('content') else None}, finished={chunk.get('finished')}")
                    
                    if chunk.get("error"):
                        yield f"data: {json.dumps({'error': chunk['error']})}\n\n"
                        break
                    
                    if chunk.get("content"):
                        content = chunk['content']
                        
                        # <think> 태그 필터링 (Qwen 모델 추론 과정 제거)
                        if '<think>' in full_response or '<think>' in content:
                            full_response += content
                            # <think> 태그 안의 내용은 전송하지 않음
                            if '</think>' in full_response:
                                # 태그 종료 후부터만 전송
                                parts = full_response.split('</think>')
                                if len(parts) > 1:
                                    clean_content = parts[-1]
                                    full_response = clean_content
                                    if clean_content.strip():
                                        yield f"data: {json.dumps({'content': clean_content})}\n\n"
                            continue
                        
                        full_response += content  # 응답 누적
                        yield f"data: {json.dumps({'content': content})}\n\n"
                    
                    if chunk.get("finished"):
                        print(f"[Stream] ✅ 스트리밍 완료: 총 {chunk_count}개 청크, 응답 길이: {len(full_response)}")
                        
                        # AI 응답을 히스토리에 저장
                        if full_response.strip():
                            await memory_service.save_message(
                                user_id=request.userId,
                                username="assistant",
                                channel_id=request.channelId,
                                content=full_response,
                                message_id=f"{request.messageId}_response",
                                role="assistant"
                            )
                        
                        yield f"data: {json.dumps({'finished': True})}\n\n"
                        break
                        
            except Exception as e:
                logger.error("스트리밍 응답 생성 실패", error=str(e))
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
        
        return StreamingResponse(
            generate_response(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )
        
    except Exception as e:
        logger.error("채팅 완성 실패", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
