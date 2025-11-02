# 실시간 음성 대화 시스템 빠른 시작 🎤

## 🎯 시스템 구성

```
[사용자 음성 Discord] 
        ↓
[Bot] Discord.js Voice 수신
        ↓ PCM 16kHz
[Gateway] 오케스트레이션 (포트 8001)
        ├→ [ASR] faster-whisper (포트 5005) → "안녕하세요"
        ├→ [LLM] Ollama Qwen2.5 (포트 11434) → "안녕하세요! 무엇을 도와드릴까요?"
        └→ [TTS] ElevenLabs → Audio MP3
        ↓
[Bot] Discord Voice 재생
        ↓
[사용자가 AI 응답 듣기]
```

## ⚡ 1분 빠른 시작

### 1. 환경변수 설정

`.env` 파일에 추가:
```bash
# Gateway URL
GATEWAY_URL=http://localhost:8001

# ElevenLabs API (TTS)
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM  # Rachel (기본)

# 기존 설정 유지
DISCORD_TOKEN=...
WORKER_SHARED_SECRET=...
```

### 2. 서비스 시작

```bash
# 음성 시스템 전체 시작
docker-compose -f docker-compose.voice.yml up -d

# 로그 확인
docker-compose -f docker-compose.voice.yml logs -f
```

### 3. Discord에서 테스트

```
1. /join          # 음성 채널 참여
2. /record        # 녹음 시작
3. (말하기)       # "안녕 리브라"
4. /stop          # 녹음 중지
   
→ AI가 음성으로 응답!
```

## 📊 서비스 포트

| 서비스 | 포트 | 용도 |
|--------|------|------|
| Gateway | 8001 | 오케스트레이션 |
| ASR | 5005 | 음성→텍스트 |
| Ollama | 11434 | LLM |
| Bot | - | Discord Gateway |

## 🔍 헬스체크

```bash
# Gateway
curl http://localhost:8001/api/health

# ASR
curl http://localhost:5005/health

# Ollama
curl http://localhost:11434/api/tags
```

## 🧪 API 테스트

### 1. ASR만 테스트 (음성→텍스트)

```bash
curl -X POST http://localhost:8001/api/voice/stt \
  -F "file=@test_audio.wav"
```

### 2. TTS만 테스트 (텍스트→음성)

```bash
curl -X POST http://localhost:8001/api/voice/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"안녕하세요, 리브라입니다"}' \
  --output response.mp3
```

### 3. 전체 파이프라인 (음성→음성)

```bash
curl -X POST http://localhost:8001/api/voice/process \
  -F "file=@test_audio.wav" \
  --output ai_response.mp3
```

## 🎬 사용 시나리오

### 시나리오 1: 질문-응답

```
사용자: "오늘 날씨 어때?"
       ↓ (ASR)
텍스트: "오늘 날씨 어때?"
       ↓ (LLM)
AI:    "죄송합니다, 날씨 정보는 제공하지 않습니다. 다른 질문을 해주세요."
       ↓ (TTS)
음성:  (AI가 읽어줌)
```

### 시나리오 2: 대화

```
사용자: "안녕, 리브라"
AI:    "안녕하세요! 무엇을 도와드릴까요?"

사용자: "농담 하나 해줘"
AI:    "왜 개발자는 자연이 싫을까요? 버그가 많아서요!"
```

## ⚙️ 설정 튜닝

### 지연 감소 (속도 우선)

```yaml
# docker-compose.voice.yml
asr:
  environment:
    - MODEL_NAME=small        # medium → small
    - BEAM_SIZE=1             # 2 → 1

gateway:
  environment:
    - LLM_NUM_PREDICT=40      # 60 → 40
```

**효과**: E2FT 1.25-2.2s → 0.8-1.5s

### 정확도 향상

```yaml
asr:
  environment:
    - MODEL_NAME=medium       # 유지
    - BEAM_SIZE=3             # 2 → 3
```

**효과**: 정확도 +5%, 지연 +0.3s

## 🐛 문제 해결

### GPU 미인식

```bash
# NVIDIA Docker 확인
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

### ASR 응답 없음

```bash
# 로그 확인
docker logs libra-asr

# 모델 다운로드 확인
docker exec -it libra-asr ls -lh /app/models
```

### TTS 실패 (ElevenLabs)

```bash
# API 키 확인
echo $ELEVENLABS_API_KEY

# 수동 테스트
curl https://api.elevenlabs.io/v1/voices \
  -H "xi-api-key: $ELEVENLABS_API_KEY"
```

### Discord Voice 연결 안됨

```bash
# Bot 권한 확인
# - Connect (음성 채널 참여)
# - Speak (음성 재생)
# - Use Voice Activity

# 로그 확인
docker logs libra-bot
```

## 📈 성능 측정

### E2FT (End-to-First-Token) 측정

```bash
# Gateway 로그에서 확인
docker logs libra-gateway | grep "파이프라인"
```

예상 결과:
```
ASR: 0.9-1.4s
LLM: 0.35-0.8s
TTS: 0.5-1.0s
────────────────
Total: 1.75-3.2s
```

## 🚀 다음 단계

### Phase 1 완료 ✅
- [x] ASR 서비스 (faster-whisper)
- [x] Gateway 오케스트레이션
- [x] Bot Voice 통합
- [x] TTS 통합 (ElevenLabs)

### Phase 2: 고급 기능
- [ ] 실시간 VAD 통합
- [ ] 스트리밍 응답 (중간 피드백)
- [ ] 다중 사용자 동시 처리
- [ ] 대화 컨텍스트 유지
- [ ] 감정 인식
- [ ] 화자 인식

### Phase 3: 최적화
- [ ] 레이턴시 < 1초
- [ ] 배치 처리
- [ ] 캐싱
- [ ] 메트릭 수집

## 💡 팁

1. **개발 중에는** ASR만 테스트
   ```bash
   docker-compose -f docker-compose.voice.yml up -d postgres redis asr
   ```

2. **ElevenLabs 무료 플랜** 제한 (월 10,000자)
   - 테스트는 짧은 문장으로
   - 프로덕션 전에 플랜 확인

3. **Ollama 모델 예열**
   ```bash
   # 첫 요청이 느리면
   curl http://localhost:11434/api/generate -d '{
     "model": "qwen2.5:7b-instruct",
     "prompt": "hi",
     "stream": false
   }'
   ```

## 🎉 성공 기준

✅ Discord에서 `/join` 성공
✅ `/record` → `/stop` 후 텍스트 변환됨
✅ AI가 음성으로 응답
✅ 전체 응답 시간 < 3초
✅ 정확도 > 90%

