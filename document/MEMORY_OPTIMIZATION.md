# 💾 메모리 최적화 가이드

**RTX 2070 8GB 환경에서 메모리 사용량 최소화**

---

## 📊 메모리 사용량 비교

| 구성 | VRAM 사용량 | 다운로드 크기 | 성능 | 추천 |
|------|------------|--------------|------|------|
| **듀얼 모델** (3B + 7B) | 7-8GB | ~6GB | ⭐⭐⭐⭐⭐ | 메모리 충분 시 |
| **단일 모델** (3B) | 3-4GB | ~2GB | ⭐⭐⭐⭐ | **메모리 절약** ⭐ |
| **초경량** (1.5B) | 2-3GB | ~1GB | ⭐⭐⭐ | 최소 사양 |

---

## 🎯 메모리 절약 전략

### 전략 1: 단일 모델 모드 (권장)

```yaml
# docker-compose.vllm-lite.yml 사용
# 3B 모델만 실행, VRAM 3-4GB 사용

docker-compose -f docker-compose.vllm-lite.yml up -d
```

**장점:**
- ✅ VRAM 사용량 50% 감소 (8GB → 4GB)
- ✅ 다운로드 크기 66% 감소 (6GB → 2GB)
- ✅ 시스템 안정성 향상
- ✅ 응답 속도 0.3-0.4초 (여전히 빠름)

**단점:**
- ⚠️ 복잡한 질문도 3B 모델 사용 (품질 약간 저하)

---

### 전략 2: GPU 메모리 할당 축소

```yaml
# docker-compose.vllm.yml 수정
environment:
  - GPU_MEMORY_UTILIZATION=0.50  # 0.85 → 0.50
  - MAX_MODEL_LEN=1024  # 2048 → 1024
  - MAX_NUM_BATCHED_TOKENS=2048  # 4096 → 2048
```

**효과:**
- VRAM 사용량: 7GB → 5GB (-28%)
- 컨텍스트 길이 감소 (1024 토큰)

---

### 전략 3: 더 작은 모델 사용

```yaml
# 1.5B 초경량 모델
environment:
  - MODEL=Qwen/Qwen2.5-1.5B-Instruct-GPTQ-Int4
  - GPU_MEMORY_UTILIZATION=0.40
```

**효과:**
- VRAM: 2-3GB만 사용
- 다운로드: ~1GB
- 속도: 0.1-0.2초 (매우 빠름)
- 품질: 일상 대화 충분, 전문 질문은 약함

---

### 전략 4: 2-bit 양자화 (극한 최적화)

```yaml
# Int2 양자화 (메모리 절반)
environment:
  - MODEL=Qwen/Qwen2.5-7B-Instruct-GPTQ-Int2
  - GPU_MEMORY_UTILIZATION=0.60
```

**효과:**
- VRAM: 7B 모델을 4GB에서 실행
- 품질: 약간 저하 (10-15%)
- 속도: 20-30% 향상

---

## 🚀 즉시 적용: 단일 모델 모드

### Step 1: 환경변수 설정

```bash
# .env 파일 수정
VLLM_MODE=single
VLLM_URL=http://vllm:8000/v1
```

### Step 2: 단일 모델 실행

```bash
# 기존 서비스 정리
docker-compose -f docker-compose.vllm.yml down

# 단일 모델 시작 (메모리 절약형)
docker-compose -f docker-compose.vllm-lite.yml up -d

# 로그 확인
docker-compose -f docker-compose.vllm-lite.yml logs -f
```

**다운로드 시간:**
- 3B 모델: ~2GB, 2-3분 소요
- **총 시간: 5분 이내** ✅

### Step 3: AI Worker 재시작

```bash
docker-compose restart ai-worker

# 로그 확인
docker-compose logs -f ai-worker
```

**성공 메시지:**
```
🚀 vLLM 단일 모델 모드 (메모리 최적화)
✅ vLLM 모델 준비 완료
```

---

## 📊 성능 비교

### 듀얼 모델 (3B + 7B)
```
메모리: 7-8GB VRAM
속도:  0.26초 (평균)
품질:  ⭐⭐⭐⭐⭐
```

### 단일 모델 (3B) ⭐ 권장
```
메모리: 3-4GB VRAM  (50% 절약)
속도:  0.35초 (평균)
품질:  ⭐⭐⭐⭐
```

### 초경량 모델 (1.5B)
```
메모리: 2-3GB VRAM  (70% 절약)
속도:  0.2초 (평균)
품질:  ⭐⭐⭐
```

---

## 🔧 추가 최적화 팁

### 1. Docker 메모리 제한

```yaml
# docker-compose.vllm-lite.yml
deploy:
  resources:
    limits:
      memory: 12G  # 시스템 RAM 제한
```

### 2. 스왑 공간 활용

```yaml
environment:
  - SWAP_SPACE=4  # 4GB 스왑 (시스템 RAM 사용)
shm_size: 4g      # 공유 메모리
```

### 3. 불필요한 서비스 중지

```bash
# Grafana, Prometheus 중지 (개발 시)
docker-compose stop grafana prometheus
```

**절약:**
- Grafana: ~500MB RAM
- Prometheus: ~300MB RAM

---

## 💾 메모리 모니터링

### GPU 메모리 확인

```bash
# 실시간 모니터링
watch -n 1 nvidia-smi

# 또는 PowerShell
while($true) { nvidia-smi; Start-Sleep -Seconds 1 }
```

### Docker 메모리 확인

```bash
# 컨테이너별 메모리 사용량
docker stats

# vLLM 컨테이너만 확인
docker stats libra-vllm
```

---

## 🎯 권장 구성

### RTX 2070 8GB 사용자 (일반)

```bash
# 단일 모델 (3B) - 안정적
VLLM_MODE=single
docker-compose -f docker-compose.vllm-lite.yml up -d
```

**예상 결과:**
- VRAM: 3-4GB 사용 (여유 4GB)
- 속도: 0.35초
- 안정성: ⭐⭐⭐⭐⭐

### RTX 2070 8GB 사용자 (최대 성능)

```bash
# 듀얼 모델 (3B + 7B) - 공격적
VLLM_MODE=dual
docker-compose -f docker-compose.vllm.yml up -d
```

**예상 결과:**
- VRAM: 7-8GB 사용 (여유 0-1GB)
- 속도: 0.26초
- 안정성: ⭐⭐⭐ (tight)

### 메모리 부족 시

```bash
# 초경량 모델 (1.5B)
MODEL=Qwen/Qwen2.5-1.5B-Instruct-GPTQ-Int4
GPU_MEMORY_UTILIZATION=0.40
```

**예상 결과:**
- VRAM: 2-3GB 사용 (여유 5GB)
- 속도: 0.2초 (매우 빠름)
- 품질: 일상 대화 충분

---

## ❓ FAQ

### Q: 듀얼 vs 단일, 어떤 걸 써야 하나요?

**A:** 
- 메모리 충분 → 듀얼 (최고 품질)
- 메모리 부족 또는 안정성 중시 → **단일 (권장)**
- 최소 사양 → 초경량 (1.5B)

### Q: 메모리 부족 에러가 나요

**A:**
```bash
# 1. GPU 메모리 할당 축소
GPU_MEMORY_UTILIZATION=0.50

# 2. 컨텍스트 길이 축소
MAX_MODEL_LEN=1024

# 3. 더 작은 모델 사용
MODEL=Qwen/Qwen2.5-1.5B-Instruct-GPTQ-Int4
```

### Q: 품질이 너무 떨어져요

**A:**
- 3B 모델: 일상 대화 충분
- 전문적인 질문: Ollama 병행 사용
- 또는 듀얼 모델로 전환

---

**💡 TIP:** 단일 모델 (3B)로 시작하고, 메모리 여유가 있으면 듀얼로 업그레이드하세요!

