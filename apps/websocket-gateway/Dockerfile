FROM node:18-alpine

WORKDIR /app

# 패키지 파일 복사
COPY package*.json ./
COPY apps/websocket-gateway/package*.json ./apps/websocket-gateway/

# 의존성 설치
RUN npm ci

# 소스 코드 복사
COPY apps/websocket-gateway/src ./apps/websocket-gateway/src
COPY apps/websocket-gateway/tsconfig.json ./apps/websocket-gateway/

# 빌드
RUN cd apps/websocket-gateway && npm run build

WORKDIR /app/apps/websocket-gateway

EXPOSE 8002 3001

CMD ["npm", "start"]
