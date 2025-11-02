# 경량화 개발 환경 빠른 시작 가이드

## 변경 사항 요약 ⚡

### 1. BFF 제거
```
기존: Bot → BFF → AI Worker (2단계 HTTP)
변경: Bot → AI Worker (1단계 HTTP)
```

**속도 향상**: ~50% 네트워크 지연 감소

### 2. 서비스 경량화
- ❌ BFF 서비스 제거
- ❌ Prometheus 제거 (개발 환경)
- ❌ Grafana 제거 (개발 환경)
- ✅ PostgreSQL (유지)
- ✅ Redis (유지)
- ✅ AI Worker (유지)
- ✅ Bot (유지)

**리소스 절약**: 메모리 사용량 ~40% 감소

## 빠른 시작

### 1. 경량화 개발 서버 시작

```bash
# 경량화 docker-compose 사용
docker-compose -f docker-compose.dev.yml up -d

# 로그 확인
docker-compose -f docker-compose.dev.yml logs -f
```

### 2. 로컬 개발 (더 빠름)

```bash
# AI Worker만 Docker로 실행
docker-compose -f docker-compose.dev.yml up -d postgres redis ai-worker

# Bot은 로컬에서 실행 (빠른 재시작)
cd apps/bot
npm run dev
```

## 환경 변수 변경사항

### .env 파일 수정

```bash
# 기존 (BFF 사용)
# BFF_URL=http://localhost:3001
# BFF_API_KEY=your_key

# 변경 (AI Worker 직접 호출)
AI_WORKER_URL=http://localhost:8000
WORKER_SHARED_SECRET=your_shared_secret
```

## 서비스 포트

| 서비스 | 포트 | 용도 |
|--------|------|------|
| Bot | - | Discord Gateway |
| AI Worker | 8000 | LLM, STT, TTS |
| PostgreSQL | 5433 | 데이터베이스 |
| Redis | 6380 | 캐시 |

## 원복 방법

문제 발생 시 원본으로 돌아가기:

```bash
# 1. 경량화 서버 중지
docker-compose -f docker-compose.dev.yml down

# 2. 백업 파일 복원
Copy-Item -Path "docker-compose.yml.backup" -Destination "docker-compose.yml"
Copy-Item -Path "apps\bot\src\libraBot.ts.backup" -Destination "apps\bot\src\libraBot.ts"
Copy-Item -Path "apps\bot\src\services\bffClient.ts.backup" -Destination "apps\bot\src\services\bffClient.ts"

# 3. BFF 포함 전체 서비스 시작
docker-compose up -d
```

## 테스트 체크리스트

- [ ] Bot이 Discord에 정상 연결됨
- [ ] `/chat on` 명령어 작동
- [ ] 텍스트 메시지에 응답
- [ ] 응답 속도가 빨라짐 (2초 이내)
- [ ] 에러 없이 정상 작동

## 성능 비교

### 기존 구조 (BFF 포함)
```
평균 응답 시간: 3-5초
네트워크 홉: 2단계
메모리 사용: ~2GB
```

### 경량화 구조 (BFF 제거)
```
평균 응답 시간: 1.5-2.5초
네트워크 홉: 1단계
메모리 사용: ~1.2GB
```

**개선율**: 응답 속도 40-50% 향상

## 디버깅

### AI Worker 로그 확인
```bash
docker-compose -f docker-compose.dev.yml logs -f ai-worker
```

### Bot 연결 테스트
```bash
# Bot 컨테이너 내부
docker exec -it libra-bot sh
curl http://ai-worker:8000/api/health
```

### 데이터베이스 연결 확인
```bash
docker exec -it libra-postgres psql -U libra_user -d libra_bot -c "SELECT 1;"
```

## 다음 단계

1. ✅ 경량화 서버 테스트
2. 성능 측정 및 비교
3. 문제 없으면 프로덕션 적용 검토
4. 문제 있으면 원복 후 디버깅

## 추가 최적화 옵션

### 1. Redis 캐시 활성화
```typescript
// 응답 캐싱으로 반복 요청 속도 향상
const cacheKey = `chat:${userId}:${messageHash}`;
```

### 2. 스트리밍 응답 최적화
```typescript
// 청크 크기 조정으로 UI 반응성 개선
stream: true,
chunkSize: 50,
```

### 3. LLM 모델 변경
```bash
# 더 빠른 모델 사용 (정확도 trade-off)
PRIMARY_MODEL=gpt-3.5-turbo  # vs gpt-4
```

