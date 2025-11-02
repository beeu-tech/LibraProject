"""
STT (Speech-to-Text) API 엔드포인트
Vosk 기반 음성 인식 서비스
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from fastapi.responses import JSONResponse
import structlog
import tempfile
import os
from typing import Dict, Any

from ..services.sttService import stt_service

logger = structlog.get_logger(__name__)
router = APIRouter()

@router.get("/stt/health")
async def stt_health():
    """STT 서비스 헬스체크"""
    try:
        model_info = stt_service.get_model_info()
        return JSONResponse(content={
            "status": "ok",
            "service": "stt",
            "model_info": model_info
        })
    except Exception as e:
        logger.error("STT health check failed", error=str(e))
        raise HTTPException(status_code=500, detail="STT service unavailable")

@router.post("/stt/transcribe")
async def transcribe_audio(
    audio_file: UploadFile = File(...)
):
    """
    오디오 파일을 텍스트로 변환
    
    Args:
        audio_file: 업로드된 오디오 파일 (WAV 형식 권장)
        
    Returns:
        인식된 텍스트
    """
    logger.info("STT 요청 수신", 
               filename=audio_file.filename,
               content_type=audio_file.content_type)
    
    if not stt_service.is_available():
        logger.error("STT 서비스 사용 불가")
        raise HTTPException(
            status_code=503, 
            detail="STT service not available. Check model installation."
        )
    
    # 파일 형식 검증 (완화)
    if not audio_file.filename:
        logger.warning("파일명 없음 - 기본값 사용")
        # 파일명 없어도 진행
        file_ext = '.wav'
    else:
        file_ext = os.path.splitext(audio_file.filename.lower())[1]
        if not file_ext:
            file_ext = '.wav'  # 기본값
    
    # 확장자 검증 완화 (모든 오디오 형식 허용)
    logger.info("오디오 파일 확장자", ext=file_ext)
    
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
        text = stt_service.transcribe_wav_file(temp_file_path)
        
        if text is None:
            raise HTTPException(
                status_code=500, 
                detail="Failed to transcribe audio"
            )
        
        logger.info("STT transcription successful", 
                   text_length=len(text),
                   text_preview=text[:100])
        
        return JSONResponse(content={
            "status": "success",
            "text": text,
            "confidence": 1.0,  # Vosk는 신뢰도 점수를 제공하지 않음
            "language": "en",   # 기본값, 나중에 다국어 지원 시 확장
            "duration": len(content) / 16000  # 대략적인 오디오 길이 (16kHz 기준)
        })
        
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

@router.post("/stt/transcribe-raw")
async def transcribe_raw_audio(
    audio_data: bytes
):
    """
    원시 오디오 데이터를 텍스트로 변환
    
    Args:
        audio_data: PCM 오디오 데이터 (16kHz, 16bit, mono)
        
    Returns:
        인식된 텍스트
    """
    if not stt_service.is_available():
        raise HTTPException(
            status_code=503, 
            detail="STT service not available"
        )
    
    try:
        text = stt_service.transcribe_audio(audio_data)
        
        if text is None:
            raise HTTPException(
                status_code=500, 
                detail="Failed to transcribe audio data"
            )
        
        return JSONResponse(content={
            "status": "success",
            "text": text,
            "confidence": 1.0,
            "language": "en"
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Raw STT transcription failed", error=str(e))
        raise HTTPException(status_code=500, detail="Internal STT error")

@router.get("/stt/models")
async def list_models():
    """사용 가능한 STT 모델 목록"""
    try:
        model_info = stt_service.get_model_info()
        return JSONResponse(content={
            "status": "ok",
            "models": [model_info],
            "current_model": model_info["model_path"]
        })
    except Exception as e:
        logger.error("Failed to list STT models", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to list models")
