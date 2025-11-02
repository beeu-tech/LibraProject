FROM node:18-alpine

WORKDIR /app

# 패키지 파일 복사
COPY package*.json ./
COPY apps/voice-processing-cluster/package*.json ./apps/voice-processing-cluster/

# 의존성 설치
RUN npm ci

# 소스 코드 복사
COPY apps/voice-processing-cluster/src ./apps/voice-processing-cluster/src
COPY apps/voice-processing-cluster/tsconfig.json ./apps/voice-processing-cluster/

# 빌드
RUN cd apps/voice-processing-cluster && npm run build

WORKDIR /app/apps/voice-processing-cluster

CMD ["npm", "start"]
