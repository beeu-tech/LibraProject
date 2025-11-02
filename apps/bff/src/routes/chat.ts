import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../utils/logger';
import { AIWorkerClient } from '../services/aiWorkerClient';
import { costGuard } from '../middleware/costGuard';

const logger = createLogger('chat');
const aiWorkerClient = new AIWorkerClient();

// 요청 스키마 정의
const ChatRequestSchema = z.object({
  userId: z.string(),
  username: z.string(),
  guildId: z.string().nullable(),
  channelId: z.string(),
  content: z.string().min(1).max(2000),
  messageId: z.string(),
  stream: z.boolean().optional().default(true),
});

type ChatRequest = z.infer<typeof ChatRequestSchema>;

export async function chatRoutes(fastify: FastifyInstance) {
  // 채팅 완성 엔드포인트 (비용 가드 적용)
  fastify.post('/chat/completions', { preHandler: [costGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // 요청 검증
      const validatedRequest = ChatRequestSchema.parse(request.body);
      
      logger.info({
        userId: validatedRequest.userId,
        guildId: validatedRequest.guildId,
        channelId: validatedRequest.channelId,
        contentSample: validatedRequest.content.substring(0, 80)
      }, '채팅 요청');

      // 비스트리밍 응답
      if (!validatedRequest.stream) {
        const response = await aiWorkerClient.sendChatRequestSync(validatedRequest);
        
        if (!response) {
          return reply.status(502).send({
            error: 'AI 워커 연결 실패',
            statusCode: 502,
          });
        }

        return response;
      }

      // 스트리밍 응답 설정 (SSE)
      reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('Access-Control-Allow-Origin', '*');
      reply.raw.setHeader('X-Accel-Buffering', 'no'); // nginx buffering off

      // AI 워커로 요청 전달
      const stream = await aiWorkerClient.sendChatRequest(validatedRequest);
      
      if (!stream) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'AI 워커 연결 실패' })}\n\n`);
        reply.raw.end();
        return;
      }

      const reader = stream.getReader();
      const decoder = new TextDecoder();

      let closed = false;
      const closeAll = async () => {
        if (closed) return;
        closed = true;
        try { await reader.cancel(); } catch {}
        try { await stream.cancel?.(); } catch {}
        reply.raw.end();
      };

      // 클라이언트 종료 감지
      request.raw.on('close', () => {
        logger.warn({ userId: validatedRequest.userId }, '클라이언트 종료');
        closeAll();
      });

      // 하트비트 (30초마다)
      const ping = setInterval(() => {
        try { reply.raw.write(':\n\n'); } catch {}
      }, 30000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          // 멀티바이트 안전 디코딩
          const text = decoder.decode(value, { stream: true });
          // 워커가 이미 "data: ...\n\n" SSE로 보낸다는 계약 → 패스스루
          reply.raw.write(text);
        }
        
        // flush 남은 데이터
        const rest = decoder.decode();
        if (rest) reply.raw.write(rest);
        reply.raw.write('event: done\ndata: {}\n\n');
        
      } catch (err) {
        logger.error({ err }, '스트리밍 오류');
        try { 
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'stream failure' })}\n\n`); 
        } catch {}
      } finally {
        clearInterval(ping);
        closeAll();
      }

    } catch (error) {
      logger.error('채팅 요청 처리 오류:', error);
      
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: '잘못된 요청 형식',
          details: error.errors,
          statusCode: 400,
        });
      }

      return reply.status(500).send({
        error: '내부 서버 오류',
        statusCode: 500,
      });
    }
  });

  // 채팅 히스토리 조회
  fastify.get('/chat/history/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.params as { userId: string };
      const { limit = 50, offset = 0 } = request.query as { limit?: number; offset?: number };

      const history = await aiWorkerClient.getChatHistory(userId, limit, offset);
      
      return {
        userId,
        messages: history,
        pagination: {
          limit,
          offset,
          hasMore: history.length === limit,
        },
      };

    } catch (error) {
      logger.error('채팅 히스토리 조회 오류:', error);
      return reply.status(500).send({
        error: '히스토리 조회 실패',
        statusCode: 500,
      });
    }
  });

  // 세션 관리
  fastify.post('/chat/session/:userId/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.params as { userId: string };
      
      await aiWorkerClient.resetSession(userId);
      
      return {
        message: '세션이 초기화되었습니다.',
        userId,
      };

    } catch (error) {
      logger.error('세션 초기화 오류:', error);
      return reply.status(500).send({
        error: '세션 초기화 실패',
        statusCode: 500,
      });
    }
  });
}
