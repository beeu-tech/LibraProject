# 🧪 무료 모드 테스트 가이드

## ✅ 현재 상태

모든 서버가 정상 실행 중입니다!

```
서비스            상태       포트      LLM 제공자
─────────────────────────────────────────────────
Gateway (음성)    Up        8001      Groq API ✅
AI Worker (텍스트) Up        8000      Groq API ✅
Bot (Discord)     Up        -         연결됨 ✅
PostgreSQL        Up        5433      정상 ✅
Redis             Up        6380      정상 ✅
```

---

## 🧪 테스트 방법

### 1️⃣ 텍스트 채팅 테스트 (Groq API 확인)

Discord 채널에서 다음 메시지를 보내세요:

```
/chat 안녕?
```

또는

```
@리브라 오늘 날씨 어때?
```

**로그 모니터링:**
```bash
# 다른 터미널에서 실시간 로그 확인
docker compose -f docker-compose.voice-free.yml logs -f ai-worker
```

**정상 출력 (Groq API 사용):**
```
{"event": "OpenAI 호환 API 요청", "base_url": "https://api.groq.com/openai/v1", "model": "llama-3.1-8b-instant"}
{"event": "언어 감지 기반 LLM 요청", "provider": "openai"}
```

**비정상 출력 (Ollama 찾음):**
```
{"event": "Ollama 스트리밍 실패", "error": "connection refused"}
```

---

### 2️⃣ 음성 대화 테스트 (Groq API 확인)

Discord에서:

1. **음성 채널 입장**
2. `/voice-chat` 명령어 입력
3. **마이크로 말하기**: "안녕?"
4. 봇이 음성으로 응답

**로그 모니터링:**
```bash
docker compose -f docker-compose.voice-free.yml logs -f gateway
```

**정상 출력:**
```
[INFO] 외부 Whisper API 요청
[INFO] OpenAI 호환 API 요청
[INFO] Cloudflare TTS 요청
```

---

## 🔍 로그로 API 사용 확인하는 방법

### AI Worker 로그 (텍스트 채팅)

```bash
docker logs libra-ai-worker --follow
```

Discord에서 `/chat 테스트` 입력 후:

**✅ Groq API 사용 (정상):**
```json
{"event": "OpenAI 호환 API 모드로 초기화"}
{"event": "OpenAI 호환 API 요청", "base_url": "https://api.groq.com/openai/v1"}
```

**❌ Ollama 사용 (문제):**
```json
{"event": "Ollama 요청 URL: http://..."}
{"event": "Ollama 스트리밍 실패"}
```

---

### Gateway 로그 (음성 대화)

```bash
docker logs libra-gateway --follow
```

음성 채널에서 말하기 후:

**✅ Groq API 사용 (정상):**
```
[INFO] 외부 Whisper API 요청 { url: 'https://api.groq.com/...' }
[INFO] OpenAI 호환 API 요청 { baseUrl: 'https://api.groq.com/...' }
```

**❌ 로컬 서비스 사용 (문제):**
```
[ERROR] ASR 요청 실패 { status: 502 }
[ERROR] LLM 요청 실패
```

---

## 🎯 지금 테스트해보세요!

### 간단한 테스트

1. **Discord 채널**에서:
   ```
   /chat 안녕?
   ```

2. **이 PowerShell 창**에서 로그 확인:
   ```powershell
   docker compose -f docker-compose.voice-free.yml logs -f ai-worker
   ```

3. **"OpenAI 호환 API"** 문구가 보이면 성공! ✅

---

## 📊 리소스 모니터링

### 실시간 리소스 확인

```bash
docker stats
```

**정상:**
```
NAME              CPU %     MEM USAGE / LIMIT
libra-gateway     0.1%      70MB / 512MB
libra-ai-worker   0.2%      71MB / 512MB
libra-bot         0.0%      50MB / 512MB
libra-postgres    0.0%      43MB / 512MB
libra-redis       1.6%      7MB / 256MB
```

**총 메모리: ~241MB (VRAM 0GB!)** ✨

---

## 🆘 문제 해결

### Q: "Ollama 스트리밍 실패" 로그가 나옴

**원인**: AI Worker가 여전히 Ollama를 찾고 있음

**해결**:
```bash
# AI Worker 재시작
docker compose -f docker-compose.voice-free.yml restart ai-worker

# 환경변수 확인
docker exec libra-ai-worker env | grep -E "LLM_PROVIDER|OPENAI"
```

**예상 출력:**
```
LLM_PROVIDER=openai
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=gsk_...
```

### Q: AI Worker가 응답하지 않음

**확인:**
```bash
# Groq API 키 확인
docker exec libra-ai-worker printenv OPENAI_API_KEY
# → gsk_로 시작해야 함

# 로그 확인
docker logs libra-ai-worker --tail 50
```

---

## 🎉 성공 확인

Discord에서 `/chat 안녕?` 입력 후:

1. ✅ Bot이 응답함
2. ✅ 로그에 "OpenAI 호환 API" 보임
3. ✅ 로컬 GPU/메모리 사용량 변화 없음

**→ Groq API 사용 성공!** 🎊

---

지금 Discord에서 `/chat` 명령어를 테스트해보세요!

