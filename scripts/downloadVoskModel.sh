#!/bin/bash

# Vosk 모델 다운로드 스크립트
# 영어 소형 모델 (약 40MB)을 다운로드합니다

set -e

MODEL_DIR="./models"
MODEL_NAME="vosk-model-small-en-us-0.15"
MODEL_URL="https://alphacephei.com/vosk/models/${MODEL_NAME}.zip"

echo "🎤 Vosk STT 모델 다운로드 시작..."

# 모델 디렉토리 생성
mkdir -p "$MODEL_DIR"

# 모델이 이미 존재하는지 확인
if [ -d "$MODEL_DIR/$MODEL_NAME" ]; then
    echo "✅ 모델이 이미 존재합니다: $MODEL_DIR/$MODEL_NAME"
    exit 0
fi

# 모델 다운로드
echo "📥 모델 다운로드 중: $MODEL_URL"
cd "$MODEL_DIR"
wget -O "${MODEL_NAME}.zip" "$MODEL_URL"

# 압축 해제
echo "📦 모델 압축 해제 중..."
unzip "${MODEL_NAME}.zip"

# 압축 파일 삭제
rm "${MODEL_NAME}.zip"

echo "✅ Vosk 모델 다운로드 완료!"
echo "📁 모델 위치: $MODEL_DIR/$MODEL_NAME"
echo ""
echo "사용 가능한 다른 모델들:"
echo "- vosk-model-en-us-0.22 (1.8GB) - 더 정확한 영어 모델"
echo "- vosk-model-small-ko-0.22 (45MB) - 한국어 모델"
echo "- vosk-model-small-zh-cn-0.22 (45MB) - 중국어 모델"
echo ""
echo "다른 모델을 사용하려면 docker-compose.yml의 VOSK_MODEL_PATH를 수정하세요."
