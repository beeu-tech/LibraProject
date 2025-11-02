# 리브라 봇 (Libra Bot)

Discord 텍스트/자율 음성채팅 봇 - 안정적이고 확장 가능한 아키텍처

## 🚀 빠른 시작

### 1. 환경 설정

```bash
# 저장소 클론
git clone <repository-url>
cd libra-bot

# 환경변수 설정
cp env.example .env
# .env 파일을 편집하여 필요한 API 키들을 설정하세요

# Vosk STT 모델 다운로드 (음성 채팅 기능용)
chmod +x scripts/downloadVoskModel.sh
./scripts/downloadVoskModel.sh
```

### 2. Docker로 실행 (권장)

```bash
# 모든 서비스 시작
docker-compose up -d

# 로그 확인
docker-compose logs -f
```

### 3. 로컬 개발 환경

```bash
# 의존성 설치
npm run install:all

# 개발 서버 시작
npm run dev
```

### 4. 🎤 음성 봇 실행 모드

리브라 봇은 **2가지 음성 모드**를 지원합니다:

#### 🖥️ 로컬 모드 (고성능, GPU 필요)
로컬에서 Ollama(LLM) + faster-whisper(ASR) 실행
```bash
docker compose -f docker-compose.yml -f docker-compose.voice.yml up -d
```
📖 [VOICE_QUICKSTART.md](./VOICE_QUICKSTART.md)

#### 🆓 무료 모드 (초저부하, GPU 불필요) **✨ 추천!**
외부 무료 API(Groq + Cloudflare) 사용, 로컬 부하 0%
```bash
# env.free.example을 .env로 복사하고 API 키 설정
cp env.free.example .env

# voice.yml 위에 free.yml을 오버라이드 (llm, asr 컨테이너 제거)
docker compose -f docker-compose.voice.yml -f docker-compose.free.yml up -d
```
📖 [VOICE_FREE_MODE.md](./VOICE_FREE_MODE.md) ← **무료 API 키 발급 방법 포함**

| 비교 항목 | 로컬 모드 | 🆓 무료 모드 |
|----------|----------|-------------|
| GPU 필요 | ✅ 필수 | ❌ 불필요 |
| 메모리 사용 | ~8GB | ~256MB |
| 비용 | 전기세 | 무료 (한도 내) |
| 오프라인 | ✅ 가능 | ❌ 불가능 |
| 속도 | 🐢 보통 | ⚡ 빠름 |

📖 **자세한 비교:** [VOICE_MODE_COMPARISON.md](./VOICE_MODE_COMPARISON.md)

## 📋 필수 설정

### Discord 봇 설정

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 새 애플리케이션 생성
2. Bot 섹션에서 토큰 생성
3. OAuth2 > URL Generator에서 필요한 권한 선택:
   - `Send Messages`
   - `Use Slash Commands`
   - `Connect` (음성 채널용)
   - `Speak` (음성 채널용)
   - `Use Voice Activity`

### 환경변수 설정

```bash
# Discord
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_GUILD_ID=your_test_guild_id

# AI 모델 (최소 하나는 필요)
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key

# STT/TTS (음성 기능용)
ELEVENLABS_API_KEY=your_elevenlabs_api_key
AZURE_SPEECH_KEY=your_azure_speech_key
AZURE_SPEECH_REGION=your_azure_region
```

## 🏗️ 아키텍처

```
[Discord Gateway]
      │
      ▼
[Bot Server (TS)] ←→ [API Gateway (BFF, TS)]
                           │
                           ├──► [AI Worker (Py/FastAPI)]
                           ├──► [Audio Worker (Py)] (향후)
                           ├──► [PostgreSQL]
                           └──► [Redis]
```

### 서비스 구성

- **Bot Server**: Discord 이벤트 처리, 레이트리밋, BFF 프록시
- **BFF (Backend for Frontend)**: API 게이트웨이, 인증, 캐시, 요청 정규화
- **AI Worker**: LLM 호출, 프롬프트 관리, 메모리 관리
- **Audio Worker**: VAD, STT, TTS, 음성 스트리밍 (향후 구현)

## 🛠️ 개발 가이드

### 프로젝트 구조

```
libra-bot/
├── apps/
│   ├── bot/              # Discord 봇 (TypeScript)
│   ├── bff/              # API 게이트웨이 (TypeScript)
│   └── ai-worker/        # AI 워커 (Python/FastAPI)
├── packages/
│   └── shared/           # 공유 타입 및 유틸리티
├── infra/
│   ├── docker/           # Docker 설정
│   └── monitoring/       # 모니터링 설정
└── docker-compose.yml
```

### 개발 명령어

```bash
# 전체 개발 서버 시작
npm run dev

# 개별 서비스 시작
npm run dev:bot
npm run dev:bff
npm run dev:ai-worker

# 빌드
npm run build
```

### API 엔드포인트

#### BFF API (포트 3001)

- `POST /api/chat/completions` - 채팅 완성
- `GET /api/chat/history/:userId` - 채팅 히스토리
- `POST /api/chat/session/:userId/reset` - 세션 초기화
- `POST /api/stt/transcribe` - 음성을 텍스트로 변환
- `GET /api/stt/health` - STT 서비스 헬스체크
- `GET /health` - 헬스체크

#### AI Worker API (포트 8000)

- `POST /api/chat/completions` - LLM 채팅 완성
- `GET /api/chat/history/:userId` - 대화 히스토리
- `POST /api/chat/session/:userId/reset` - 세션 초기화
- `POST /api/stt/transcribe` - Vosk STT 음성 인식
- `POST /api/stt/transcribe-raw` - 원시 오디오 데이터 STT
- `GET /api/stt/models` - 사용 가능한 STT 모델 목록
- `GET /api/health` - 헬스체크

## 🎤 음성 채팅 기능

### Vosk STT 엔진

리브라 봇은 **Vosk** 오프라인 음성 인식 엔진을 사용하여 음성 채팅을 지원합니다.

#### 특징
- **오프라인 작동**: 인터넷 연결 없이도 음성 인식 가능
- **빠른 응답**: 로컬 처리로 낮은 지연시간
- **다국어 지원**: 영어, 한국어, 중국어 등 다양한 언어 모델
- **경량화**: 소형 모델로 리소스 효율적

#### 사용 가능한 모델

| 모델 | 크기 | 언어 | 정확도 | 용도 |
|------|------|------|--------|------|
| `vosk-model-small-en-us-0.15` | 40MB | 영어 | 기본 | 개발/테스트 |
| `vosk-model-en-us-0.22` | 1.8GB | 영어 | 높음 | 프로덕션 |
| `vosk-model-small-ko-0.22` | 45MB | 한국어 | 기본 | 한국어 지원 |

#### 음성 명령어

Discord 슬래시 명령어를 통해 음성 채팅을 제어할 수 있습니다:

- `/join` - 음성 채널에 참여
- `/leave` - 음성 채널에서 나가기
- `/record` - 음성 녹음 시작
- `/stop` - 음성 녹음 중지 및 텍스트 변환
- `/voice-status` - 음성 채팅 상태 확인

#### 사용법

1. **음성 채널 참여**
   ```
   /join
   ```

2. **음성 녹음 시작**
   ```
   /record
   ```

3. **말하기** (봇이 음성을 듣고 있습니다)

4. **녹음 중지 및 변환**
   ```
   /stop
   ```

5. **AI 응답** (텍스트로 응답하거나 TTS로 음성 응답)

#### 모델 교체

다른 Vosk 모델을 사용하려면:

1. 모델 다운로드:
   ```bash
   # 한국어 모델 예시
   wget https://alphacephei.com/vosk/models/vosk-model-small-ko-0.22.zip
   unzip vosk-model-small-ko-0.22.zip
   ```

2. `docker-compose.yml`에서 모델 경로 수정:
   ```yaml
   environment:
     - VOSK_MODEL_PATH=/app/models/vosk-model-small-ko-0.22
   ```

3. 서비스 재시작:
   ```bash
   docker-compose restart ai-worker
   ```

## 📊 모니터링

### Grafana 대시보드

- URL: http://localhost:3000
- 기본 계정: admin/admin

### Prometheus 메트릭

- URL: http://localhost:9090

### 주요 메트릭

- 응답 시간 (p95, p99)
- 토큰 사용량
- 에러율
- 레이트리밋 상태
- 데이터베이스 연결 상태

## 🔧 설정 및 커스터마이징

### 프롬프트 템플릿 수정

`apps/ai-worker/app/services/prompt_service.py`에서 시스템 프롬프트를 수정할 수 있습니다.

### 레이트리밋 설정

`apps/bot/src/utils/rateLimiter.ts`에서 사용자별/길드별 레이트리밋을 조정할 수 있습니다.

### 모델 설정

환경변수 `DEFAULT_LLM_MODEL`로 기본 모델을 설정:
- `gpt-4` (OpenAI GPT-4)
- `gpt-3.5-turbo` (OpenAI GPT-3.5)
- `claude-3-opus-20240229` (Anthropic Claude)

## 🚀 배포

### Docker 배포

```bash
# 프로덕션 빌드
docker-compose -f docker-compose.prod.yml up -d
```

### Kubernetes 배포

```bash
kubectl apply -f infra/k8s/
```

## 🔒 보안 고려사항

- Discord 토큰과 API 키는 환경변수로 관리
- Redis와 PostgreSQL은 내부 네트워크에서만 접근 가능
- 모든 API 요청은 인증 토큰 필요
- 레이트리밋으로 남용 방지
- 콘텐츠 모더레이션 (향후 구현)

## 📈 성능 최적화

### 캐시 전략

- Redis를 통한 응답 캐싱
- 사용자 컨텍스트 캐싱 (5분 TTL)
- 대화 히스토리 캐싱

### 데이터베이스 최적화

- 메시지 테이블 인덱싱
- 대화 히스토리 요약 저장
- 벡터 임베딩을 통한 RAG (향후 구현)

## 🤝 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.

## 🆘 문제 해결

### 일반적인 문제

1. **봇이 응답하지 않음**
   - Discord 토큰 확인
   - 봇 권한 확인
   - BFF 서비스 상태 확인

2. **AI 응답이 느림**
   - API 키 설정 확인
   - 네트워크 연결 상태 확인
   - 모델 설정 확인

3. **데이터베이스 연결 실패**
   - PostgreSQL 서비스 상태 확인
   - 연결 문자열 확인
   - 방화벽 설정 확인

### 로그 확인

```bash
# Docker 로그
docker-compose logs -f [service-name]

# 개별 서비스 로그
docker-compose logs -f bot
docker-compose logs -f bff
docker-compose logs -f ai-worker
```

## 📞 지원

문제가 발생하면 GitHub Issues를 통해 문의해주세요.
