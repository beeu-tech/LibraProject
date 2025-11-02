import { FastifyInstance } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        asr: process.env.ASR_URL || 'http://asr:5005',
        llm: process.env.LLM_URL || 'http://llm:11434',
      },
    };
  });
}

