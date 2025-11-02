# 🚀 운영 배포 체크리스트

## ⚠️ 치명적 보안 문제 해결 완료

### ✅ 수정된 보안 이슈들

1. **BFF 인증 강화**
   - ❌ `'default'` 토큰 허용 → ✅ 운영에서 차단
   - ✅ `BFF_API_KEY` 필수 설정 (fail-fast)

2. **공유 비밀 필수화**
   - ❌ `'change_me'` 기본값 → ✅ 필수 설정 (fail-fast)
   - ✅ BFF ↔ AI Worker 간 HMAC 서명 검증

3. **운영 DDL 비활성화**
   - ❌ 앱 기동 시 테이블 생성 → ✅ `ALLOW_DDL=0`로 제어
   - ✅ Alembic 마이그레이션 권장

4. **모니터링 개선**
   - ✅ `/metrics` 엔드포인트 노출
   - ✅ Prometheus 설정 수정 (exporter 없이 직접 스크랩)

5. **로깅 개선**
   - ✅ 운영 환경에서 JSON 로그 출력
   - ✅ 개발 환경에서만 pretty 로그

## 🔐 운영 배포 전 필수 확인사항

### 1. 비밀값 관리
```bash
# ✅ .env 파일 삭제 (레포에서 완전 제거)
rm .env
git rm .env

# ✅ 모든 토큰/비밀 회수 및 재생성
# Discord Bot Token 재생성
# API 키들 재생성
# 데이터베이스 비밀번호 변경
```

### 2. Docker Secrets 설정
```bash
# ✅ Secrets 생성
./scripts/createSecrets.sh

# ✅ 실제 값으로 수정
echo "your_actual_discord_token" > secrets/discord_token.txt
echo "your_actual_bff_api_key" > secrets/bff_api_key.txt
echo "your_actual_worker_secret" > secrets/worker_shared_secret.txt
# ... 기타 비밀값들

# ✅ 파일 권한 설정
chmod 600 secrets/*.txt
```

### 3. 환경변수 설정
```bash
# ✅ 필수 환경변수 확인
BFF_API_KEY=strong_random_key_here
WORKER_SHARED_SECRET=strong_random_secret_here
DATABASE_URL=postgresql://user:pass@postgres:5432/libra_bot
DB_SSL_REQUIRE=1
ALLOW_DDL=0
NODE_ENV=production
```

### 4. 네트워크 보안
```bash
# ✅ 운영에서는 외부 포트 노출 금지
# docker-compose.prod.yml 사용
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 🚀 운영 배포 명령어

### 개발 환경 (로컬 테스트)
```bash
# 개발용 (DDL 허용, SSL 비활성화)
ALLOW_DDL=1 DB_SSL_REQUIRE=0 NODE_ENV=development docker-compose up -d
```

### 운영 환경 (보안 강화)
```bash
# 운영용 (DDL 금지, SSL 강제, Secrets 사용)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 📊 모니터링 확인

### 1. 헬스체크
```bash
# BFF 상태 확인
curl http://localhost:3001/health

# AI Worker 상태 확인
curl http://localhost:8000/api/health

# 메트릭 확인
curl http://localhost:3001/metrics
curl http://localhost:8000/metrics
```

### 2. Prometheus 확인
```bash
# Prometheus UI 접속
http://localhost:9090

# 타겟 상태 확인
# Status → Targets
```

### 3. Grafana 확인
```bash
# Grafana UI 접속
http://localhost:3000
# admin / (secrets/grafana_password.txt 내용)
```

## 🔍 보안 검증

### 1. 인증 테스트
```bash
# ❌ 잘못된 토큰으로 요청 (401 응답 확인)
curl -H "Authorization: Bearer wrong_token" http://localhost:3001/api/chat/completions

# ✅ 올바른 토큰으로 요청 (200 응답 확인)
curl -H "Authorization: Bearer your_bff_api_key" http://localhost:3001/api/chat/completions
```

### 2. 서명 검증 테스트
```bash
# ❌ 서명 없이 AI Worker 요청 (401 응답 확인)
curl http://localhost:8000/api/chat/completions

# ✅ 올바른 서명으로 요청 (정상 응답 확인)
# (BFF를 통해서만 접근 가능)
```

### 3. DDL 비활성화 확인
```bash
# 로그에서 DDL 스킵 메시지 확인
docker-compose logs ai-worker | grep "DDL skipped"
```

## 🚨 비상 대응

### 1. 서비스 중단
```bash
# 즉시 모든 서비스 중단
docker-compose down

# 특정 서비스만 중단
docker-compose stop bot
```

### 2. 로그 확인
```bash
# 전체 로그 확인
docker-compose logs -f

# 특정 서비스 로그
docker-compose logs -f bot
docker-compose logs -f bff
docker-compose logs -f ai-worker
```

### 3. 비밀값 재생성
```bash
# 비밀값 재생성
./scripts/createSecrets.sh

# 서비스 재시작
docker-compose up -d
```

## 📋 정기 점검 항목

### 일일 점검
- [ ] 서비스 상태 확인 (헬스체크)
- [ ] 에러 로그 검토
- [ ] 응답 시간 모니터링

### 주간 점검
- [ ] 보안 로그 검토
- [ ] 성능 메트릭 분석
- [ ] 의존성 업데이트 확인

### 월간 점검
- [ ] 비밀값 로테이션
- [ ] 보안 패치 적용
- [ ] 백업 상태 확인

## 🎯 성공 기준

### 보안
- ✅ 모든 API 요청이 인증됨
- ✅ 비밀값이 로그에 노출되지 않음
- ✅ 네트워크 접근이 제한됨

### 성능
- ✅ 응답 시간 < 3초 (p95)
- ✅ 에러율 < 1%
- ✅ 가용성 > 99.9%

### 모니터링
- ✅ 모든 메트릭이 수집됨
- ✅ 알림이 정상 작동함
- ✅ 대시보드가 실시간 업데이트됨

---

**모든 체크리스트를 완료하면 안전한 운영 환경이 구축됩니다! 🎉**
