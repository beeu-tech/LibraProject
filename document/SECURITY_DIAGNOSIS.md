# 🔒 보안 및 시스템 진단 보고서
**진단일시:** 2024-10-13  
**프로젝트:** Discord Libra Bot  
**진단 범위:** 보안 취약점, 시스템 구조, 성능 최적화

---

## 📊 1. DB 스키마 무결성 문제 (FATAL 급)

### 🔴 **현재 문제점**

#### 스키마 불일치로 인한 데이터 무결성 실패

**파일:** `infra/docker/init.sql` vs `apps/ai-worker/app/database.py`

```sql
-- ❌ init.sql (46-52행): 잘못된 스키마
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,  -- ❌ VARCHAR 타입
    session_id INTEGER REFERENCES sessions(id),
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    ...
);

-- ❌ init.sql (55-62행): 잘못된 스키마
CREATE TABLE IF NOT EXISTS memories (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255),  -- ❌ VARCHAR 타입
    ...
);
```

```python
# ✅ database.py (122-133행): 올바른 스키마
await conn.execute(text("""
    CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),  -- ✅ INTEGER + FK
        ...
    )
"""))

# ✅ database.py (136-146행): 올바른 스키마
await conn.execute(text("""
    CREATE TABLE IF NOT EXISTS memories (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),  -- ✅ INTEGER + FK
        ...
    )
"""))
```

### ⚠️ **영향 분석**

1. **외래 키 제약 위반**
   - `users.id` (INTEGER) ↔ `messages.user_id` (VARCHAR)
   - 타입 불일치로 FK 생성 불가

2. **데이터 무결성 실패**
   - 존재하지 않는 사용자 ID 삽입 가능
   - 고아 레코드 생성 가능성

3. **조인 성능 저하**
   - VARCHAR vs INTEGER 비교 시 타입 변환 오버헤드
   - 인덱스 활용 불가

4. **런타임 에러 가능성**
   - `ALLOW_DDL=0` (운영 모드) 시: init.sql 사용 → 잘못된 스키마
   - `ALLOW_DDL=1` (개발 모드) 시: database.py 사용 → 올바른 스키마
   - **환경마다 다른 스키마 사용** → 매우 위험!

### ✅ **해결 방법**

#### Step 1: 마이그레이션 스크립트 생성

```sql
-- infra/migrations/001_fix_user_id_types.sql

BEGIN;

-- 1. messages 테이블 user_id 타입 변경
ALTER TABLE messages 
  ALTER COLUMN user_id TYPE INTEGER USING user_id::integer;

-- 2. messages 테이블 FK 추가
ALTER TABLE messages 
  ADD CONSTRAINT fk_messages_user 
  FOREIGN KEY (user_id) REFERENCES users(id) 
  ON DELETE CASCADE;

-- 3. memories 테이블 user_id 타입 변경
ALTER TABLE memories 
  ALTER COLUMN user_id TYPE INTEGER USING user_id::integer;

-- 4. memories 테이블 FK 추가
ALTER TABLE memories 
  ADD CONSTRAINT fk_memories_user 
  FOREIGN KEY (user_id) REFERENCES users(id) 
  ON DELETE CASCADE;

COMMIT;
```

#### Step 2: init.sql 수정

```sql
-- init.sql에서 올바른 타입으로 변경
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- ✅ 수정
    session_id INTEGER REFERENCES sessions(id),
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER DEFAULT 0,
    latency_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- ✅ 수정
    scope VARCHAR(20) DEFAULT 'user',
    content TEXT,
    metadata TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🔐 2. HMAC 서명 오버로딩 구현 (성능 최적화)

### 📌 **현재 상황**

- **Bot → AI Worker**: `X-Shared-Secret` 헤더만 전송
- **AI Worker**: HMAC 서명 검증 요구 (main.py:98-139)
- **결과**: 모든 요청이 401 Unauthorized 실패

### 💡 **오버로딩 방식 제안**

AI Worker에서 **두 가지 인증 방식을 선택적으로 지원**:

1. **간단 모드 (Simple Mode)**: `X-Shared-Secret` 헤더만 검증 (내부 네트워크용)
2. **HMAC 모드 (HMAC Mode)**: 완전한 HMAC 서명 검증 (외부 접근용)

#### 장점:
- ✅ **속도**: 간단 모드는 HMAC 계산 오버헤드 없음
- ✅ **유연성**: 환경별로 인증 수준 조정 가능
- ✅ **보안**: 필요 시 HMAC 활성화 가능

#### 구현 방법:

```python
# apps/ai-worker/app/main.py (수정)

@app.middleware("http")
async def verify_auth(request: Request, call_next):
    """오버로딩 인증 미들웨어"""
    # 헬스체크 제외
    if request.url.path == "/api/health":  # startswith 제거
        return await call_next(request)
    
    secret = os.getenv("WORKER_SHARED_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="WORKER_SHARED_SECRET not set")
    
    # 인증 모드 선택 (환경변수)
    auth_mode = os.getenv("AUTH_MODE", "simple")  # simple | hmac
    
    if auth_mode == "simple":
        # 간단 모드: X-Shared-Secret 헤더만 확인
        provided_secret = request.headers.get("x-shared-secret")
        if not provided_secret or not hmac.compare_digest(provided_secret, secret):
            raise HTTPException(status_code=401, detail="Invalid shared secret")
        
    elif auth_mode == "hmac":
        # HMAC 모드: 완전한 서명 검증
        ts = request.headers.get("x-ts")
        nonce = request.headers.get("x-nonce")
        sig = request.headers.get("x-signature")
        
        if not all([ts, nonce, sig]):
            raise HTTPException(status_code=401, detail="Missing HMAC headers")
        
        # 타임스탬프 검증
        try:
            t = int(ts)
        except ValueError:
            raise HTTPException(status_code=401, detail="Invalid timestamp")
        
        if abs(int(time.time()) - t) > 300:  # ±5분
            raise HTTPException(status_code=401, detail="Timestamp expired")
        
        # 서명 검증
        body = await request.body()
        payload = f"{request.method}|{request.url.path}|{ts}|{nonce}|{hashlib.sha256(body).hexdigest()}".encode()
        expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
        
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(status_code=401, detail="Invalid HMAC signature")
        
        request._body = body
    
    else:
        raise HTTPException(status_code=500, detail=f"Unknown AUTH_MODE: {auth_mode}")
    
    return await call_next(request)
```

#### 환경변수 설정:

```bash
# 개발/내부 네트워크 (빠른 속도)
AUTH_MODE=simple
WORKER_SHARED_SECRET=your_strong_secret

# 운영/외부 접근 (강한 보안)
AUTH_MODE=hmac
WORKER_SHARED_SECRET=your_strong_secret
```

---

## 🐳 3. Docker 보안 이슈 대응

### 🚨 **최신 CVE 확인**

2024년 최신 Docker 보안 이슈:
- **원격 접근 제어 취약점**: Docker Daemon 소켓 노출 시 컨테이너 탈출 가능
- **권한 상승 취약점**: 잘못된 볼륨 마운트로 호스트 권한 획득
- **이미지 디스크 사용량**: 미사용 레이어 누적으로 디스크 고갈

### ✅ **대응 방안**

#### 1. Docker Daemon 보안 강화

```yaml
# docker-compose.yml에 보안 설정 추가
services:
  bot:
    security_opt:
      - no-new-privileges:true  # 권한 상승 방지
    cap_drop:
      - ALL  # 모든 캐퍼빌리티 제거
    cap_add:
      - NET_BIND_SERVICE  # 필요한 캐퍼빌리티만 추가
    read_only: true  # 파일시스템 읽기 전용
    tmpfs:
      - /tmp  # 임시 파일용 tmpfs
```

#### 2. 네트워크 격리

```yaml
networks:
  frontend:
    driver: bridge
    internal: false  # 외부 통신 가능
  backend:
    driver: bridge
    internal: true   # 내부 통신만 허용

services:
  bot:
    networks:
      - frontend
  
  ai-worker:
    networks:
      - frontend
      - backend
  
  postgres:
    networks:
      - backend  # 외부 접근 차단
    # ports 제거 (외부 포트 노출 금지)
```

#### 3. 이미지 관리 자동화

```bash
# 정기 정리 스크립트
#!/bin/bash
# scripts/docker-cleanup.sh

# 사용하지 않는 이미지 제거
docker image prune -a -f --filter "until=168h"  # 7일 이상 미사용

# 사용하지 않는 컨테이너 제거
docker container prune -f

# 사용하지 않는 볼륨 제거 (주의!)
# docker volume prune -f

# 디스크 사용량 확인
docker system df
```

#### 4. 이미지 최적화

```dockerfile
# 멀티스테이지 빌드로 이미지 크기 감소
FROM python:3.11-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.11-slim
COPY --from=builder /root/.local /root/.local
COPY . /app
WORKDIR /app
ENV PATH=/root/.local/bin:$PATH
CMD ["python", "main.py"]
```

---

## 🎤 4. STT/TTS/ASR 서비스 진단

### ✅ **현재 상태**

#### Vosk STT 서비스 (정상)
- **위치**: `apps/ai-worker/app/services/sttService.py`
- **상태**: 구현 완료, 정상 작동
- **모델**: `vosk-model-small-en-us-0.15` (40MB)
- **API**: `/api/stt/transcribe`, `/api/stt/health`

#### 언어 감지 서비스 (정상)
- **위치**: `apps/ai-worker/app/services/language_detection_service.py`
- **상태**: 구현 완료, 히스테리시스 적용
- **지원 언어**: 한국어, 영어, 일본어, 중국어 등

### ⚠️ **발견된 문제**

#### 1. TTS 서비스 미구현
- **위치**: 코드베이스에 TTS 서비스 없음
- **영향**: 음성 응답 기능 미작동

#### 2. ASR Worker 구조만 존재
- **위치**: `apps/asr-worker/` (디렉토리만 존재)
- **상태**: 구현 미완성

#### 3. SSL/TLS 설정 충돌

```yaml
# docker-compose.yml:85
DATABASE_URL=postgresql://...@postgres:5432/libra_bot?ssl=disable  # ❌

# database.py:59
force_ssl=bool(int(os.getenv("DB_SSL_REQUIRE", "1")))  # ✅ 기본값 1

# 결과: SSL 설정 충돌
```

### ✅ **해결 방안**

#### 1. TTS 서비스 구현 (간단 버전)

```python
# apps/ai-worker/app/services/ttsService.py (신규)
import os
import structlog
from pathlib import Path

logger = structlog.get_logger(__name__)

class TTSService:
    """텍스트-음성 변환 서비스 (로컬 우선)"""
    
    def __init__(self):
        self.engine = os.getenv("TTS_ENGINE", "pyttsx3")  # pyttsx3 | elevenlabs | azure
    
    async def generate_speech(self, text: str, voice: str = "default") -> bytes:
        """텍스트를 음성으로 변환"""
        if self.engine == "pyttsx3":
            return await self._generate_pyttsx3(text)
        else:
            logger.warning(f"TTS 엔진 '{self.engine}'은 미구현")
            return b""
    
    async def _generate_pyttsx3(self, text: str) -> bytes:
        """pyttsx3 로컬 TTS (무료)"""
        import pyttsx3
        import io
        
        engine = pyttsx3.init()
        engine.setProperty('rate', 150)  # 속도
        engine.setProperty('volume', 0.9)  # 볼륨
        
        # 메모리 버퍼에 저장
        audio_buffer = io.BytesIO()
        engine.save_to_file(text, audio_buffer)
        engine.runAndWait()
        
        return audio_buffer.getvalue()
```

#### 2. SSL 설정 통일

```yaml
# docker-compose.yml 수정
environment:
  # SSL 비활성화 (개발 환경)
  - DATABASE_URL=postgresql://libra_user:libra_password@postgres:5432/libra_bot
  - DB_SSL_REQUIRE=0
```

```yaml
# docker-compose.prod.yml (운영 환경)
environment:
  # SSL 활성화 (운영 환경)
  - DATABASE_URL=postgresql://user:pass@postgres:5432/libra_bot
  - DB_SSL_REQUIRE=1
```

---

## 🔑 5. 비밀번호 단방향 암호화

### 🔴 **현재 문제**

```yaml
# docker-compose.yml:10-11
POSTGRES_PASSWORD: libra_password  # ❌ 평문 노출
```

```yaml
# docker-compose.yml:135
GF_SECURITY_ADMIN_PASSWORD=admin  # ❌ 기본 비밀번호
```

### ✅ **해결 방안**

#### 1. Docker Secrets 적용

```yaml
# docker-compose.secrets.yml
version: '3.8'

services:
  postgres:
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    secrets:
      - postgres_password
  
  grafana:
    environment:
      GF_SECURITY_ADMIN_PASSWORD__FILE: /run/secrets/grafana_password
    secrets:
      - grafana_password

secrets:
  postgres_password:
    file: ./secrets/postgres_password.txt
  grafana_password:
    file: ./secrets/grafana_password.txt
```

#### 2. 비밀번호 해싱 (애플리케이션 레벨)

```python
# apps/ai-worker/app/utils/password.py (신규)
import bcrypt

def hash_password(password: str) -> str:
    """비밀번호를 bcrypt로 해싱"""
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    """비밀번호 검증"""
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
```

---

## 📊 6. 로그 서버 분리 아키텍처

### 📌 **현재 문제**

- 로그가 각 컨테이너에 분산 저장
- 포트 노출 시 로그 접근 가능
- 평문 비밀번호가 로그에 노출될 위험

### ✅ **제안 아키텍처**

```
┌──────────────┐
│   Bot        │──┐
└──────────────┘  │
                  │
┌──────────────┐  │    ┌──────────────────┐
│  AI Worker   │──┼───▶│  Loki (로그 수집) │
└──────────────┘  │    └──────────────────┘
                  │           │
┌──────────────┐  │           ▼
│  PostgreSQL  │──┘    ┌──────────────────┐
└──────────────┘       │ Grafana (로그 UI) │
                       └──────────────────┘
```

#### docker-compose.logging.yml

```yaml
version: '3.8'

services:
  loki:
    image: grafana/loki:latest
    container_name: libra-loki
    ports:
      - "3100:3100"  # 내부 네트워크만 허용
    volumes:
      - loki_data:/loki
    networks:
      - backend
  
  promtail:
    image: grafana/promtail:latest
    container_name: libra-promtail
    volumes:
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./infra/monitoring/promtail-config.yml:/etc/promtail/config.yml
    command: -config.file=/etc/promtail/config.yml
    networks:
      - backend
  
  grafana:
    # 기존 Grafana에 Loki 데이터소스 추가
    environment:
      - GF_EXPLORE_ENABLED=true

volumes:
  loki_data:

networks:
  backend:
    internal: true  # 외부 접근 차단
```

#### 로그 레드액션 미들웨어

```python
# apps/ai-worker/app/utils/log_redaction.py (신규)
import re
import structlog

def redact_secrets(event_dict):
    """로그에서 비밀 정보 제거"""
    secret_patterns = [
        r'(password|token|key|secret)["\']?\s*[:=]\s*["\']?([^"\'\s]+)',
        r'postgresql://([^:]+):([^@]+)@',  # DB URL
        r'Bearer\s+([A-Za-z0-9\-._~+/]+=*)',  # Bearer 토큰
    ]
    
    message = str(event_dict.get('event', ''))
    
    for pattern in secret_patterns:
        message = re.sub(pattern, r'\1=***REDACTED***', message)
    
    event_dict['event'] = message
    return event_dict

# structlog 설정에 추가
structlog.configure(
    processors=[
        redact_secrets,  # ⭐ 비밀 정보 제거
        # ... 기타 프로세서
    ]
)
```

---

## ⚡ 7. LLM 속도 최적화 (심각한 문제)

### 🔴 **현재 성능 이슈**

#### 문제점:
1. **Ollama 모델 로드 시간**: 첫 요청 시 3-5초 지연
2. **컨텍스트 크기**: `num_ctx=4096` → 메모리 압박
3. **CPU/GPU 최적화 부족**: 쓰레드 설정 미흡
4. **캐싱 부재**: 동일 요청 재처리

### ✅ **최적화 방안**

#### 1. Ollama 설정 최적화 (이미 적용됨 - v2)

```python
# llm_service_v2.py:119-130 (이미 최적화됨)
"options": {
    "num_ctx": 2048,          # ✅ 4096 → 2048 (메모리/속도 향상)
    "num_predict": 256,       # ✅ 응답 길이 제한
    "temperature": 0.5,       # ✅ 속도와 품질 균형
    "num_gpu": 1,             # ✅ GPU 사용
    "num_thread": 6,          # ✅ CPU 쓰레드 증가
    "num_batch": 512,         # ✅ 배치 크기 최적화
    "stop": [...],            # ✅ 조기 종료 패턴
}
```

#### 2. 모델 사전 로드 (Warm-up)

```python
# apps/ai-worker/app/main.py에 추가

@app.on_event("startup")
async def warmup_models():
    """모델 사전 로드로 첫 요청 지연 제거"""
    logger.info("LLM 모델 워밍업 시작...")
    
    # 더미 요청으로 모델 로드
    dummy_messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello"}
    ]
    
    try:
        async for _ in llm_service.stream_response(dummy_messages, "warmup"):
            break  # 첫 청크만 받고 종료
        logger.info("LLM 모델 워밍업 완료")
    except Exception as e:
        logger.warning("LLM 모델 워밍업 실패 (계속 진행)", error=str(e))
```

#### 3. Redis 캐싱 추가

```python
# apps/ai-worker/app/services/cache_service.py (신규)
import hashlib
import json
from redis import asyncio as aioredis
import structlog

logger = structlog.get_logger(__name__)

class LLMCacheService:
    """LLM 응답 캐싱 서비스"""
    
    def __init__(self):
        self.redis = None
        self.ttl = 300  # 5분 TTL
    
    async def initialize(self):
        self.redis = await aioredis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379"),
            decode_responses=True
        )
    
    def _generate_cache_key(self, messages: list, model: str) -> str:
        """메시지와 모델로 캐시 키 생성"""
        content = json.dumps(messages, sort_keys=True) + model
        return f"llm:cache:{hashlib.sha256(content.encode()).hexdigest()}"
    
    async def get_cached_response(self, messages: list, model: str) -> str | None:
        """캐시에서 응답 조회"""
        if not self.redis:
            return None
        
        key = self._generate_cache_key(messages, model)
        cached = await self.redis.get(key)
        
        if cached:
            logger.info("LLM 캐시 히트", key=key[:20])
        
        return cached
    
    async def cache_response(self, messages: list, model: str, response: str):
        """응답을 캐시에 저장"""
        if not self.redis or not response:
            return
        
        key = self._generate_cache_key(messages, model)
        await self.redis.setex(key, self.ttl, response)
        logger.info("LLM 응답 캐시됨", key=key[:20])
```

#### 4. 스트리밍 버퍼 최적화

```python
# llm_service_v2.py에 추가
async def _stream_ollama_response(self, messages, model):
    """최적화된 스트리밍"""
    buffer = ""  # 청크 버퍼
    buffer_size = 5  # 5개 청크마다 전송
    
    async for line in response.aiter_lines():
        # ... 기존 로직
        
        # 버퍼링으로 전송 횟수 감소
        buffer += data["message"]["content"]
        if len(buffer) >= buffer_size:
            yield {"content": buffer, "finished": False}
            buffer = ""
    
    # 남은 버퍼 전송
    if buffer:
        yield {"content": buffer, "finished": False}
    
    yield {"finished": True}
```

---

## 🌐 8. 언어 감지 및 처리 로직 개선

### ✅ **현재 상태 (양호)**

- **언어 감지**: `langdetect` 라이브러리 사용
- **히스테리시스**: 2회 연속 같은 언어일 때만 전환 (깜빡임 방지)
- **모델 선택**: 언어별 최적 모델 자동 선택
  - 동아시아어 (한/중/일): `qwen2.5:7b-instruct` 
  - 기타 언어: `llama3:8b-instruct-q4_K_M`

### ⚠️ **개선 가능 영역**

#### 1. 언어 감지 신뢰도 향상

```python
# language_detection_service.py 수정
def detect_language(self, text: str) -> tuple[str, float]:
    """언어 감지 + 신뢰도 반환"""
    from langdetect import detect_langs
    
    if not text or text.strip() == "":
        return self.default_lang, 1.0
    
    try:
        text_sample = text[:4000]
        # 신뢰도와 함께 감지
        detections = detect_langs(text_sample)
        
        if detections:
            lang = detections[0].lang
            confidence = detections[0].prob
            
            # 중국어 보정
            if lang.startswith("zh"):
                lang = "zh-cn"
            
            # 신뢰도가 낮으면 기본 언어 사용
            if confidence < 0.5:
                logger.warning("Low language detection confidence", 
                             lang=lang, confidence=confidence)
                return self.default_lang, 0.0
            
            return lang, confidence
        
    except Exception as e:
        logger.warning("언어 감지 실패", error=str(e))
    
    return self.default_lang, 0.0
```

#### 2. 언어별 시스템 프롬프트 최적화

```python
# language_detection_service.py:100-114
def build_system_prompt(self, lang_code: str) -> str:
    """언어별 최적화된 프롬프트"""
    
    # 언어별 특화 지시사항
    lang_specific_instructions = {
        "ko": """
- 한국어 높임말/반말 상황에 맞게 사용
- 외래어는 한글 표기법 준수
- 이모지는 자연스럽게 1-2개 사용
        """,
        "en": """
- Use clear, concise English
- Avoid overly formal language
- Use 1-2 emojis naturally
        """,
        "ja": """
- 丁寧語を基本とする
- 専門用語は必要に応じてカタカナ表記
        """,
        "zh-cn": """
- 使用简体中文
- 保持语言自然流畅
- 专业术语准确翻译
        """
    }
    
    specific = lang_specific_instructions.get(lang_code, "")
    lang_name = self.get_language_name(lang_code)
    
    return f"""역할: 디스코드 대화형 어시스턴트

응답 언어: {lang_name}

기본 지시사항:
1) 반드시 {lang_name}로 답변
2) 자연스러운 대화체 사용
3) 모르는 내용은 '불확실'하다고 명시
4) Discord 채팅에 최적화된 간결함

{specific}

현재 언어: {lang_name}"""
```

#### 3. 언어 전환 알림

```python
# llm_service_v2.py:70-98 수정
async def stream_response(self, messages, channel_id="default"):
    """언어 전환 알림 포함"""
    # ... 기존 코드
    
    # 언어 전환 감지
    prev_state = self.language_service.get_channel_language_state(channel_id)
    detected_lang, confidence = self.language_service.detect_language(user_text)
    final_lang = self.language_service.decide_language(channel_id, detected_lang)
    
    # 언어가 변경되었으면 알림
    if prev_state.get("lang") != final_lang:
        lang_name = self.language_service.get_language_name(final_lang)
        yield {
            "content": f"🌐 응답 언어가 {lang_name}로 변경되었습니다.\n\n",
            "finished": False
        }
    
    # ... 나머지 스트리밍 로직
```

---

## 📊 우선순위 요약

| 순위 | 항목 | 위험도 | 작업량 | 즉시 수정 |
|------|------|--------|--------|----------|
| 1 | DB 스키마 무결성 | 🔴 FATAL | 🟢 1시간 | ✅ |
| 2 | HMAC 오버로딩 구현 | 🟠 HIGH | 🟢 2시간 | ✅ |
| 3 | LLM 속도 최적화 | 🟠 HIGH | 🟡 4시간 | ✅ |
| 4 | 비밀번호 암호화 | 🟠 HIGH | 🟢 1시간 | ✅ |
| 5 | Docker 보안 강화 | 🟡 MEDIUM | 🟡 3시간 | ⏰ |
| 6 | STT/TTS 구현 | 🟡 MEDIUM | 🟠 8시간 | ⏰ |
| 7 | 로그 서버 분리 | 🟡 MEDIUM | 🟡 4시간 | ⏰ |
| 8 | 언어 감지 개선 | 🟢 LOW | 🟢 2시간 | ⏰ |

---

## 🎯 실행 계획

### Phase 1: 긴급 (오늘 완료)
1. ✅ DB 스키마 수정 및 마이그레이션
2. ✅ HMAC 오버로딩 구현
3. ✅ LLM 속도 최적화
4. ✅ 비밀번호 Docker Secrets 적용

### Phase 2: 중요 (2-3일 내)
5. Docker 보안 강화
6. 로그 서버 분리

### Phase 3: 개선 (1주일 내)
7. TTS 서비스 구현
8. 언어 감지 고도화

---

**보고서 작성:** AI Assistant  
**검토 필요:** 시스템 관리자

