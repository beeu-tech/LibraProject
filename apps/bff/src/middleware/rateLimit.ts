import { FastifyRequest, FastifyReply } from 'fastify';
import Redis from 'ioredis';
import { createLogger } from '../utils/logger';

const logger = createLogger('rateLimit');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export async function rateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    // 헬스체크는 레이트리밋 제외
    if (request.url === '/health') {
      return;
    }

    const clientIp = request.ip;
    const userId = (request.body as any)?.userId || 'anonymous';
    const key = `bff_rate_limit:${clientIp}:${userId}`;
    
    const current = await redis.incr(key);
    
    if (current === 1) {
      await redis.expire(key, 60); // 1분 윈도우
    }
    
    const limit = 30; // 분당 30회 제한
    if (current > limit) {
      logger.warn(`BFF 레이트리밋 초과: ${clientIp}:${userId} (${current}/${limit})`);
      return reply.status(429).send({
        error: '요청이 너무 빈번합니다. 잠시 후 다시 시도해주세요.',
        statusCode: 429,
        retryAfter: 60,
      });
    }

    // 응답 헤더에 레이트리밋 정보 추가
    reply.header('X-RateLimit-Limit', limit);
    reply.header('X-RateLimit-Remaining', Math.max(0, limit - current));
    reply.header('X-RateLimit-Reset', Date.now() + 60000);

  } catch (error) {
    logger.error('레이트리밋 미들웨어 오류:', error);
    // Redis 오류 시 기본적으로 허용
  }
}
