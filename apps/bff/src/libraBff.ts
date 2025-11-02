import Fastify from 'fastify';
import { config } from 'dotenv';
import { createLogger } from './utils/logger';
import { chatRoutes } from './routes/chat';
import { sttRoutes } from './routes/stt';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { cacheMiddleware } from './middleware/cache';
import client from 'prom-client';

// 환경변수 로드
config();

const logger = createLogger('bff');
const port = parseInt(process.env.BFF_PORT || '3001');

// Fastify 서버 생성
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  },
});

// 플러그인 등록
async function registerPlugins() {
  // CORS 설정
  await server.register(require('@fastify/cors'), {
    origin: true,
    credentials: true,
  });

  // 보안 헤더
  await server.register(require('@fastify/helmet'), {
    contentSecurityPolicy: false,
  });

  // 레이트리밋
  await server.register(require('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
  });
}

// 미들웨어 등록
async function registerMiddleware() {
  // 인증 미들웨어
  server.addHook('preHandler', authMiddleware);
  
  // 캐시 미들웨어
  server.addHook('preHandler', cacheMiddleware);
  
  // 레이트리밋은 @fastify/rate-limit 플러그인으로 처리
  // 비용 가드는 개별 라우트에서 적용
}

// 라우트 등록
async function registerRoutes() {
  // 메트릭 등록
  const register = new client.Registry();
  client.collectDefaultMetrics({ register });
  
  // 헬스체크
  server.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // 메트릭 엔드포인트
  server.get('/metrics', async (request, reply) => {
    reply.type('text/plain').send(await register.metrics());
  });

  // 채팅 라우트
  await server.register(chatRoutes, { prefix: '/api' });
  
  // STT 라우트
  await server.register(sttRoutes, { prefix: '/api' });
}

// 에러 핸들러
server.setErrorHandler(async (error, request, reply) => {
  logger.error('서버 오류:', error);
  
  const statusCode = error.statusCode || 500;
  const message = statusCode === 500 ? '내부 서버 오류' : error.message;
  
  reply.status(statusCode).send({
    error: message,
    statusCode,
    timestamp: new Date().toISOString(),
  });
});

// 서버 시작
async function start() {
  try {
    await registerPlugins();
    await registerMiddleware();
    await registerRoutes();
    
    await server.listen({ port, host: '0.0.0.0' });
    logger.info(`BFF 서버가 포트 ${port}에서 시작되었습니다.`);
  } catch (error) {
    logger.error('서버 시작 실패:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('서버 종료 중...');
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('서버 종료 중...');
  await server.close();
  process.exit(0);
});

start();
