"""
faster-whisper ASR 엔진
Silero VAD + 실시간 스트리밍 지원
"""

import io
import time
import json
import asyncio
from typing import Dict, Optional, AsyncIterator
import structlog
import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel
import torch

logger = structlog.get_logger()


class ASREngine:
    """faster-whisper 기반 ASR 엔진"""
    
    def __init__(self, config: Dict):
        self.config = config
        self.model: Optional[WhisperModel] = None
        self.vad_model = None
        self._ready = False
        
    async def initialize(self):
        """ASR 엔진 초기화"""
        try:
            logger.info("faster-whisper 모델 로딩 중...")
            
            # faster-whisper 모델 로드
            self.model = WhisperModel(
                model_size_or_path=self.config["model_name"],
                device=self.config["device"],
                compute_type=self.config["compute_type"],
                download_root="/app/models",
            )
            
            logger.info("faster-whisper 모델 로드 완료")
            
            # VAD 모델 로드 (선택적)
            if self.config.get("vad") == "silero":
                await self._initialize_vad()
            
            # GPU 예열
            await self._warmup()
            
            self._ready = True
            logger.info("ASR 엔진 초기화 완료")
            
        except Exception as e:
            logger.error("ASR 엔진 초기화 실패", error=str(e))
            raise
    
    async def _initialize_vad(self):
        """Silero VAD 초기화"""
        try:
            logger.info("Silero VAD 로딩 중...")
            
            # Silero VAD 로드
            self.vad_model, _ = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                onnx=False
            )
            
            if self.config["device"] == "cuda":
                self.vad_model = self.vad_model.cuda()
            
            logger.info("Silero VAD 로드 완료")
            
        except Exception as e:
            logger.warning("Silero VAD 로드 실패, VAD 없이 진행", error=str(e))
            self.vad_model = None
    
    async def _warmup(self):
        """GPU 예열 (콜드스타트 방지)"""
        try:
            logger.info("GPU 예열 중...")
            
            # 1초 무음 오디오로 테스트
            sample_rate = 16000
            silence = np.zeros(sample_rate, dtype=np.float32)
            
            # 더미 추론
            segments, info = self.model.transcribe(
                silence,
                language=self.config.get("lang_hint", "ko"),
                beam_size=1,
                vad_filter=False,
            )
            
            # 결과 소비 (iterator)
            list(segments)
            
            logger.info("GPU 예열 완료")
            
        except Exception as e:
            logger.warning("GPU 예열 실패", error=str(e))
    
    async def transcribe_sync(
        self,
        audio_data: bytes,
        language: Optional[str] = None,
        beam_size: Optional[int] = None
    ) -> Dict:
        """동기 음성 변환"""
        if not self._ready:
            raise RuntimeError("ASR 엔진이 초기화되지 않았습니다")
        
        start_time = time.time()
        
        try:
            # 오디오 로드
            audio, sample_rate = self._load_audio(audio_data)
            
            # 변환 파라미터
            lang = language or self.config.get("lang_hint", "ko")
            beam = beam_size or self.config.get("beam_size", 2)
            
            logger.info("변환 시작", language=lang, beam_size=beam, duration=len(audio)/sample_rate)
            
            # faster-whisper 추론
            segments, info = self.model.transcribe(
                audio,
                language=lang if lang != "auto" else None,
                beam_size=beam,
                temperature=self.config.get("temperature", 0.0),
                vad_filter=self.vad_model is not None,
                condition_on_previous_text=self.config.get("condition_on_prev", True),
                no_speech_threshold=self.config.get("no_speech_threshold", 0.6),
            )
            
            # 세그먼트 수집
            result_segments = []
            full_text = ""
            
            for segment in segments:
                result_segments.append({
                    "start": segment.start,
                    "end": segment.end,
                    "text": segment.text.strip(),
                    "confidence": getattr(segment, 'avg_logprob', 0.0)
                })
                full_text += segment.text.strip() + " "
            
            duration = time.time() - start_time
            
            result = {
                "text": full_text.strip(),
                "language": info.language,
                "duration": duration,
                "segments": result_segments,
            }
            
            logger.info("변환 완료", 
                       text_length=len(result["text"]), 
                       segments=len(result_segments),
                       duration=duration)
            
            return result
            
        except Exception as e:
            logger.error("변환 실패", error=str(e))
            raise
    
    async def transcribe_stream(
        self,
        audio_data: bytes,
        language: Optional[str] = None
    ) -> AsyncIterator[str]:
        """실시간 스트리밍 변환"""
        if not self._ready:
            raise RuntimeError("ASR 엔진이 초기화되지 않았습니다")
        
        try:
            # 오디오 로드
            audio, sample_rate = self._load_audio(audio_data)
            
            lang = language or self.config.get("lang_hint", "ko")
            
            logger.info("스트리밍 변환 시작", language=lang)
            
            # faster-whisper 추론 (스트리밍)
            segments, info = self.model.transcribe(
                audio,
                language=lang if lang != "auto" else None,
                beam_size=self.config.get("beam_size", 2),
                vad_filter=self.vad_model is not None,
                condition_on_previous_text=self.config.get("condition_on_prev", True),
            )
            
            # 세그먼트별로 스트리밍
            for segment in segments:
                chunk = {
                    "type": "partial",
                    "text": segment.text.strip(),
                    "start": segment.start,
                    "end": segment.end,
                }
                
                yield json.dumps(chunk, ensure_ascii=False)
                
                # 작은 지연 (스트리밍 효과)
                await asyncio.sleep(0.01)
            
            # 최종 완료
            final = {
                "type": "final",
                "language": info.language,
            }
            
            yield json.dumps(final, ensure_ascii=False)
            
            logger.info("스트리밍 변환 완료")
            
        except Exception as e:
            logger.error("스트리밍 변환 실패", error=str(e))
            error_chunk = {
                "type": "error",
                "message": str(e)
            }
            yield json.dumps(error_chunk)
    
    def _load_audio(self, audio_data: bytes) -> tuple:
        """오디오 데이터 로드 및 전처리"""
        try:
            # soundfile로 로드
            audio, sample_rate = sf.read(io.BytesIO(audio_data))
            
            # 모노로 변환
            if len(audio.shape) > 1:
                audio = audio.mean(axis=1)
            
            # 16kHz로 리샘플링 (필요시)
            if sample_rate != 16000:
                import librosa
                audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000)
                sample_rate = 16000
            
            # float32로 변환
            audio = audio.astype(np.float32)
            
            return audio, sample_rate
            
        except Exception as e:
            logger.error("오디오 로드 실패", error=str(e))
            raise
    
    def is_ready(self) -> bool:
        """엔진 준비 상태"""
        return self._ready and self.model is not None
    
    async def cleanup(self):
        """리소스 정리"""
        logger.info("ASR 엔진 정리 중...")
        
        self.model = None
        self.vad_model = None
        self._ready = False
        
        # CUDA 메모리 정리
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        logger.info("ASR 엔진 정리 완료")

