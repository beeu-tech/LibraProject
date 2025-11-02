import { createLogger } from '../utils/logger';
import { createAuthHeaders } from '../utils/signing';

const logger = createLogger('aiWorkerClient');

export interface ChatRequest {
  userId: string;
  username: string;
  guildId: string | null;
  channelId: string;
  content: string;
  messageId: string;
  stream?: boolean;
}

export class AIWorkerClient {
  private baseUrl: string;
  private secret: string;

  constructor() {
    this.baseUrl = process.env.AI_WORKER_URL || 'http://localhost:8000';
    this.secret = process.env.WORKER_SHARED_SECRET || '';
    if (!this.secret || this.secret === 'change_me') {
      throw new Error('WORKER_SHARED_SECRET not set');
    }
  }

  /**
   * AI 워커로 스트리밍 채팅 요청 전송
   */
  async sendChatRequest(request: ChatRequest): Promise<ReadableStream | null> {
    try {
      const path = '/api/chat/completions';
      const body = JSON.stringify({
        ...request,
        stream: true,
      });
      
      logger.info(`AI Worker 요청 시작: ${this.baseUrl}${path}`);
      
      const authHeaders = createAuthHeaders(this.secret, 'POST', path, body);
      
      logger.info('AI Worker 요청 헤더:', JSON.stringify({
        'Content-Type': 'application/json',
        ...authHeaders,
      }, null, 2));
      
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body,
      });

      logger.info(`AI Worker 응답 상태: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        logger.error(`AI 워커 요청 실패: ${response.status} ${response.statusText}`);
        return null;
      }

      return response.body;
    } catch (error) {
      logger.error('AI 워커 요청 중 오류:', error);
      logger.error('오류 상세:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: `${this.baseUrl}/api/chat/completions`
      });
      return null;
    }
  }

  /**
   * AI 워커로 동기 채팅 요청 전송
   */
  async sendChatRequestSync(request: ChatRequest): Promise<any> {
    try {
      const path = '/api/chat/completions';
      const body = JSON.stringify({
        ...request,
        stream: false,
      });
      
      const authHeaders = createAuthHeaders(this.secret, 'POST', path, body);
      
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body,
      });

      if (!response.ok) {
        logger.error(`AI 워커 동기 요청 실패: ${response.status} ${response.statusText}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      logger.error('AI 워커 동기 요청 중 오류:', error);
      return null;
    }
  }

  /**
   * 채팅 히스토리 조회
   */
  async getChatHistory(userId: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/chat/history/${userId}?limit=${limit}&offset=${offset}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.AI_WORKER_API_KEY || 'default'}`,
          },
        }
      );

      if (!response.ok) {
        logger.error(`히스토리 조회 실패: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = await response.json() as { messages?: any[] };
      return data.messages || [];
    } catch (error) {
      logger.error('히스토리 조회 중 오류:', error);
      return [];
    }
  }

  /**
   * 세션 초기화
   */
  async resetSession(userId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat/session/${userId}/reset`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.AI_WORKER_API_KEY || 'default'}`,
        },
      });

      if (!response.ok) {
        logger.error(`세션 초기화 실패: ${response.status} ${response.statusText}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('세션 초기화 중 오류:', error);
      return false;
    }
  }
}
