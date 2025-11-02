import { FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '../utils/logger';

const logger = createLogger('auth');

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    // 헬스체크와 메트릭은 인증 제외
    if (request.url === '/health' || request.url === '/metrics') {
      return;
    }

    const authHeader = request.headers.authorization;
    
    if (!authHeader) {
      return reply.status(401).send({
        error: '인증 토큰이 필요합니다.',
        statusCode: 401,
      });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // BFF API 키 검증 (fail-fast)
    const apiKey = process.env.BFF_API_KEY;
    if (!apiKey) {
      // 운영/테스트 모두 키 미설정이면 실패(Fail-fast)
      return reply.status(500).send({ 
        error: 'BFF_API_KEY not set', 
        statusCode: 500 
      });
    }
    
    const isDev = process.env.NODE_ENV !== 'production';
    // 개발에서만 'default' 임시 허용, 운영은 금지
    const ok = (token === apiKey) || (isDev && token === 'default');
    if (!ok) {
      return reply.status(401).send({
        error: '유효하지 않은 인증 토큰입니다.',
        statusCode: 401,
      });
    }

    // 요청에 사용자 정보 추가
    (request as any).auth = {
      token,
      timestamp: Date.now(),
    };

  } catch (error) {
    logger.error('인증 미들웨어 오류:', error);
    return reply.status(500).send({
      error: '인증 처리 중 오류가 발생했습니다.',
      statusCode: 500,
    });
  }
}
