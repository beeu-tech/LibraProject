import { createLogger } from '../utils/logger';

const logger = createLogger('aiWorkerClient');

export interface ChatRequest {
  userId: string;
  username: string;
  guildId: string | null;
  channelId: string;
  content: string;
  messageId: string;
}

export class AIWorkerClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.AI_WORKER_URL || 'http://localhost:8000';
  }

  /**
   * AI Worker로 채팅 요청 직접 전송 (BFF 제거)
   */
  async sendChatRequest(request: ChatRequest): Promise<Response | null> {
    try {
      logger.info(`AI Worker 요청 시작: ${this.baseUrl}/api/chat/completions`);
      
      // AI Worker의 AUTH_MODE에 맞는 헤더 생성
      const secret = process.env.WORKER_SHARED_SECRET;
      if (!secret) {
        logger.error('WORKER_SHARED_SECRET 환경변수가 설정되지 않음');
        return null;
      }
      
      const response = await fetch(`${this.baseUrl}/api/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shared-Secret': secret,  // Simple 모드 인증
        },
        body: JSON.stringify({
          userId: request.userId,
          username: request.username,
          guildId: request.guildId,
          channelId: request.channelId,
          content: request.content,
          messageId: request.messageId,
          stream: true,
        }),
      });

      logger.info(`AI Worker 응답 상태: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        logger.error(`AI Worker 요청 실패: ${response.status} ${response.statusText}`);
        return null;
      }

      return response;
    } catch (error) {
      logger.error('AI Worker 요청 중 오류:', error);
      logger.error('오류 상세:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: `${this.baseUrl}/api/chat/completions`
      });
      return null;
    }
  }

  /**
   * STT - 음성을 텍스트로 변환
   */
  async transcribeAudio(audioData: Buffer): Promise<string | null> {
    try {
      const formData = new FormData();
      const audioBlob = new Blob([audioData], { type: 'audio/wav' });
      formData.append('audio_file', audioBlob, 'audio.wav');

      const secret = process.env.WORKER_SHARED_SECRET;
      if (!secret) {
        logger.error('WORKER_SHARED_SECRET 환경변수가 설정되지 않음');
        return null;
      }
      
      const response = await fetch(`${this.baseUrl}/api/stt/transcribe`, {
        method: 'POST',
        headers: {
          'X-Shared-Secret': secret,
        },
        body: formData,
      });

      if (!response.ok) {
        logger.error(`STT 요청 실패: ${response.status} ${response.statusText}`);
        return null;
      }

      const result = await response.json() as { text?: string };
      return result.text || null;
    } catch (error) {
      logger.error('STT 요청 중 오류:', error);
      return null;
    }
  }

  /**
   * TTS - 텍스트를 음성으로 변환
   */
  async generateTTS(text: string): Promise<Buffer | null> {
    try {
      const secret = process.env.WORKER_SHARED_SECRET;
      if (!secret) {
        logger.error('WORKER_SHARED_SECRET 환경변수가 설정되지 않음');
        return null;
      }
      
      const response = await fetch(`${this.baseUrl}/api/tts/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shared-Secret': secret,
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        logger.error(`TTS 요청 실패: ${response.status} ${response.statusText}`);
        return null;
      }

      const audioData = await response.arrayBuffer();
      return Buffer.from(audioData);
    } catch (error) {
      logger.error('TTS 요청 중 오류:', error);
      return null;
    }
  }
}

