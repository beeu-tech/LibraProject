/**
 * Voice Processing Routes
 * 
 * 실시간 음성 대화 파이프라인:
 * Audio → ASR → LLM → TTS → Audio
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { VoicePipeline } from '../services/voicePipeline';
import { createLogger } from '../utils/logger';

const logger = createLogger('voice-routes');
const pipeline = new VoicePipeline();

export async function voiceRoutes(fastify: FastifyInstance) {
  /**
   * 음성 처리 엔드포인트 (전체 파이프라인)
   * 
   * Input: Raw 오디오 바이너리 (application/octet-stream)
   * Query: userId (optional)
   * Output: JSON { transcript, response, audio (base64) }
   */
  fastify.post('/process', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const contentType = request.headers['content-type'] || '';
      const userId = (request.query as any).userId;
      
      logger.info('음성 처리 요청 수신', {
        contentType,
        userId,
        method: request.method,
        hasBody: !!request.body,
        bodyType: typeof request.body
      });
      
      // Raw 바이너리 body 읽기
      const audioBuffer = await request.body as Buffer;
      
      logger.info('Body 파싱 완료', {
        isBuffer: Buffer.isBuffer(audioBuffer),
        audioSize: audioBuffer?.length || 0,
        hasContent: audioBuffer && audioBuffer.length > 0
      });
      
      if (!audioBuffer || audioBuffer.length === 0) {
        logger.error('오디오 데이터가 없음', { 
          hasBody: !!audioBuffer, 
          bodyLength: audioBuffer?.length || 0 
        });
        return reply.status(400).send({ error: '오디오 데이터가 필요합니다' });
      }
      
      logger.info('오디오 수신 완료 - 파이프라인 시작', { 
        userId, 
        audioSize: audioBuffer.length,
        contentType 
      });
      
      // 파이프라인 실행 (Bot에서 WAV로 변환하여 전송)
      logger.info('pipeline.process 호출 전');
      const result = await pipeline.process(audioBuffer, userId);
      logger.info('pipeline.process 호출 후', { 
        success: result.success,
        hasTranscript: !!result.transcript,
        hasLLMResponse: !!result.llmResponse,
        error: result.error
      });
      
      // TTS 실패해도 텍스트 응답은 반환 (음성은 선택적)
      if (!result.success && !result.llmResponse) {
        return reply.status(500).send({ 
          error: '음성 처리 실패',
          details: result.error 
        });
      }
      
      // 응답 반환 (JSON 형식) - TTS 없어도 OK
      return reply.send({
        success: true,
        transcript: result.transcript,
        response: result.llmResponse,
        audio: result.audioResponse ? result.audioResponse.toString('base64') : undefined
      });
      
    } catch (error) {
      logger.error('음성 처리 중 오류:', error);
      return reply.status(500).send({ 
        error: '음성 처리 중 오류가 발생했습니다',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  /**
   * 텍스트 → 음성 변환 (TTS only)
   */
  fastify.post('/tts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { text } = request.body as { text: string };
      
      if (!text) {
        return reply.status(400).send({ error: '텍스트가 필요합니다' });
      }
      
      logger.info('TTS 요청', { textLength: text.length });
      
      // TTS 변환
      const audioBuffer = await pipeline.textToSpeech(text);
      
      if (!audioBuffer) {
        return reply.status(500).send({ error: 'TTS 변환 실패' });
      }
      
      // 응답
      reply.header('Content-Type', 'audio/mpeg');
      reply.header('Content-Disposition', 'inline; filename="tts.mp3"');
      
      return reply.send(audioBuffer);
      
    } catch (error) {
      logger.error('TTS 처리 중 오류:', error);
      return reply.status(500).send({ error: 'TTS 처리 실패' });
    }
  });
  
  /**
   * 음성 → 텍스트 변환 (ASR only)
   */
  fastify.post('/stt', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = await request.file();
      
      if (!data) {
        return reply.status(400).send({ error: '오디오 파일이 필요합니다' });
      }
      
      const audioBuffer = await data.toBuffer();
      
      logger.info('STT 요청', { size: audioBuffer.length });
      
      // ASR 변환
      const text = await pipeline.speechToText(audioBuffer);
      
      if (!text) {
        return reply.status(500).send({ error: 'STT 변환 실패' });
      }
      
      return { text };
      
    } catch (error) {
      logger.error('STT 처리 중 오류:', error);
      return reply.status(500).send({ error: 'STT 처리 실패' });
    }
  });
}

