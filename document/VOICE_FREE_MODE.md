# 🆓 음성 봇 무료 + 초저부하 모드 가이드

## 📌 개요

기존 `docker-compose.voice.yml`은 로컬에서 **Ollama(LLM)**과 **faster-whisper(ASR)**를 동시에 실행하여 GPU/메모리 부하가 높습니다.

**무료 모드**는 로컬 추론 없이 **외부 무료 API**만 사용하여:
- ✅ **로컬 부하 0%** (마이크 캡처/웹소켓만 처리)
- ✅ **완전 무료** (무료 티어 API 조합)
- ✅ **GPU 불필요** (모든 추론이 클라우드)

---

## 🎯 무료 모드 구성

| 컴포넌트 | 기존 (로컬) | 무료 모드 (클라우드) |
|---------|------------|---------------------|
| **LLM** | Ollama (로컬 GPU) | Groq / OpenRouter / DeepInfra |
| **ASR** | faster-whisper (로컬 GPU/CPU) | Groq Whisper / OpenAI Whisper |
| **TTS** | ElevenLabs (유료) | Cloudflare Workers AI / Piper |

---

## 🚀 빠른 시작

### 1. 환경변수 설정

```bash
# env.free.example을 .env로 복사 (또는 .env에 병합)
cp env.free.example .env

# .env 파일 편집:
# - Groq API 키 발급: https://console.groq.com/keys
# - Cloudflare API 토큰 발급: https://dash.cloudflare.com/profile/api-tokens
```

**필수 환경변수 (.env 예시):**

```env
# LLM - Groq (무료, 빠름!)
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.1-8b-instant
OPENAI_API_KEY=gsk_your_groq_api_key_here

# ASR - Groq Whisper (무료, 빠름!)
ASR_PROVIDER=external
ASR_EXTERNAL_URL=https://api.groq.com/openai/v1/audio/transcriptions
ASR_MODEL=whisper-large-v3

# TTS - Cloudflare Workers AI (무료, 10만 neurons/일)
TTS_PROVIDER=cloudflare
CF_API_TOKEN=your_cloudflare_api_token_here
CF_ACCOUNT_ID=your_cloudflare_account_id_here

# 기타 (기존 설정 유지)
DISCORD_TOKEN=your_discord_bot_token_here
MONGODB_URI=mongodb://libra:libra_password@mongodb:27017/libra_db?authSource=admin
```

### 2. Docker Compose 실행

```bash
# 무료 모드 실행 (voice.yml 기반 + free.yml 오버라이드)
docker compose -f docker-compose.voice.yml -f docker-compose.free.yml up -d

# 로그 확인
docker compose -f docker-compose.voice.yml -f docker-compose.free.yml logs -f gateway

# 확인 포인트:
# ✅ "VoicePipeline 초기화: asrProvider: external, llmProvider: openai, ttsProvider: cloudflare"
# ✅ "외부 Whisper API 요청"
# ✅ "OpenAI 호환 API 요청"
# ✅ "Cloudflare TTS 요청"
```

### 3. 디스코드에서 테스트

1. 음성 채널 입장
2. `/voice-chat` 명령어 입력
3. 음성으로 말하기 → 봇이 텍스트로 응답

---

## 🔑 무료 API 키 발급 방법

### Groq (LLM + ASR, 추천!)

1. [Groq 콘솔](https://console.groq.com/) 접속
2. "API Keys" → "Create API Key" 클릭
3. 키 복사 후 `.env`의 `OPENAI_API_KEY`에 입력

**무료 한도:**
- LLM: 초당 30 요청, 분당 14,400 토큰
- Whisper: 초당 20 요청
- 🎉 **개인 프로젝트는 충분!**

### Cloudflare Workers AI (TTS)

1. [Cloudflare 대시보드](https://dash.cloudflare.com/) 로그인
2. "AI" → "Workers AI" 활성화
3. [API 토큰 생성](https://dash.cloudflare.com/profile/api-tokens)
   - "Create Token" → "Workers AI" 템플릿 선택
   - Permissions: `Account > Workers AI > Edit`
4. 계정 ID는 대시보드 오른쪽에서 확인 (Account ID)

**무료 한도:**
- 하루 **10만 neurons** (약 5-10만 글자)
- 🎉 **개인 프로젝트는 넉넉!**

---

## 🛠 프로바이더 대안

### LLM 대안

#### OpenRouter (다양한 무료 모델)

```env
LLM_PROVIDER=openai
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=meta-llama/llama-3.2-3b-instruct:free
# 또는: google/gemma-2-9b-it:free, mistralai/mistral-7b-instruct:free
OPENAI_API_KEY=sk-or-v1-your_openrouter_key_here
```

발급: [OpenRouter Keys](https://openrouter.ai/keys)

#### DeepInfra (Llama/Qwen 무료)

```env
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.deepinfra.com/v1/openai
LLM_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct
OPENAI_API_KEY=your_deepinfra_api_key_here
```

발급: [DeepInfra API Keys](https://deepinfra.com/dash/api_keys)

---

### ASR 대안

#### OpenAI Whisper (무료 티어 제한)

```env
ASR_PROVIDER=external
ASR_EXTERNAL_URL=https://api.openai.com/v1/audio/transcriptions
ASR_MODEL=whisper-1
OPENAI_API_KEY=sk-your_openai_key_here
```

⚠️ **제한:** 분당 3회 (RPM) → 데모용으로만 권장

---

### TTS 대안

#### ElevenLabs (유료, 음질 최고)

```env
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM  # Rachel
```

**무료 한도:** 월 1만 글자 (약 10분 음성)

#### Piper (로컬, 완전 무료)

`docker-compose.free.yml`에서 주석 해제:

```yaml
  piper-tts:
    image: rhasspy/piper:latest
    container_name: piper-tts
    restart: unless-stopped
    volumes:
      - ./models/piper:/models:ro
    command: >
      --port 5002
      --model /models/ko_KR-kss-medium.onnx
    ports:
      - "5002:5002"
```

`.env` 설정:

```env
TTS_PROVIDER=piper
PIPER_TTS_URL=http://piper-tts:5002/api/tts
```

✅ **장점:** 완전 무료, 무제한, 오프라인 가능  
⚠️ **단점:** CPU 사용 (GPU 불필요), 음질은 Cloudflare/ElevenLabs보다 낮음

---

## 📊 비용/성능 비교

| 프로바이더 | LLM 무료 한도 | ASR 무료 한도 | TTS 무료 한도 | 속도 | 음질 |
|-----------|--------------|--------------|--------------|------|------|
| **Groq** | 초당 30 요청 | 초당 20 요청 | - | ⚡ 매우 빠름 | - |
| **OpenRouter** | 모델별 상이 | - | - | 🐢 보통 | - |
| **DeepInfra** | 일 100 요청 | - | - | 🐢 보통 | - |
| **OpenAI** | $5 크레딧 (신규) | 분당 3회 | - | ⚡ 빠름 | - |
| **Cloudflare** | - | - | 일 10만 neurons | 🚀 빠름 | 😊 준수 |
| **ElevenLabs** | - | - | 월 1만 글자 | 🚀 빠름 | 😍 최고 |
| **Piper** | - | - | 무제한 | 🐢 보통 | 😐 보통 |

**추천 조합 (개인 프로젝트):**
- LLM: **Groq** (`llama-3.1-8b-instant`)
- ASR: **Groq Whisper** (`whisper-large-v3`)
- TTS: **Cloudflare** (`melotts`) + **Piper** (백업)

---

## 🔍 동작 원리

### 음성 대화 플로우 (무료 모드)

```
[디스코드 음성] 
   ↓ (Opus 인코딩)
[Gateway 웹소켓] ← 로컬 처리 (경량)
   ↓
[외부 Groq Whisper] ← 클라우드 ASR (무료)
   ↓ (텍스트)
[외부 Groq LLM] ← 클라우드 LLM (무료)
   ↓ (응답 텍스트)
[외부 Cloudflare TTS] ← 클라우드 TTS (무료)
   ↓ (오디오)
[Gateway] → [디스코드 음성] ← 로컬 스트리밍 (경량)
```

**로컬 부하:**
- ✅ 마이크 캡처 (Discord.js Voice)
- ✅ Opus 인코딩/디코딩
- ✅ 웹소켓 통신
- ❌ GPU 추론 (0%)
- ❌ 대용량 메모리 (0%)

---

## ⚙️ 성능 최적화 팁

### 1. LLM 지연 최소화

```env
LLM_NUM_PREDICT=40-60  # 짧은 응답 (2-3문장)
LLM_TEMPERATURE=0.6    # 적당한 다양성
```

빠른 모델 선택:
- Groq: `llama-3.1-8b-instant` (추천!)
- OpenRouter: `google/gemma-2-9b-it:free`

### 2. ASR 정확도

- 한국어: `language=ko` (필수)
- 모델: `whisper-large-v3` (정확도 최고)

### 3. TTS 폴백 전략

`voicePipeline.ts`는 자동으로 폴백:
1. **Cloudflare** (무료, 한도 넉넉)
2. **ElevenLabs** (유료, 음질 최고)
3. **Piper** (로컬, 무제한)

한도 초과 시 자동 전환!

### 4. 캐싱 (선택)

동일 응답 반복 시 TTS 호출 줄이기:
- Gateway에 Redis 캐시 추가 (향후 개선)
- 응답 텍스트 → MP3 매핑

---

## 🐛 트러블슈팅

### Q1. "외부 Whisper API 실패" 에러

**원인:** API 키 없음 또는 잘못됨

**해결:**
```bash
# .env 확인
echo $OPENAI_API_KEY

# Groq 키는 "gsk_"로 시작
# OpenAI 키는 "sk-"로 시작
```

### Q2. "Cloudflare TTS 실패" 에러

**원인:** API 토큰 또는 계정 ID 잘못됨

**해결:**
```bash
# Workers AI 활성화 확인
# https://dash.cloudflare.com → AI → Workers AI

# API 토큰 권한 확인
# Account > Workers AI > Edit 필요
```

### Q3. TTS가 작동 안 함

**원인:** 모든 TTS 프로바이더 실패

**해결:**
1. Piper 로컬 백업 활성화:
   ```bash
   # docker-compose.free.yml에서 piper-tts 주석 해제
   docker compose -f docker-compose.yml -f docker-compose.free.yml up -d
   ```

2. `.env`에 추가:
   ```env
   PIPER_TTS_URL=http://piper-tts:5002/api/tts
   ```

### Q4. 무료 한도 초과

**증상:** 429 Too Many Requests

**해결:**
- Groq: 초당 요청 수 줄이기 (대화 간격 조절)
- Cloudflare: 다음 날까지 대기 (자정 UTC 리셋)
- 대안: Piper TTS 활성화 (무제한)

### Q5. 로컬 모드로 돌아가고 싶음

```bash
# free.yml 없이 voice.yml만 실행
docker compose -f docker-compose.voice.yml up -d

# 또는 기존 무료 모드 중지 후 재시작
docker compose -f docker-compose.voice.yml -f docker-compose.free.yml down
docker compose -f docker-compose.voice.yml up -d
```

---

## 🎓 고급: 하이브리드 모드

로컬 + 클라우드 조합 (최적 성능/비용)

### 시나리오 1: 로컬 LLM + 클라우드 ASR/TTS

```env
# LLM만 로컬 (프라이버시)
LLM_PROVIDER=ollama
LLM_URL=http://llm:11434

# ASR/TTS는 클라우드 (성능)
ASR_PROVIDER=external
ASR_EXTERNAL_URL=https://api.groq.com/openai/v1/audio/transcriptions
TTS_PROVIDER=cloudflare
```

**장점:** 대화 내용 비공개 + GPU 부하 낮음

### 시나리오 2: 클라우드 LLM + 로컬 ASR/TTS

```env
# LLM만 클라우드 (성능)
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.groq.com/openai/v1

# ASR/TTS는 로컬 (오프라인)
ASR_PROVIDER=local
ASR_URL=http://asr:5005
TTS_PROVIDER=piper
```

**장점:** 음성 데이터 비공개 + 빠른 LLM

---

## 📚 관련 문서

- [VOICE_QUICKSTART.md](./VOICE_QUICKSTART.md) - 기본 음성 봇 설정
- [VOICE_ARCHITECTURE.md](./VOICE_ARCHITECTURE.md) - 아키텍처 설명
- [docker-compose.free.yml](./docker-compose.free.yml) - 무료 모드 설정
- [env.free.example](./env.free.example) - 환경변수 샘플

---

## 💡 핵심 요약

1. **로컬 추론 0부하**: Ollama, faster-whisper 비활성화
2. **무료 API 조합**: Groq (LLM + ASR) + Cloudflare (TTS)
3. **백업 전략**: Piper 로컬 TTS (한도 초과 시)
4. **실행 방법**: `docker compose -f docker-compose.yml -f docker-compose.free.yml up -d`

**완전 무료 개인 프로젝트 = 가능! 🎉**

