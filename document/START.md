# 🚀 무료 모드 빠른 실행 가이드

## 1단계: Docker Desktop 시작 ⚠️

**Windows 시작 메뉴** → **Docker Desktop** 실행

Docker가 완전히 시작될 때까지 기다리세요 (1-2분).  
시스템 트레이에서 Docker 아이콘이 안정화되면 준비 완료!

---

## 2단계: API 키 설정

### 2-1. .env 파일 생성

```powershell
# env.free.example을 .env로 복사
Copy-Item env.free.example .env

# .env 파일 열기
notepad .env
```

### 2-2. 필수 API 키 설정

```env
# 1️⃣ Groq API 키 (LLM + ASR, 무료!)
OPENAI_API_KEY=gsk_your_groq_api_key_here
# 발급: https://console.groq.com/keys

# 2️⃣ Discord 봇 토큰
DISCORD_TOKEN=your_discord_bot_token_here  
# 발급: https://discord.com/developers/applications

# 3️⃣ Cloudflare (TTS, 선택 사항 - 없으면 ElevenLabs 사용)
CF_API_TOKEN=your_cloudflare_api_token_here
CF_ACCOUNT_ID=your_cloudflare_account_id_here
# 발급: https://dash.cloudflare.com/profile/api-tokens
```

**최소 필수:** Groq API 키, Discord 토큰만 있어도 실행 가능!

---

## 3단계: 무료 모드 실행

```powershell
# 무료 모드 실행 (llm, asr 컨테이너 제거)
docker compose -f docker-compose.voice.yml -f docker-compose.free.yml up -d
```

---

## 4단계: 확인

```powershell
# 실행 중인 컨테이너 확인
docker ps --format "table {{.Names}}\t{{.Status}}"

# 출력 예시 (정상):
# NAMES                STATUS
# libra-gateway        Up 1 minute  ← ✅ 있어야 함
# libra-bot            Up 1 minute  ← ✅ 있어야 함
# libra-postgres       Up 1 minute  ← ✅ 있어야 함
# libra-redis          Up 1 minute  ← ✅ 있어야 함
# (llm, asr 없음 = 정상! ✅ 로컬 부하 0%)

# Gateway 로그 확인 (외부 API 호출 확인)
docker compose -f docker-compose.voice.yml -f docker-compose.free.yml logs -f gateway

# 확인 포인트:
# ✅ "asrProvider: external, llmProvider: openai, ttsProvider: cloudflare"
# ✅ "외부 Whisper API 요청"
# ✅ "OpenAI 호환 API 요청"
```

---

## 중지

```powershell
docker compose -f docker-compose.voice.yml -f docker-compose.free.yml down
```

---

## 🎉 완료!

이제 디스코드에서 `/voice-chat` 명령어로 음성 대화를 시작하세요!

**로컬 부하:** GPU 0%, 메모리 256MB만 사용 🚀


