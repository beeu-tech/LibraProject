# 실시간 음성 대화 시스템 구현 가이드

## 🚀 빠른 시작

### 사전 요구사항

1. **NVIDIA GPU 드라이버 & CUDA**
   ```bash
   # NVIDIA 드라이버 버전 확인
   nvidia-smi
   
   # CUDA 버전 확인 (12.x 권장)
   nvcc --version
   ```

2. **Docker & NVIDIA Container Toolkit**
   ```bash
   # Docker 버전
   docker --version
   
   # GPU 테스트
   docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
   ```

3. **Ollama 설치 및 모델 다운로드**
   ```bash
   # qwen2.5 모델 다운로드
   ollama pull qwen2.5:7b-instruct
   
   # 모델 확인
   ollama list
   ```

### 1단계: 환경 설정

```bash
# 저장소 클론 (이미 완료)
cd D:\CursorSpace\DiscordBeeuBot

# .env 파일 설정
# DISCORD_TOKEN, WORKER_SHARED_SECRET 등 설정
```

### 2단계: faster-whisper 모델 다운로드 (자동)

첫 실행 시 자동으로 다운로드됩니다:
- `medium` 모델: ~1.5GB
- 저장 위치: `/app/models` (컨테이너 내부)

수동 다운로드 (선택사항):
```bash
# Python 환경에서
pip install faster-whisper
python -c "from faster_whisper import WhisperModel; WhisperModel('medium')"
```

### 3단계: 서비스 시작

```bash
# 음성 시스템 전체 시작
docker-compose -f docker-compose.voice.yml up -d

# 로그 확인
docker-compose -f docker-compose.voice.yml logs -f
```

### 4단계: 헬스체크

```bash
# ASR 서비스
curl http://localhost:5005/health

# Ollama
curl http://localhost:11434/api/tags

# Gateway
curl http://localhost:8001/health
```

## 📊 성능 테스트

### ASR 테스트

```bash
# 테스트 오디오 파일 준비 (WAV, 16kHz, mono)
# test_audio.wav

# 동기 변환 테스트
curl -X POST http://localhost:5005/transcribe \
  -F "audio_file=@test_audio.wav" \
  -F "language=ko"

# 스트리밍 변환 테스트
curl -X POST http://localhost:5005/transcribe-stream \
  -F "audio_file=@test_audio.wav" \
  -F "language=ko"
```

### LLM 테스트

```bash
# Ollama 직접 테스트
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:7b-instruct",
  "prompt": "안녕하세요",
  "stream": true
}'
```

### E2E 테스트

Discord에서:
```
1. /join - 음성 채널 참여
2. /record - 녹음 시작
3. (말하기)
4. /stop - 녹음 중지 및 변환
```

## 🔧 최적화 가이드

### 지연 감소 (정확도 trade-off)

```yaml
# docker-compose.voice.yml 수정
asr:
  environment:
    - MODEL_NAME=small              # medium → small
    - BEAM_SIZE=1                   # 2 → 1
    - WINDOW_S=0.9                  # 1.0 → 0.9

gateway:
  environment:
    - LLM_NUM_PREDICT=40            # 60 → 40
```

**예상 효과**:
- E2FT: 1.25-2.2s → 0.8-1.5s
- 정확도: 90-95% → 85-90%
- VRAM: 6-8GB → 4-5GB

### 정확도 향상 (지연 trade-off)

```yaml
asr:
  environment:
    - MODEL_NAME=large-v3           # medium → large-v3
    - COMPUTE_TYPE=float16          # int8_float16 → float16
    - BEAM_SIZE=3                   # 2 → 3
```

**예상 효과**:
- E2FT: 1.25-2.2s → 2-3s
- 정확도: 90-95% → 95-98%
- VRAM: 6-8GB → 10-12GB (⚠️ RTX 2070 16GB 한계 근접)

### 메모리 절약

```yaml
llm:
  environment:
    - OLLAMA_MAX_LOADED_MODELS=1   # 1개만 로드
    - OLLAMA_NUM_PARALLEL=1        # 동시 요청 1개

gateway:
  environment:
    - MAX_CONTEXT_TURNS=4          # 6 → 4 (컨텍스트 줄임)
```

## 🐛 문제 해결

### GPU 미인식

```bash
# NVIDIA Container Toolkit 확인
docker run --rm --gpus all ubuntu nvidia-smi

# 실패 시 재설치
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update
sudo apt-get install -y nvidia-docker2
sudo systemctl restart docker
```

### ASR 초기화 느림

**원인**: 모델 다운로드 (첫 실행)

**해결**:
```bash
# 모델 사전 다운로드 (컨테이너 내부)
docker exec -it libra-asr python -c "
from faster_whisper import WhisperModel
WhisperModel('medium', device='cuda', compute_type='int8_float16')
"
```

### 음성 끊김/중복

**증상**: ASR 결과가 중복되거나 끊김

**해결**:
```yaml
asr:
  environment:
    - WINDOW_OVERLAP_MS=200        # 120 → 200 (오버랩 증가)
    - NO_SPEECH_THRESHOLD=0.5      # 0.6 → 0.5 (임계값 낮춤)
```

### LLM 첫 토큰 느림

**원인**: 프롬프트가 너무 김, 컨텍스트 과다

**해결**:
```yaml
gateway:
  environment:
    - MAX_CONTEXT_TURNS=4          # 6 → 4
    - LLM_NUM_PREDICT=40           # 60 → 40
```

### VRAM 부족

**증상**: CUDA out of memory

**해결 방법**:

1. **ASR 모델 다운그레이드**
   ```yaml
   MODEL_NAME=small               # medium → small
   ```

2. **Compute Type 변경**
   ```yaml
   COMPUTE_TYPE=int8              # int8_float16 → int8
   ```

3. **서비스 분리 실행**
   ```bash
   # ASR만 GPU 사용
   docker-compose -f docker-compose.voice.yml up -d asr postgres redis
   
   # Ollama는 CPU 모드로
   OLLAMA_DISABLE_GPU=1 ollama serve
   ```

### WSL 메모리 부족 (Windows)

```ini
# C:\Users\<사용자>\.wslconfig
[wsl2]
memory=12GB
swap=8GB
localhostForwarding=true
```

재시작:
```powershell
wsl --shutdown
```

## 📈 모니터링

### GPU 사용률

```bash
# 실시간 모니터링
watch -n 1 nvidia-smi

# 메모리 추적
nvidia-smi --query-gpu=memory.used,memory.free,memory.total --format=csv --loop=1
```

### 컨테이너 리소스

```bash
# CPU/메모리 사용률
docker stats libra-asr libra-ollama libra-gateway
```

### 레이턴시 측정

```bash
# ASR 레이턴시 (컨테이너 로그)
docker logs libra-asr | grep "변환 완료"

# E2FT 측정 (Gateway 로그)
docker logs libra-gateway | grep "E2FT"
```

## 🔄 다음 단계

### Phase 1 완료 체크리스트

- [ ] ASR 서비스 빌드 및 시작
- [ ] Ollama 모델 다운로드 (`qwen2.5:7b-instruct`)
- [ ] GPU 인식 확인
- [ ] 헬스체크 성공
- [ ] 테스트 오디오로 변환 성공
- [ ] 레이턴시 측정 (< 2초)

### Phase 2: Gateway 구현

- [ ] Discord Voice 수신 파이프라인
- [ ] VAD 기반 청크 분할
- [ ] ASR 스트리밍 호출
- [ ] LLM 연동
- [ ] TTS 통합
- [ ] Discord Voice 송신

### Phase 3: 프로덕션 준비

- [ ] 에러 핸들링 강화
- [ ] 재시도 로직
- [ ] 메트릭 수집
- [ ] 로깅 최적화
- [ ] 보안 강화
- [ ] 부하 테스트

## 📚 참고 자료

- [faster-whisper GitHub](https://github.com/SYSTRAN/faster-whisper)
- [Silero VAD](https://github.com/snakers4/silero-vad)
- [Ollama Documentation](https://ollama.ai/docs)
- [Discord.js Voice](https://discordjs.guide/voice/)

## 🎯 성능 벤치마크 (RTX 2070)

### 실측 데이터 (예상)

| 구성 | ASR | TTFT | E2FT | 정확도 | VRAM |
|------|-----|------|------|--------|------|
| small+int8 | 0.5-0.9s | 0.3-0.6s | 0.8-1.5s | 85% | 4GB |
| **medium+int8_float16** | **0.9-1.4s** | **0.35-0.8s** | **1.25-2.2s** | **90-95%** | **6-8GB** |
| large-v3+float16 | 1.5-2.5s | 0.35-0.8s | 2-3.5s | 95-98% | 10-12GB |

**권장 설정**: medium + int8_float16 (밸런스 최적)

