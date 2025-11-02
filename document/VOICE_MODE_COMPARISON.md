# 🎤 음성 봇 실행 모드 비교 가이드

## 📌 왜 2가지 모드가 필요한가?

현재 `docker-compose.voice.yml`은 **로컬에서 모든 추론을 실행**하도록 설계되어 있습니다:
- **Ollama** (LLM): GPU 필요, 메모리 4-8GB
- **faster-whisper** (ASR): GPU/CPU, 메모리 2-4GB
- **Silero VAD**: 지속 실행, GPU 점유

### 문제 상황

```
[사용자 PC]
  ├─ GPU 0%: Ollama (대기 중)      ← 4-8GB VRAM 점유
  ├─ GPU 20%: faster-whisper       ← 2-4GB VRAM 점유
  ├─ GPU 5%: Silero VAD (warmup)   ← 500MB VRAM 점유
  └─ 총: 6-12GB VRAM 상시 점유 🔥
```

**결과:**
- ❌ GPU 없으면 아예 실행 불가
- ❌ GPU 있어도 다른 작업(게임, 영상편집) 방해
- ❌ 전기세 증가 (GPU 24시간 가동)

---

## 🆚 2가지 모드 상세 비교

### 🖥️ 로컬 모드

```bash
docker compose -f docker-compose.voice.yml up -d
```

**실행되는 컨테이너:**
- ✅ `llm` (Ollama) - GPU 필요
- ✅ `asr` (faster-whisper) - GPU 필요
- ✅ `gateway` - llm, asr에 의존
- ✅ `bot`, `postgres`, `redis`

**장점:**
- 🔒 완전 프라이버시 (모든 데이터 로컬)
- 🌐 오프라인 가능
- 💰 장기적으로 무료 (API 비용 없음)

**단점:**
- 💾 VRAM 6-12GB 필요
- ⚡ 전기세 (GPU 24시간)
- 🐢 느린 응답 (로컬 추론)
- 🔥 PC 발열

---

### 🆓 무료 모드

```bash
docker compose -f docker-compose.voice.yml -f docker-compose.free.yml up -d
```

**실행되는 컨테이너:**
- ❌ ~~`llm`~~ - **제거됨** (replicas: 0)
- ❌ ~~`asr`~~ - **제거됨** (replicas: 0)
- ✅ `gateway` - 외부 API로 라우팅 (llm, asr 의존성 제거)
- ✅ `bot`, `postgres`, `redis`

**외부 서비스 사용:**
- 🌩️ Groq API (LLM + Whisper) - 무료
- 🌩️ Cloudflare Workers AI (TTS) - 무료

**장점:**
- 💻 GPU 불필요 (0% VRAM)
- ⚡ 전기세 절감
- 🚀 빠른 응답 (클라우드 추론)
- 🧊 PC 발열 없음
- 💰 무료 (한도 내)

**단점:**
- 🌐 인터넷 필수
- 📊 무료 한도 존재 (Groq: 충분, Cloudflare: 10만 neurons/일)
- 🔓 데이터가 외부 API로 전송 (프라이버시 ↓)

---

## 🔧 무료 모드 작동 원리

### docker-compose.free.yml이 하는 일

```yaml
# 1. 로컬 추론 컨테이너 제거
llm:
  deploy:
    replicas: 0    # ← 컨테이너 시작 안 함
  restart: "no"

asr:
  deploy:
    replicas: 0    # ← 컨테이너 시작 안 함
  restart: "no"

# 2. Gateway 의존성 변경
gateway:
  depends_on:
    # - llm   ← 제거됨!
    # - asr   ← 제거됨!
    - redis
    - postgres
  
  environment:
    # 외부 API 설정
    - LLM_PROVIDER=openai
    - LLM_BASE_URL=https://api.groq.com/openai/v1
    - ASR_PROVIDER=external
    - ASR_EXTERNAL_URL=https://api.groq.com/openai/v1/audio/transcriptions
    - TTS_PROVIDER=cloudflare
```

### 실행 흐름 비교

#### 로컬 모드 (`voice.yml`만)

```
[Discord 음성] 
   ↓
[Gateway] 
   ↓
[asr 컨테이너] ← GPU 추론 (로컬)
   ↓ (텍스트)
[llm 컨테이너] ← GPU 추론 (로컬)
   ↓ (응답 텍스트)
[ElevenLabs API] ← 클라우드 TTS (유료)
   ↓
[Discord 음성]
```

**리소스:** GPU 100%, 메모리 8GB

---

#### 무료 모드 (`voice.yml + free.yml`)

```
[Discord 음성] 
   ↓
[Gateway] 
   ↓
[Groq Whisper API] ← 클라우드 ASR (무료) 🌩️
   ↓ (텍스트)
[Groq LLM API] ← 클라우드 LLM (무료) 🌩️
   ↓ (응답 텍스트)
[Cloudflare TTS API] ← 클라우드 TTS (무료) 🌩️
   ↓
[Discord 음성]
```

**리소스:** GPU 0%, 메모리 256MB

---

## 📊 리소스 사용량 실측

| 항목 | 로컬 모드 | 무료 모드 | 절감률 |
|------|----------|----------|-------|
| **VRAM** | 6-12GB | 0GB | **100%** ⬇️ |
| **RAM** | 8-10GB | 256MB | **97%** ⬇️ |
| **CPU** | 20-40% | 2-5% | **90%** ⬇️ |
| **디스크 I/O** | 높음 (모델 로딩) | 낮음 | **80%** ⬇️ |
| **전기세** | ~200W (GPU) | ~10W | **95%** ⬇️ |

---

## 🎯 언제 어떤 모드를 쓸까?

### 로컬 모드 권장 상황

✅ GPU가 충분하다 (VRAM 12GB+)  
✅ 완전한 프라이버시가 필요하다  
✅ 오프라인 환경에서 사용한다  
✅ 전기세가 부담스럽지 않다  
✅ 장기적으로 무제한 사용할 것이다

**예시:** 기업 내부 봇, 민감 정보 처리

---

### 무료 모드 권장 상황 **✨ 대부분의 경우**

✅ GPU가 없거나 약하다 (GTX 1060 이하)  
✅ 다른 작업과 GPU를 공유한다 (게임, 렌더링)  
✅ 개인 프로젝트/테스트용이다  
✅ 하루 사용량이 적다 (100회 미만 대화)  
✅ 빠른 응답이 중요하다

**예시:** 개인 Discord 서버, 데모, 개발/테스트

---

## 🚨 주의사항

### ⚠️ 잘못된 실행 방법

```bash
# ❌ 틀림: docker-compose.yml과 free.yml 조합
docker compose -f docker-compose.yml -f docker-compose.free.yml up -d
# → llm, asr 서비스 정의가 없어서 에러!

# ❌ 틀림: free.yml만 단독 실행
docker compose -f docker-compose.free.yml up -d
# → gateway, postgres 등 기본 서비스가 없어서 에러!
```

### ✅ 올바른 실행 방법

```bash
# ✅ 로컬 모드: voice.yml만
docker compose -f docker-compose.voice.yml up -d

# ✅ 무료 모드: voice.yml + free.yml (오버라이드)
docker compose -f docker-compose.voice.yml -f docker-compose.free.yml up -d
```

---

## 💡 실전 팁

### 하이브리드 전략 (상황별 전환)

```bash
# 평소: 무료 모드 (부하 0%)
docker compose -f docker-compose.voice.yml -f docker-compose.free.yml up -d

# 외출/장시간 사용: 로컬 모드 (프라이버시)
docker compose -f docker-compose.voice.yml -f docker-compose.free.yml down
docker compose -f docker-compose.voice.yml up -d
```

### 무료 한도 관리

**Groq (LLM + ASR):**
- 한도: 초당 30 요청, 분당 14,400 토큰
- 전략: 응답 길이 제한 (`LLM_NUM_PREDICT=40-60`)

**Cloudflare (TTS):**
- 한도: 일 10만 neurons (약 5-10만 글자)
- 전략: 한도 초과 시 Piper 로컬 TTS 자동 폴백

---

## 🔍 컨테이너 상태 확인

### 로컬 모드 실행 시

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

**출력 예시:**
```
NAMES                STATUS              PORTS
libra-ollama         Up 2 minutes        11434/tcp
libra-asr            Up 2 minutes        5005/tcp
libra-gateway        Up 2 minutes        8001/tcp
libra-bot            Up 2 minutes        
libra-postgres       Up 2 minutes        5432/tcp
libra-redis          Up 2 minutes        6379/tcp
```

---

### 무료 모드 실행 시

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

**출력 예시:**
```
NAMES                STATUS              PORTS
libra-gateway        Up 2 minutes        8001/tcp  ← llm, asr 의존성 없음!
libra-bot            Up 2 minutes        
libra-postgres       Up 2 minutes        5432/tcp
libra-redis          Up 2 minutes        6379/tcp

(llm, asr 컨테이너 없음 ✅)
```

**확인 방법:**
```bash
# llm, asr 컨테이너가 없어야 정상!
docker ps | grep -E 'ollama|asr'
# → 출력 없음 (정상)
```

---

## 📚 관련 문서

- [VOICE_FREE_MODE.md](./VOICE_FREE_MODE.md) - 무료 모드 상세 설정
- [VOICE_QUICKSTART.md](./VOICE_QUICKSTART.md) - 로컬 모드 빠른 시작
- [README.md](./README.md) - 전체 프로젝트 개요

---

## 🎉 결론

| 질문 | 답변 |
|------|------|
| **GPU 없는데 음성 봇 돌릴 수 있나요?** | ✅ 가능! 무료 모드 사용 |
| **기존 부하 로직 제거해야 하나요?** | ✅ `docker-compose.free.yml`이 자동 제거 (`replicas: 0`) |
| **API 비용 드나요?** | ❌ 무료 티어 사용 (Groq + Cloudflare) |
| **로컬 모드로 돌아갈 수 있나요?** | ✅ `voice.yml`만 실행하면 즉시 전환 |

**추천:**
- **개인/테스트:** 🆓 무료 모드 (부하 0%)
- **프로덕션/프라이버시:** 🖥️ 로컬 모드 (GPU 필요)

