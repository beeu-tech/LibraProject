# 🎭 Libra Bot - Discord 음성/텍스트 AI 챗봇

Discord 기반의 확장 가능한 AI 챗봇 시스템 - 텍스트 채팅과 실시간 음성 대화를 모두 지원합니다.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

---

## 📋 목차

- [주요 기능](#-주요-기능)
- [시스템 아키텍처](#-시스템-아키텍처)
- [빠른 시작](#-빠른-시작)
- [배포 모드](#-배포-모드)
- [환경 설정](#-환경-설정)
- [개발 가이드](#-개발-가이드)
- [API 문서](#-api-문서)
- [모니터링](#-모니터링)
- [문제 해결](#-문제-해결)

---

## ✨ 주요 기능

### 💬 텍스트 채팅
- ✅ LLM 기반 자연어 대화 (GPT, Claude, Qwen 등)
- ✅ 스트리밍 응답 지원
- ✅ 대화 컨텍스트 메모리 관리
- ✅ 다국어 자동 감지 (한국어/영어)
- ✅ 사용자별 레이트리밋

### 🎤 실시간 음성 대화
- ✅ 자동 음성 감지 (VAD)
- ✅ 음성 인식 (ASR): faster-whisper / Groq Whisper
- ✅ 음성 합성 (TTS): ElevenLabs / Cloudflare Workers AI
- ✅ End-to-End 레이턴시: **1.25-2.2초**
- ✅ 양방향 실시간 스트리밍

### 🚀 확장성 & 성능
- ✅ 마이크로서비스 아키텍처
- ✅ 수평 확장 (다중 인스턴스)
- ✅ Redis 기반 캐싱
- ✅ Circuit Breaker 패턴 (opossum)
- ✅ 자동 스케일링 지원

### 📊 관찰성
- ✅ Prometheus 메트릭
- ✅ Grafana 대시보드
- ✅ 구조화된 로깅 (JSON)
- ✅ 실시간 헬스체크

---

## 🏗️ 시스템 아키텍처

### 전체 구성도

```
┌─────────────────────────────────────────────────────────────┐
│                      Discord 사용자                          │
└────────────────┬────────────────────────────────────────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
[텍스트 메시지]          [음성 채널]
    │                         │
    ▼                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Bot Server (TypeScript)                    │
│  - Discord.js Gateway                                        │
│  - 슬래시 명령어 핸들러                                       │
│  - 레이트리밋 & 인증                                         │
└────────┬─────────────────────────────────┬──────────────────┘
         │                                 │
         ▼                                 ▼
┌──────────────────────┐        ┌──────────────────────┐
│   AI Worker (Py)     │        │   Gateway (TS)       │
│  ─────────────────   │        │  ──────────────────  │
│  • LLM API 호출      │        │  • 음성 파이프라인    │
│  • Groq/OpenAI       │        │  • ASR → LLM → TTS   │
│  • 메모리 관리       │        │  • 실시간 스트리밍    │
│  • 프롬프트 엔진     │        │  • VAD 기반 처리     │
└──────────┬───────────┘        └──────────┬───────────┘
           │                               │
           └───────────┬───────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
┌─────────────────┐          ┌─────────────────┐
│   PostgreSQL    │          │      Redis      │
│  ─────────────  │          │  ─────────────  │
│  • 대화 히스토리 │          │  • 캐싱         │
│  • 사용자 데이터 │          │  • 세션 관리     │
│  • 벡터 검색    │          │  • 레이트리밋    │
└─────────────────┘          └─────────────────┘
```

### 마이크로서비스 구성

| 서비스 | 기술 스택 | 역할 | 포트 |
|--------|----------|------|------|
| **bot** | TypeScript, Discord.js | Discord 게이트웨이 | - |
| **ai-worker** | Python, FastAPI | LLM 처리 엔진 | 8000 |
| **gateway** | TypeScript, Express | 음성 파이프라인 오케스트레이터 | 8001 |
| **asr-worker** | Python, faster-whisper | 음성 인식 (선택) | 5005 |
| **bff** | TypeScript, Express | API 게이트웨이 (선택) | 3001 |
| **websocket-gateway** | TypeScript, Socket.io | 실시간 스트리밍 (확장) | 8002 |
| **voice-cluster** | TypeScript | 음성 처리 워커 (확장) | - |
| **load-balancer** | TypeScript | 로드밸런서 (확장) | 8000 |
| **monitoring** | Prometheus, Grafana | 모니터링 대시보드 | 3000 |
| **postgres** | PostgreSQL 15 + pgvector | 데이터베이스 | 5433 |
| **redis** | Redis 7 | 캐시 & 메시지 큐 | 6380 |

---

## 🚀 빠른 시작

### 1️⃣ 사전 요구사항

- **Docker** 20.10+ & **Docker Compose** 2.0+
- **Node.js** 18+ (로컬 개발 시)
- **Python** 3.11+ (로컬 개발 시)
- **GPU** (선택, 로컬 모드 음성 인식 시)

### 2️⃣ 설치

```bash
# 저장소 클론
git clone <repository-url>
cd LibraProject

# 환경변수 설정 (예제 파일 복사)
cp env.example .env

# .env 파일 편집하여 필수 값 입력
# - DISCORD_TOKEN
# - OPENAI_API_KEY (또는 다른 LLM API 키)
notepad .env  # Windows
```

### 3️⃣ 실행

#### 🆓 **추천: Groq 무료 모드** (GPU 불필요)

```bash
# Groq API 키 필요 (무료)
docker compose -f docker-compose.groq.yml up -d

# 로그 확인
docker compose -f docker-compose.groq.yml logs -f
```

#### 🖥️ **기본 모드** (텍스트 채팅만)

```bash
docker compose -f docker-compose.yml.backup up -d
```

#### 📈 **확장 모드** (대규모 동시 사용자)

```bash
docker compose -f docker-compose.scalable.yml up -d
```

### 4️⃣ Discord 봇 초대

```bash
# Discord Developer Portal에서 봇 초대 URL 생성
https://discord.com/developers/applications

# 필요 권한:
# - Send Messages
# - Use Slash Commands
# - Connect (음성용)
# - Speak (음성용)
# - Use Voice Activity
```

### 5️⃣ 사용해보기

Discord 서버에서:
```
/chat on          # 채팅 모드 활성화
안녕!              # 봇과 대화

/join             # 음성 채널 참여 (음성 모드)
/record           # 음성 녹음 시작
(말하기...)
/stop             # 음성 녹음 종료 & AI 응답
```

---

## 🎯 배포 모드

### 모드 비교

| 항목 | 기본 모드 | **Groq 무료 모드** ✨ | 확장 모드 | WebSocket 모드 |
|------|----------|---------------------|----------|---------------|
| **설정 파일** | `docker-compose.yml.backup` | `docker-compose.groq.yml` | `docker-compose.scalable.yml` | `docker-compose.websocket.yml` |
| **GPU 필요** | ❌ | ❌ | ❌ | ❌ |
| **VRAM 사용** | 0GB | 0GB | 0GB | 0GB |
| **메모리** | ~1GB | ~1GB | ~3GB | ~2GB |
| **동시 사용자** | ~10 | ~50 | ~500+ | ~100 |
| **음성 지원** | ❌ | ✅ | ✅ | ✅ |
| **비용** | 유료 API | **무료** | 무료/유료 | 무료/유료 |
| **레이턴시** | 중간 | **빠름** | 중간 | 빠름 |
| **확장성** | 고정 | 고정 | **자동** | 수동 |

### 📝 모드별 상세

#### 🆓 **Groq 무료 모드** (권장)

**장점:**
- ✅ 완전 무료 (Groq API 한도 내)
- ✅ GPU 불필요
- ✅ 빠른 응답 속도
- ✅ 음성 지원 (Groq Whisper)
- ✅ 최소 리소스 사용

**단점:**
- ❌ API 한도 제한 (초당 30 요청)
- ❌ 인터넷 필수

**설정:**
```bash
# .env에 Groq API 키만 입력
OPENAI_API_KEY=gsk_your_groq_api_key_here
DISCORD_TOKEN=your_discord_token
```

📖 **상세 가이드:** [document/API_SETUP_GUIDE.md](document/API_SETUP_GUIDE.md)

#### 🖥️ **로컬 GPU 모드** (오프라인)

**장점:**
- ✅ 완전 오프라인 작동
- ✅ API 비용 없음
- ✅ 데이터 프라이버시

**단점:**
- ❌ GPU 필수 (RTX 2070 이상 권장)
- ❌ VRAM 6-8GB 필요
- ❌ 느린 응답 속도

📖 **상세 가이드:** [document/VOICE_QUICKSTART.md](document/VOICE_QUICKSTART.md)

#### 📈 **확장 모드** (프로덕션)

**특징:**
- ✅ 로드밸런서
- ✅ 다중 인스턴스 (WebSocket Gateway x2, Voice Cluster x3)
- ✅ 자동 스케일링
- ✅ 서비스 디스커버리 (Redis)
- ✅ 모니터링 대시보드

**용도:** 대규모 Discord 서버 (500+ 동시 사용자)

---

## ⚙️ 환경 설정

### 필수 환경변수

```bash
# Discord 봇 설정 (필수)
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_GUILD_ID=your_test_guild_id  # 테스트용 (선택)

# LLM API (하나 이상 필수)
OPENAI_API_KEY=your_openai_api_key          # OpenAI GPT
ANTHROPIC_API_KEY=your_anthropic_api_key    # Claude
# Groq 무료 모드: OPENAI_API_KEY에 Groq API 키 입력

# 데이터베이스 (기본값 사용 가능)
DATABASE_URL=postgresql://libra_user:libra_password@postgres:5432/libra_bot
REDIS_URL=redis://redis:6379

# 보안 (프로덕션 필수)
WORKER_SHARED_SECRET=your_random_secret_key_here
BFF_API_KEY=your_bff_api_key_here
JWT_SECRET=your_jwt_secret_here
```

### 선택 환경변수

```bash
# 음성 합성 (TTS)
ELEVENLABS_API_KEY=your_elevenlabs_api_key     # 고품질 (유료)
CF_API_TOKEN=your_cloudflare_token             # 무료
CF_ACCOUNT_ID=your_cloudflare_account_id

# Ollama 로컬 모드
OLLAMA_URL=http://host.docker.internal:11434
PRIMARY_MODEL=llama3:8b-instruct-q4_K_M
ALT_MODEL=qwen2.5:7b-instruct

# 성능 튜닝
LLM_TIMEOUT_SEC=30
MAX_TOKENS=512
LLM_TEMPERATURE=0.6
LLM_CACHE_ENABLED=1
LLM_CACHE_TTL=300
```

📖 **전체 환경변수:** [env.example](env.example)

---

## 🛠️ 개발 가이드

### 프로젝트 구조

```
LibraProject/
├── apps/                           # 마이크로서비스
│   ├── bot/                        # Discord 봇 (TS)
│   │   ├── src/
│   │   │   ├── libraBot.ts         # 메인 봇 로직
│   │   │   ├── commands/           # 슬래시 명령어
│   │   │   ├── services/           # AI Worker, Voice 서비스
│   │   │   └── utils/              # 로거, 레이트리밋
│   │   └── Dockerfile
│   ├── ai-worker/                  # AI 워커 (Python)
│   │   ├── app/
│   │   │   ├── main.py             # FastAPI 앱
│   │   │   ├── routes/             # API 라우트
│   │   │   ├── services/           # LLM, 메모리 서비스
│   │   │   └── database.py         # DB 연결
│   │   └── requirements.txt
│   ├── gateway/                    # 음성 게이트웨이 (TS)
│   ├── asr-worker/                 # 음성 인식 (Python)
│   ├── bff/                        # API 게이트웨이 (TS)
│   ├── websocket-gateway/          # WebSocket 서버 (TS)
│   ├── voice-processing-cluster/   # 음성 처리 클러스터 (TS)
│   ├── load-balancer/              # 로드밸런서 (TS)
│   ├── monitoring/                 # 모니터링 (TS)
│   └── auto-scaler/                # 자동 스케일러 (TS)
├── packages/
│   └── shared/                     # 공유 라이브러리 (타입, 유틸)
├── infra/                          # 인프라 설정
│   ├── docker/                     # DB 초기화 스크립트
│   ├── monitoring/                 # Prometheus/Grafana 설정
│   ├── migrations/                 # DB 마이그레이션
│   └── k6/                         # 부하 테스트 스크립트
├── models/                         # AI 모델 (gitignore)
├── document/                       # 프로젝트 문서
│   ├── API_SETUP_GUIDE.md          # API 키 발급 가이드
│   ├── VOICE_QUICKSTART.md         # 음성 모드 가이드
│   ├── VOICE_ARCHITECTURE.md       # 음성 아키텍처
│   └── ...
├── scripts/                        # 유틸리티 스크립트
│   ├── downloadVoskModel.sh        # Vosk 모델 다운로드
│   └── createSecrets.sh            # 시크릿 생성
├── docker-compose.*.yml            # 배포 구성
├── env.example                     # 환경변수 예제
└── README.md                       # 이 파일
```

### 로컬 개발 환경 설정

#### TypeScript 서비스 (Bot, Gateway, BFF)

```bash
# 의존성 설치
npm install

# 개발 서버 실행
cd apps/bot
npm run dev

# 빌드
npm run build

# 타입 체크
npm run type-check
```

#### Python 서비스 (AI Worker, ASR Worker)

```bash
# 가상환경 생성
cd apps/ai-worker
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 의존성 설치
pip install -r requirements.txt

# 개발 서버 실행
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 코드 스타일

- **TypeScript**: Prettier + ESLint
- **Python**: Black + Flake8
- **커밋 메시지**: Conventional Commits

```bash
# 예시
feat: 음성 명령어 추가
fix: 레이트리밋 버그 수정
docs: README 업데이트
chore: 의존성 업데이트
```

---

## 📡 API 문서

### AI Worker API (Port 8000)

#### Chat Completion
```http
POST /api/chat/completions
Content-Type: application/json

{
  "userId": "discord_user_id",
  "message": "안녕하세요!",
  "stream": true
}

Response (Stream):
data: {"content": "안녕하세요! ", "done": false}
data: {"content": "무엇을 ", "done": false}
data: {"content": "도와드릴까요?", "done": true}
```

#### Chat History
```http
GET /api/chat/history/:userId
Response:
{
  "messages": [
    {"role": "user", "content": "안녕하세요!"},
    {"role": "assistant", "content": "안녕하세요! 무엇을 도와드릴까요?"}
  ]
}
```

#### STT (Speech-to-Text)
```http
POST /api/stt/transcribe
Content-Type: multipart/form-data

file: audio.wav

Response:
{
  "text": "안녕하세요 리브라",
  "language": "ko",
  "confidence": 0.95
}
```

#### Health Check
```http
GET /api/health
Response:
{
  "status": "healthy",
  "services": {
    "llm": "ok",
    "database": "ok",
    "redis": "ok"
  }
}
```

### Gateway API (Port 8001)

#### Voice Pipeline
```http
POST /voice/process
Content-Type: application/json

{
  "userId": "discord_user_id",
  "audioData": "base64_encoded_pcm",
  "sampleRate": 48000
}

Response (Stream):
data: {"type": "transcript", "text": "안녕하세요"}
data: {"type": "llm", "content": "안녕하세요! "}
data: {"type": "audio", "data": "base64_tts_audio"}
```

📖 **전체 API 문서:** Swagger UI - http://localhost:8000/docs

---

## 📊 모니터링

### Prometheus (메트릭)

- **URL:** http://localhost:9090
- **메트릭:**
  - `http_requests_total`: 총 요청 수
  - `http_request_duration_seconds`: 요청 레이턴시
  - `llm_tokens_used_total`: LLM 토큰 사용량
  - `redis_cache_hit_rate`: 캐시 히트율
  - `voice_processing_duration_seconds`: 음성 처리 시간

### Grafana (대시보드)

- **URL:** http://localhost:3000
- **기본 계정:** `admin` / `admin`
- **대시보드:**
  - System Overview: 전체 시스템 상태
  - API Performance: API 레이턴시, 에러율
  - LLM Usage: 토큰 사용량, 비용 추정
  - Voice Pipeline: 음성 처리 파이프라인 메트릭

### 로그 확인

```bash
# 전체 로그
docker compose -f docker-compose.groq.yml logs -f

# 특정 서비스 로그
docker compose -f docker-compose.groq.yml logs -f bot
docker compose -f docker-compose.groq.yml logs -f ai-worker
docker compose -f docker-compose.groq.yml logs -f gateway

# 에러만 필터링
docker compose logs -f | grep ERROR
```

---

## 🐛 문제 해결

### 1. 봇이 Discord에 연결되지 않음

**증상:**
```
Error: Invalid token
```

**해결:**
1. `.env` 파일에서 `DISCORD_TOKEN` 확인
2. Discord Developer Portal에서 토큰 재발급
3. 봇 권한 확인 (Privileged Gateway Intents 활성화)

```bash
# 컨테이너 재시작
docker compose restart bot
```

### 2. AI 응답이 느리거나 없음

**증상:**
- 응답 시간 > 10초
- Timeout 에러

**해결:**
1. API 키 확인
```bash
docker compose logs ai-worker | grep "API"
```

2. 네트워크 연결 확인
```bash
docker exec -it libra-ai-worker curl -I https://api.groq.com
```

3. Redis 캐시 확인
```bash
docker exec -it libra-redis redis-cli ping
```

### 3. 음성 인식이 작동하지 않음

**증상:**
- `/record` 명령어 후 응답 없음
- ASR 에러

**해결:**
1. Gateway 로그 확인
```bash
docker compose logs gateway
```

2. Groq API 키 확인 (Groq 모드)
```bash
# .env 파일
OPENAI_API_KEY=gsk_...  # gsk_로 시작해야 함
```

3. 음성 파일 형식 확인
- 지원: PCM, WAV (16kHz mono)

### 4. 데이터베이스 연결 실패

**증상:**
```
Error: Connection refused - postgres:5432
```

**해결:**
1. PostgreSQL 컨테이너 상태 확인
```bash
docker ps | grep postgres
docker logs libra-postgres
```

2. 헬스체크 확인
```bash
docker inspect libra-postgres | grep -A 5 Health
```

3. 데이터베이스 재시작
```bash
docker compose restart postgres
```

### 5. 메모리 부족 (WSL)

**증상:**
- 컨테이너 크래시
- OOM Killer

**해결:**
1. WSL 메모리 제한 증가
```ini
# C:\Users\<username>\.wslconfig
[wsl2]
memory=12GB
swap=8GB
```

2. Docker 리소스 제한 확인
```bash
docker stats
```

### 6. 레이트리밋 에러

**증상:**
```
Error: Too many requests
```

**해결:**
1. Groq API 한도 확인 (초당 30 요청)
2. 캐시 활성화 확인
```bash
# .env
LLM_CACHE_ENABLED=1
LLM_CACHE_TTL=300
```

3. 봇 레이트리밋 조정
```typescript
// apps/bot/src/utils/rateLimiter.ts
maxRequests: 10,  // 10초당 요청 수
```

---

## 📚 추가 문서

- 📖 [API 키 발급 가이드](document/API_SETUP_GUIDE.md)
- 📖 [음성 모드 빠른 시작](document/VOICE_QUICKSTART.md)
- 📖 [음성 아키텍처 상세](document/VOICE_ARCHITECTURE.md)
- 📖 [음성 모드 비교](document/VOICE_MODE_COMPARISON.md)
- 📖 [무료 모드 가이드](document/VOICE_FREE_MODE.md)
- 📖 [보안 가이드](document/SECURITY.md)
- 📖 [프로덕션 체크리스트](document/PRODUCTION_CHECKLIST.md)
- 📖 [테스트 가이드](document/TEST_GUIDE.md)
- 📖 [개발 퀵스타트](document/QUICKSTART_DEV.md)

---

## 🤝 기여하기

기여를 환영합니다! 다음 절차를 따라주세요:

1. Fork the repository
2. Create your feature branch
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. Commit your changes
   ```bash
   git commit -m 'feat: Add amazing feature'
   ```
4. Push to the branch
   ```bash
   git push origin feature/amazing-feature
   ```
5. Open a Pull Request

### 코드 리뷰 가이드라인

- 테스트 코드 포함
- 문서 업데이트
- Linter 통과
- 커밋 메시지 규칙 준수

---

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.

---

## 🆘 지원

문제가 발생하거나 질문이 있으시면:

1. 📖 [문서](document/)를 먼저 확인해주세요
2. 🐛 [GitHub Issues](../../issues)에 문제를 보고해주세요
3. 💬 Discord 서버에서 질문해주세요 (준비 중)

---

## 🎯 로드맵

### v1.0 (현재)
- ✅ 텍스트 채팅
- ✅ 음성 대화 (Groq/로컬)
- ✅ 기본 모니터링
- ✅ Docker 배포

### v1.1 (진행 중)
- 🔄 WebSocket 실시간 스트리밍
- 🔄 자동 스케일링
- 🔄 콘텐츠 모더레이션
- 🔄 다국어 지원 확장 (일본어, 중국어)

### v2.0 (계획)
- 📋 RAG (검색 증강 생성)
- 📋 벡터 DB 통합
- 📋 이미지 인식 (GPT-4 Vision)
- 📋 음악/사운드 이펙트
- 📋 Kubernetes 배포
- 📋 플러그인 시스템

---

## 🙏 감사의 말

이 프로젝트는 다음 오픈소스 프로젝트들을 사용합니다:

- [Discord.js](https://discord.js.org/)
- [FastAPI](https://fastapi.tiangolo.com/)
- [faster-whisper](https://github.com/guillaumekln/faster-whisper)
- [Ollama](https://ollama.ai/)
- [Groq](https://groq.com/)
- [Redis](https://redis.io/)
- [PostgreSQL](https://www.postgresql.org/)
- [Prometheus](https://prometheus.io/)
- [Grafana](https://grafana.com/)

---

<div align="center">

**Made with ❤️ by LibraProject Team**

[⬆ 맨 위로](#-libra-bot---discord-음성텍스트-ai-챗봇)

</div>
