# 실시간 음성 대화 시스템 아키텍처

## 시스템 구성

```
[Discord Voice] → [Bot Gateway] → [ASR Service] → [LLM Service] → [TTS] → [Discord Voice]
                       ↓              (faster-whisper)   (Ollama Qwen2.5)
                   [Redis Cache]
```

## 서비스 구성

### 1. ASR Service (faster-whisper)
**역할**: 음성 → 텍스트 변환 (실시간 스트리밍)

**기술 스택**:
- Engine: `faster-whisper` (CTranslate2 최적화)
- Model: `medium` (정확도/속도 밸런스)
- Compute: `int8_float16` (RTX 2070 최적화)
- VAD: `Silero VAD` (음성 구간 감지)
- Runtime: Python 3.11 + CUDA 12.x

**컨테이너 환경변수**:
```yaml
MODEL_NAME: medium
COMPUTE_TYPE: int8_float16
DEVICE: cuda
BEAM_SIZE: 2
LANG_HINT: ko                    # 한국어 우선
VAD: silero
VAD_FRAME_MS: 30
WINDOW_S: 1.0                    # 1초 윈도우
WINDOW_OVERLAP_MS: 120          # 120ms 오버랩
NO_SPEECH_THRESHOLD: 0.6
CONDITION_ON_PREV: true          # 이전 컨텍스트 활용
PARTIAL_FLUSH_MS: 250           # 부분 결과 250ms 간격
FINAL_FLUSH_SILENCE_MS: 350     # 최종 무음 350ms에서 확정
```

**API 엔드포인트**:
- `POST /transcribe` - 실시간 스트리밍 변환
- `POST /transcribe-sync` - 동기 변환 (파일 업로드)
- `GET /health` - 헬스체크
- `GET /models` - 사용 가능 모델 목록

**성능 지표** (RTX 2070):
- 레이턴시: 0.9-1.4초 (VAD 0.8s + 추론 0.1-0.6s)
- VRAM 사용: ~2-3GB
- 정확도: ~90-95% (한국어)
- 동시 처리: 2-3 스트림

### 2. LLM Service (Ollama)
**역할**: 대화 생성 (스트리밍)

**모델 설정**:
```yaml
MODEL: qwen2.5:7b-instruct
NUM_PREDICT: 60                  # 초기 응답 최적화
TEMPERATURE: 0.6
CONTEXT_TURNS: 4-6               # 최근 4-6턴만 유지
STREAM: true                     # 스트리밍 응답
```

**성능 지표** (RTX 2070):
- TTFT: 0.35-0.8초 (First Token)
- TPS: 30-50 tokens/sec
- VRAM 사용: ~4-5GB
- 컨텍스트: 4096 tokens

### 3. Gateway Service (오케스트레이션)
**역할**: 음성 처리 파이프라인 조율

**처리 흐름**:
```
1. Discord Voice Input (PCM 16kHz mono)
   ↓
2. VAD (Silero) - 음성 구간 감지
   ↓
3. Buffering (250ms chunks)
   ↓
4. ASR Partial Results (실시간)
   ↓
5. Silence Detection (350ms)
   ↓
6. Final Transcription
   ↓
7. LLM Streaming Response
   ↓
8. TTS (선택적)
   ↓
9. Discord Voice Output
```

**환경변수**:
```yaml
PARTIAL_FLUSH_MS: 250
FINAL_FLUSH_SILENCE_MS: 350
ASR_URL: http://asr:5005
LLM_URL: http://llm:11434
REDIS_URL: redis://redis:6379
```

## 레이턴시 분석

### E2FT (End-to-First-Token): 1.25-2.2초
```
사용자 말 시작 → LLM 첫 토큰 출력

┌────────────────────────────────────────┐
│ VAD 감지: 0.8s                         │
│ ASR 추론: 0.1-0.6s                     │
│ LLM TTFT: 0.35-0.8s                    │
├────────────────────────────────────────┤
│ 총합: 1.25-2.2s                        │
└────────────────────────────────────────┘
```

### 콜드스타트: +1-3초
- 모델 로딩
- GPU 워밍업
- → **서비스 기동 시 예열 필수**

## Docker Compose 구성

### services:
1. **asr** (faster-whisper)
   - GPU 필요: `--gpus all`
   - 포트: 5005
   - VRAM: ~2-3GB

2. **llm** (Ollama)
   - GPU 필요: `--gpus all`
   - 포트: 11434
   - VRAM: ~4-5GB

3. **gateway** (오케스트레이션)
   - CPU만 사용
   - ASR/LLM 중개

4. **bot** (Discord Gateway)
   - 기존 유지
   - Gateway 호출

5. **redis** (캐시)
   - 기존 유지

6. **postgres** (DB)
   - 기존 유지

**총 GPU VRAM**: ~6-8GB (RTX 2070 16GB로 충분)

## 최적화 옵션

### 지연 감소 우선
```yaml
MODEL_NAME: small                # medium → small
BEAM_SIZE: 1                     # 2 → 1
WINDOW_S: 0.9                    # 1.0 → 0.9
NUM_PREDICT: 40                  # 60 → 40
```
→ E2FT: ~0.8-1.5초 (정확도 -5%)

### 정확도 우선
```yaml
MODEL_NAME: large-v3             # medium → large-v3
BEAM_SIZE: 3                     # 2 → 3
COMPUTE_TYPE: float16            # int8_float16 → float16
```
→ E2FT: ~2-3초 (정확도 +5-10%, VRAM +2GB)

### CPU-only 비상 모드
```yaml
DEVICE: cpu
MODEL_NAME: small
COMPUTE_TYPE: int8
```
→ E2FT: ~4-6초 (GPU 없이 작동)

## 문제 해결

### 음성 끊김/중복
```yaml
WINDOW_OVERLAP_MS: 80-200        # 조정
NO_SPEECH_THRESHOLD: 0.5-0.7     # 재조정
```

### 첫 토큰 느림
- LLM 프롬프트 축소 (시스템/히스토리 최소화)
- `num_predict` 60 이하로
- 예열 확인

### GPU 미활용
```bash
# 컨테이너 로그 확인
docker logs asr | grep -i cuda
docker logs llm | grep -i gpu
```

### WSL 메모리 부족
```ini
# .wslconfig
[wsl2]
memory=12GB
swap=8GB
```

## 성능 벤치마크 (RTX 2070 기준)

| 구성 | E2FT | 정확도 | VRAM |
|------|------|--------|------|
| small + int8 | 0.8-1.5s | 85% | 4GB |
| **medium + int8_float16** | **1.25-2.2s** | **90-95%** | **6-8GB** |
| large-v3 + float16 | 2-3s | 95-98% | 8-10GB |

## 구현 우선순위

1. ✅ **Phase 1**: ASR 서비스 구축 (faster-whisper)
2. ✅ **Phase 2**: LLM 통합 강화 (Ollama Qwen2.5)
3. 🔄 **Phase 3**: Gateway 오케스트레이션
4. 🔄 **Phase 4**: Discord Voice 통합
5. 🔄 **Phase 5**: TTS 통합 (ElevenLabs)
6. 🔄 **Phase 6**: 성능 튜닝 및 최적화

## 한 줄 결론

**"faster-whisper medium + int8_float16 + Silero VAD" + "Ollama Qwen2.5 7B(GPU)"**
조합이 RTX 2070 장비에서 **정확도·지연·다국어를 동시에 만족하는 베스트 밸런스**

