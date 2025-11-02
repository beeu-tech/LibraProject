import os
from typing import Dict
from langdetect import detect, DetectorFactory
import structlog
from .base_service import BaseService

# 언어 감지 안정화
DetectorFactory.seed = 0

logger = structlog.get_logger()

class LanguageDetectionService(BaseService):
    def __init__(self):
        super().__init__()
        self.default_lang = os.getenv("DEFAULT_LANG", "ko")
        
        # 언어 코드 매핑
        self.lang_mapping = {
            "ko": "한국어",
            "en": "영어", 
            "ja": "일본어",
            "zh-cn": "중국어(간체)",
            "zh-tw": "중국어(번체)",
            "fr": "프랑스어",
            "de": "독일어",
            "es": "스페인어",
        }
        
        # 채널별 언어 상태 (히스테리시스)
        self.lang_states: Dict[str, Dict] = {}

    async def initialize(self):
        """서비스 초기화"""
        self.set_initialized(True)
        logger.info("언어 감지 서비스 초기화 완료")

    async def cleanup(self):
        """서비스 정리"""
        logger.info("언어 감지 서비스 정리 완료")

    def detect_language(self, text: str) -> str:
        """텍스트에서 언어 감지"""
        if not text or text.strip() == "":
            return self.default_lang
            
        try:
            # 텍스트 길이 제한 (언어 감지 정확도 향상)
            text_sample = text[:4000]
            code = detect(text_sample)
            
            # 중국어 보정
            if code.startswith("zh"):
                return "zh-cn"
                
            return code
            
        except Exception as e:
            logger.warning("언어 감지 실패", error=str(e), text=text[:100])
            return self.default_lang

    def decide_language(self, channel_id: str, latest_code: str) -> str:
        """히스테리시스를 적용한 언어 결정"""
        state = self.lang_states.setdefault(channel_id, {
            "lang": self.default_lang, 
            "streak": 0
        })
        
        # 같은 언어가 계속 들어오면 streak 리셋
        if latest_code == state["lang"]:
            state["streak"] = 0
            return state["lang"]
        
        # 다른 언어가 들어오면 2회 연속일 때 전환 (깜빡임 방지)
        state["streak"] += 1
        if state["streak"] >= 2:
            old_lang = state["lang"]
            state["lang"] = latest_code
            state["streak"] = 0
            logger.info("언어 전환", 
                       channel_id=channel_id, 
                       old_lang=old_lang, 
                       new_lang=latest_code)
        
        return state["lang"]

    def get_language_name(self, code: str) -> str:
        """언어 코드를 한국어 이름으로 변환"""
        return self.lang_mapping.get(code, f"언어({code})")

    def pick_model(self, lang_code: str) -> str:
        """언어에 따른 모델 선택"""
        primary_model = os.getenv("PRIMARY_MODEL", "llama3:8b-instruct-q4_K_M")
        alt_model = os.getenv("ALT_MODEL", "qwen2.5:7b-instruct")
        
        # 동아시아어는 Qwen 2.5, 그 외는 LLaMA 3
        if lang_code in ("ko", "ja", "zh-cn", "zh-tw"):
            return alt_model
        return primary_model

    def build_system_prompt(self, lang_code: str) -> str:
        """언어별 시스템 프롬프트 생성"""
        lang_name = self.get_language_name(lang_code)
        
        return f"""역할: 디스코드 대화형 어시스턴트.

지시사항:
1) 반드시 {lang_name}로 답한다. 사용자 언어를 따르며, 혼합 입력이어도 최종 답변 언어는 {lang_name}로 통일한다.
2) 직역을 피하고 자연스러운 {lang_name} 표현을 사용한다. 의미 보존 + 어색한 어순/직역체 금지.
3) 모르는 내용은 추정하지 말고 '불확실'이라고 명확히 표기한다.
4) 코드/명령어/에러 메시지는 원문을 보존하되 설명은 {lang_name}로 제공한다.
5) 불필요한 외국어 표기 금지(고유명사는 괄호 병기).
6) Discord 채팅에 적합한 간결하고 친근한 톤을 유지한다.

현재 설정된 응답 언어: {lang_name}"""

    def get_channel_language_state(self, channel_id: str) -> Dict:
        """채널의 언어 상태 조회"""
        return self.lang_states.get(channel_id, {
            "lang": self.default_lang,
            "streak": 0
        })
