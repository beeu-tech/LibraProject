# 🚀 리브라 봇 빠른 시작 가이드

## 1단계: 환경 설정 (5분)

### Discord 봇 생성
1. [Discord Developer Portal](https://discord.com/developers/applications) 접속
2. "New Application" 클릭 → 이름 입력 (예: "Libra Bot")
3. "Bot" 섹션에서 "Add Bot" 클릭
4. Token 복사 (나중에 사용)
5. OAuth2 > URL Generator에서 권한 선택:
   - `Send Messages`
   - `Use Slash Commands`
   - `Connect` (음성용)
   - `Speak` (음성용)
   - `Use Voice Activity`

### 환경변수 설정
```bash
# .env 파일 생성
cp env.example .env

# .env 파일 편집 (최소 설정)
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DISCORD_GUILD_ID=your_test_guild_id_here

# AI 모델 (최소 하나)
OPENAI_API_KEY=your_openai_api_key_here
# 또는
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

## 2단계: Docker로 실행 (2분)

```bash
# 모든 서비스 시작
docker-compose up -d

# 로그 확인
docker-compose logs -f
```

## 3단계: 봇 테스트 (1분)

1. Discord 서버에 봇 초대
2. 봇을 멘션하거나 "리브라"라고 입력
3. AI 응답 확인

## 4단계: 모니터링 확인

- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9090
- **BFF API**: http://localhost:3001/health
- **AI Worker**: http://localhost:8000/api/health

## 🔧 문제 해결

### 봇이 응답하지 않음
```bash
# 봇 로그 확인
docker-compose logs bot

# BFF 상태 확인
curl http://localhost:3001/health

# AI Worker 상태 확인
curl http://localhost:8000/api/health
```

### 데이터베이스 연결 실패
```bash
# PostgreSQL 상태 확인
docker-compose logs postgres

# Redis 상태 확인
docker-compose logs redis
```

### AI 응답이 느림
- API 키 설정 확인
- 모델 설정 확인 (`DEFAULT_LLM_MODEL`)
- 네트워크 연결 상태 확인

## 📊 성능 모니터링

### 주요 메트릭
- 응답 시간 (목표: < 3초)
- 토큰 사용량
- 에러율
- 레이트리밋 상태

### Grafana 대시보드
1. http://localhost:3000 접속
2. "Libra Bot Dashboard" 선택
3. 실시간 메트릭 확인

## 🎯 다음 단계

### Phase B: 음성 기능 추가
- VAD (Voice Activity Detection)
- STT (Speech-to-Text)
- TTS (Text-to-Speech)
- 실시간 음성 스트리밍

### Phase C: 고급 기능
- 툴콜 (Function Calling)
- RAG (Retrieval-Augmented Generation)
- 개인화 메모리
- 모더레이션

## 🆘 지원

문제가 발생하면:
1. 로그 확인: `docker-compose logs -f [service-name]`
2. GitHub Issues 생성
3. Discord 커뮤니티 문의

---

**축하합니다! 🎉 리브라 봇이 성공적으로 실행되었습니다.**
