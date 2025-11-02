#!/bin/bash
# ====================================================
# Docker Secrets 생성 스크립트
# ====================================================
# 실행: chmod +x scripts/createSecrets.sh && ./scripts/createSecrets.sh
# ====================================================

set -e

SECRETS_DIR="./secrets"

# Secrets 디렉토리 생성
mkdir -p "$SECRETS_DIR"

echo "🔐 Docker Secrets 파일 생성 중..."

# 강력한 랜덤 비밀번호 생성 함수
generate_password() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
}

# 1. PostgreSQL 비밀번호
if [ ! -f "$SECRETS_DIR/postgres_password.txt" ]; then
    generate_password > "$SECRETS_DIR/postgres_password.txt"
    echo "✅ postgres_password.txt 생성 완료"
else
    echo "⏭️  postgres_password.txt 이미 존재"
fi

# 2. Discord 토큰 (수동 입력 필요)
if [ ! -f "$SECRETS_DIR/discord_token.txt" ]; then
    echo "placeholder_discord_token" > "$SECRETS_DIR/discord_token.txt"
    echo "⚠️  discord_token.txt 생성됨 - 실제 토큰으로 교체 필요!"
else
    echo "⏭️  discord_token.txt 이미 존재"
fi

# 3. Worker Shared Secret
if [ ! -f "$SECRETS_DIR/worker_shared_secret.txt" ]; then
    openssl rand -hex 32 > "$SECRETS_DIR/worker_shared_secret.txt"
    echo "✅ worker_shared_secret.txt 생성 완료"
else
    echo "⏭️  worker_shared_secret.txt 이미 존재"
fi

# 4. OpenAI API Key (수동 입력 필요)
if [ ! -f "$SECRETS_DIR/openai_api_key.txt" ]; then
    echo "placeholder_openai_key" > "$SECRETS_DIR/openai_api_key.txt"
    echo "⚠️  openai_api_key.txt 생성됨 - 실제 키로 교체 필요!"
else
    echo "⏭️  openai_api_key.txt 이미 존재"
fi

# 5. Anthropic API Key (수동 입력 필요)
if [ ! -f "$SECRETS_DIR/anthropic_api_key.txt" ]; then
    echo "placeholder_anthropic_key" > "$SECRETS_DIR/anthropic_api_key.txt"
    echo "⚠️  anthropic_api_key.txt 생성됨 - 실제 키로 교체 필요!"
else
    echo "⏭️  anthropic_api_key.txt 이미 존재"
fi

# 6. Grafana 관리자 비밀번호
if [ ! -f "$SECRETS_DIR/grafana_password.txt" ]; then
    generate_password > "$SECRETS_DIR/grafana_password.txt"
    echo "✅ grafana_password.txt 생성 완료"
else
    echo "⏭️  grafana_password.txt 이미 존재"
fi

# 파일 권한 설정 (600: 소유자만 읽기/쓰기)
chmod 600 "$SECRETS_DIR"/*.txt

echo ""
echo "🎉 Secrets 파일 생성 완료!"
echo ""
echo "📝 다음 파일들을 실제 값으로 교체하세요:"
echo "   - $SECRETS_DIR/discord_token.txt"
echo "   - $SECRETS_DIR/openai_api_key.txt"
echo "   - $SECRETS_DIR/anthropic_api_key.txt"
echo ""
echo "🚀 배포 명령어:"
echo "   docker-compose -f docker-compose.yml -f docker-compose.secrets.yml up -d"
echo ""
