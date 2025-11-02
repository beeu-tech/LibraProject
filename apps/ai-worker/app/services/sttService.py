"""
Vosk STT 서비스
오프라인 음성 인식 엔진을 사용한 STT 기능
"""

import os
import json
import wave
import structlog
from typing import Optional, Dict, Any
from pathlib import Path

try:
    import vosk
except ImportError:
    vosk = None

logger = structlog.get_logger(__name__)

class VoskSTTService:
    """Vosk 기반 STT 서비스"""
    
    def __init__(self):
        self.model = None
        self.model_path = os.getenv("VOSK_MODEL_PATH", "/app/models/vosk-model-small-en-us-0.15")
        self.sample_rate = int(os.getenv("VOSK_SAMPLE_RATE", "16000"))
        self._load_model()
    
    def _load_model(self):
        """Vosk 모델 로드"""
        if not vosk:
            logger.error("Vosk not installed. Install with: pip install vosk")
            return
        
        if not os.path.exists(self.model_path):
            logger.error("Vosk model not found", path=self.model_path)
            return
        
        try:
            self.model = vosk.Model(self.model_path)
            logger.info("Vosk model loaded successfully", path=self.model_path)
        except Exception as e:
            logger.error("Failed to load Vosk model", error=str(e), path=self.model_path)
    
    def is_available(self) -> bool:
        """STT 서비스 사용 가능 여부"""
        return self.model is not None and vosk is not None
    
    def transcribe_audio(self, audio_data: bytes) -> Optional[str]:
        """
        오디오 데이터를 텍스트로 변환
        
        Args:
            audio_data: PCM 오디오 데이터 (16kHz, 16bit, mono)
            
        Returns:
            인식된 텍스트 또는 None
        """
        if not self.is_available():
            logger.warning("Vosk STT service not available")
            return None
        
        try:
            # Vosk Recognizer 생성
            rec = vosk.KaldiRecognizer(self.model, self.sample_rate)
            rec.SetWords(True)
            
            # 오디오 데이터 처리
            if rec.AcceptWaveform(audio_data):
                result = json.loads(rec.Result())
                text = result.get('text', '').strip()
                logger.info("STT transcription completed", text=text[:100])
                return text
            else:
                # 부분 결과
                partial = json.loads(rec.PartialResult())
                text = partial.get('partial', '').strip()
                if text:
                    logger.debug("STT partial result", text=text[:50])
                    return text
            
            return None
            
        except Exception as e:
            logger.error("STT transcription failed", error=str(e))
            return None
    
    def transcribe_wav_file(self, wav_path: str) -> Optional[str]:
        """
        WAV 파일을 텍스트로 변환
        
        Args:
            wav_path: WAV 파일 경로
            
        Returns:
            인식된 텍스트 또는 None
        """
        if not os.path.exists(wav_path):
            logger.error("WAV file not found", path=wav_path)
            return None
        
        try:
            with wave.open(wav_path, 'rb') as wf:
                # WAV 파일 정보 확인
                if wf.getnchannels() != 1:
                    logger.warning("WAV file is not mono", channels=wf.getnchannels())
                
                if wf.getsampwidth() != 2:
                    logger.warning("WAV file is not 16-bit", sample_width=wf.getsampwidth())
                
                if wf.getframerate() != self.sample_rate:
                    logger.warning("WAV file sample rate mismatch", 
                                 file_rate=wf.getframerate(), expected=self.sample_rate)
                
                # 오디오 데이터 읽기
                audio_data = wf.readframes(wf.getnframes())
                return self.transcribe_audio(audio_data)
                
        except Exception as e:
            logger.error("Failed to transcribe WAV file", error=str(e), path=wav_path)
            return None
    
    def get_model_info(self) -> Dict[str, Any]:
        """모델 정보 반환"""
        return {
            "available": self.is_available(),
            "model_path": self.model_path,
            "sample_rate": self.sample_rate,
            "vosk_installed": vosk is not None
        }

# 전역 STT 서비스 인스턴스
stt_service = VoskSTTService()
