# 🔒 리브라 봇 보안 가이드

## 🚨 보안 리스크 해결

### 1. 환경변수 보안 강화

#### ❌ 기존 문제점
```python
# 위험: 하드코딩된 기본값
raw_url = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
```

#### ✅ 개선된 방식
```python
# 안전: fail-fast 방식
raw_url = os.getenv("DATABASE_URL")
if not raw_url:
    raise RuntimeError("DATABASE_URL is not set - fail-fast for security")
```

### 2. URL 검증 및 변환

#### ❌ 기존 문제점
```python
# 위험: 무차별 치환
database_url = raw_url.replace("postgresql://", "postgresql+asyncpg://")
```

#### ✅ 개선된 방식
```python
# 안전: 파싱 후 검증
def _build_asyncpg_url(raw_url: str, force_ssl: bool = True) -> str:
    p = urlparse(raw_url)
    if p.scheme not in ("postgresql", "postgresql+asyncpg"):
        raise ValueError("unsupported scheme")
    
    # 호스트 화이트리스트 검사
    allow_hosts = os.getenv("ALLOWED_DB_HOSTS", "").split(",")
    if allow_hosts and (p.hostname not in allow_hosts):
        raise ValueError(f"db host not allowed: {p.hostname}")
    
    # TLS 강제
    if force_ssl and "sslmode=" not in query:
        query = (query + "&" if query else "") + "sslmode=require"
```

### 3. 로그 레드액션

#### ❌ 기존 문제점
```python
# 위험: 비밀값 노출
logger.error("DB 연결 실패", url=database_url)
```

#### ✅ 개선된 방식
```python
# 안전: 비밀값 제거
def _redact_db_url(url: str) -> str:
    p = urlparse(url)
    netloc = p.hostname or ''
    if p.port:
        netloc += f":{p.port}"
    redacted = p._replace(netloc=netloc, username=None, password=None)
    return urlunparse(redacted)

logger.info("DB connecting", url=_redact_db_url(database_url))
```

### 4. 스키마 타입 일치

#### ❌ 기존 문제점
```sql
-- 위험: 타입 불일치
users.id SERIAL PRIMARY KEY,           -- INTEGER
messages.user_id VARCHAR(255) NOT NULL -- VARCHAR(255)
```

#### ✅ 개선된 방식
```sql
-- 안전: 타입 일치
users.id SERIAL PRIMARY KEY,                    -- INTEGER
messages.user_id INTEGER NOT NULL REFERENCES users(id) -- INTEGER
```

## 🔐 Docker Secrets 사용법

### 1. Secrets 생성
```bash
# 자동 생성 스크립트 실행
./scripts/createSecrets.sh

# 또는 수동 생성
mkdir -p secrets
echo "your_actual_token" > secrets/discord_token.txt
chmod 600 secrets/*.txt
```

### 2. 보안 배포
```bash
# Docker Secrets 사용
docker-compose -f docker-compose.yml -f docker-compose.secrets.yml up -d
```

### 3. 환경변수 vs Secrets 비교

| 방식 | 보안 수준 | 사용 사례 |
|------|-----------|-----------|
| 환경변수 | ⭐⭐ | 로컬 개발, 테스트 |
| Docker Secrets | ⭐⭐⭐⭐ | 프로덕션, 스테이징 |
| 클라우드 Secrets Manager | ⭐⭐⭐⭐⭐ | 엔터프라이즈 |

## 🛡️ 추가 보안 권장사항

### 1. 네트워크 보안
```yaml
# docker-compose.yml
services:
  postgres:
    networks:
      - internal
    # 외부 포트 노출 제거 (개발 시에만)
    # ports:
    #   - "5432:5432"

networks:
  internal:
    driver: bridge
    internal: true
```

### 2. 최소권한 사용자
```sql
-- 전용 사용자 생성
CREATE USER libra_reader WITH PASSWORD 'secure_password';
CREATE USER libra_writer WITH PASSWORD 'secure_password';

-- 읽기 전용 권한
GRANT SELECT ON ALL TABLES IN SCHEMA public TO libra_reader;

-- 쓰기 권한
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO libra_writer;
```

### 3. 방화벽 설정
```bash
# PostgreSQL 포트 제한
ufw allow from 10.0.0.0/8 to any port 5432
ufw deny 5432
```

### 4. SSL/TLS 강제
```bash
# 환경변수 설정
DB_SSL_REQUIRE=1
ALLOWED_DB_HOSTS=postgres,db.example.com
```

## 🔍 보안 모니터링

### 1. 로그 모니터링
```bash
# 의심스러운 접근 시도 감지
docker-compose logs | grep -i "unauthorized\|failed\|error"

# 비밀값 노출 검사
docker-compose logs | grep -E "(password|token|key).*="
```

### 2. 접근 로그
```python
# 구조화된 보안 로그
logger.warn("Unauthorized access attempt", 
           ip=request.remote_addr,
           user_agent=request.headers.get('User-Agent'),
           timestamp=datetime.utcnow().isoformat())
```

### 3. 정기 보안 점검
- [ ] 비밀값 로테이션 (월 1회)
- [ ] 접근 로그 검토 (주 1회)
- [ ] 의존성 보안 업데이트 (월 1회)
- [ ] 네트워크 보안 설정 검토 (분기 1회)

## 🚨 보안 사고 대응

### 1. 비밀값 노출 시
```bash
# 1. 즉시 서비스 중단
docker-compose down

# 2. 비밀값 재생성
./scripts/createSecrets.sh

# 3. 로그 검토
docker-compose logs | grep -i "error\|unauthorized"

# 4. 서비스 재시작
docker-compose up -d
```

### 2. 데이터베이스 침해 시
```bash
# 1. 네트워크 격리
docker network disconnect libra-bot_internal postgres

# 2. 백업에서 복구
docker-compose exec postgres pg_restore -d libra_bot backup.sql

# 3. 보안 패치 적용
docker-compose pull
docker-compose up -d
```

## 📋 보안 체크리스트

### 배포 전 확인사항
- [ ] 모든 비밀값이 Docker Secrets로 관리됨
- [ ] 데이터베이스 연결이 TLS로 암호화됨
- [ ] 호스트 화이트리스트가 설정됨
- [ ] 로그에 비밀값이 노출되지 않음
- [ ] 최소권한 사용자가 설정됨
- [ ] 네트워크 접근이 제한됨

### 운영 중 모니터링
- [ ] 정기적인 로그 검토
- [ ] 비밀값 로테이션
- [ ] 보안 업데이트 적용
- [ ] 접근 패턴 분석
- [ ] 이상 행동 감지

---

**보안은 한 번에 완성되는 것이 아니라 지속적인 과정입니다. 정기적인 점검과 업데이트를 통해 안전한 서비스를 유지하세요.**
