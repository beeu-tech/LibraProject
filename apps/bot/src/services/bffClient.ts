import { createLogger } from '../utils/logger';

const logger = createLogger('bffClient');

export interface ChatRequest {
  userId: string;
  username: string;
  guildId: string | null;
  channelId: string;
  content: string;
  messageId: string;
}

export class BFFClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.BFF_URL || 'http://localhost:3001';
  }

  /**
   * BFF로 채팅 요청 전송
   */
  async sendChatRequest(request: ChatRequest): Promise<Response | null> {
    try {
      logger.info(`BFF 요청 시작: ${this.baseUrl}/api/chat/completions`);
      
      const response = await fetch(`${this.baseUrl}/api/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.BFF_API_KEY || 'default'}`,
        },
        body: JSON.stringify({
          ...request,
          stream: true,
        }),
      });

      logger.info(`BFF 응답 상태: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        logger.error(`BFF 요청 실패: ${response.status} ${response.statusText}`);
        return null;
      }

      return response;
    } catch (error) {
      logger.error('BFF 요청 중 오류:', error);
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

      const response = await fetch(`${this.baseUrl}/api/stt/transcribe`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.BFF_API_KEY || 'default'}`,
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
      const response = await fetch(`${this.baseUrl}/api/tts/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.BFF_API_KEY || 'default'}`,
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

  /**
   * 음성 요청 전송 (향후 구현)
   */
  async sendVoiceRequest(request: any): Promise<Response | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/voice/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.BFF_API_KEY || 'default'}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        logger.error(`음성 BFF 요청 실패: ${response.status} ${response.statusText}`);
        return null;
      }

      return response;
    } catch (error) {
      logger.error('음성 BFF 요청 중 오류:', error);
      return null;
    }
  }
}
