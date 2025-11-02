/**
 * STT (Speech-to-Text) 프록시 라우트
 * AI Worker의 STT 서비스로 요청을 전달
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AIWorkerClient } from '../services/aiWorkerClient';
import { createLogger } from '../utils/logger';

const logger = createLogger('stt-routes');

interface STTTranscribeRequest {
  audio_file: Buffer;
}

export async function sttRoutes(fastify: FastifyInstance) {
  const aiWorkerClient = new AIWorkerClient();

  // STT 헬스체크
  fastify.get('/api/stt/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // AI Worker의 STT 헬스체크 엔드포인트로 직접 요청
      const response = await fetch(`${aiWorkerClient['baseUrl']}/api/stt/health`);
      const data = await response.json();
      return reply.send(data);
    } catch (error) {
      logger.error('STT health check failed', { error });
      return reply.status(500).send({ error: 'STT service unavailable' });
    }
  });

  // STT 변환 (임시로 단순화)
  fastify.post('/api/stt/transcribe', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // 임시로 AI Worker의 STT 엔드포인트로 직접 프록시
      const response = await fetch(`${aiWorkerClient['baseUrl']}/api/stt/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: 'STT request forwarded from BFF' })
      });
      
      const result = await response.json();
      return reply.send(result);
    } catch (error) {
      logger.error('STT transcription failed', { error });
      return reply.status(500).send({ error: 'STT transcription failed' });
    }
  });

  // STT 모델 정보
  fastify.get('/api/stt/models', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const response = await fetch(`${aiWorkerClient['baseUrl']}/api/stt/models`);
      const data = await response.json();
      return reply.send(data);
    } catch (error) {
      logger.error('Failed to get STT models', { error });
      return reply.status(500).send({ error: 'Failed to get STT models' });
    }
  });
}
