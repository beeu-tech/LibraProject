/**
 * 실시간 음성 대화 서비스 (VAD 기반 자동 처리)
 * 
 * 플로우:
 * 1. /join → 자동 대기
 * 2. 사용자 말함 → 자동 녹음
 * 3. 2초 무음 → STT → LLM → TTS → 응답
 * 4. 반복
 */

import { VoiceConnection, VoiceConnectionStatus, AudioPlayer, AudioPlayerStatus, createAudioPlayer, createAudioResource, joinVoiceChannel, EndBehaviorType } from '@discordjs/voice';
import { Client, VoiceChannel } from 'discord.js';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import * as prism from 'prism-media';
import { Readable } from 'stream';

const logger = createLogger('realtime-voice');

export interface VoiceConfig {
  gatewayUrl: string;
  silenceThreshold: number; // 무음 감지 시간 (ms)
  sampleRate: number;
  channels: number;
}

export interface RealtimeSession {
  connection: VoiceConnection;
  player: AudioPlayer;
  userId: string;
  channelId: string;
  audioChunks: Buffer[];
  isProcessing: boolean;
  silenceTimer: NodeJS.Timeout | null;
  // 메모리 누수 방지를 위한 스트림 참조
  currentAudioStream?: any;
  currentDecoder?: prism.opus.Decoder;
  speakingListener?: (userId: string) => void;
}

export class RealtimeVoiceService extends EventEmitter {
  private client: Client;
  private config: VoiceConfig;
  private activeSessions: Map<string, RealtimeSession> = new Map();
  private gatewayUrl: string;

  constructor(client: Client, config: VoiceConfig) {
    super();
    this.client = client;
    this.config = config;
    this.gatewayUrl = config.gatewayUrl;
    
    logger.info('실시간 음성 서비스 초기화', { 
      silenceThreshold: config.silenceThreshold,
      gatewayUrl: config.gatewayUrl 
    });
  }

  /**
   * 음성 채널 참여 및 자동 음성 감지 시작
   */
  async joinAndListen(channel: VoiceChannel, userId: string): Promise<boolean> {
    try {
      // 이미 다른 세션이 있는지 확인 (중복 참여 방지)
      if (this.activeSessions.size > 0) {
        const existingUserId = Array.from(this.activeSessions.keys())[0];
        if (existingUserId !== userId) {
          logger.warn('다른 사용자가 이미 음성 채널 사용 중', { 
            existingUserId, 
            requestUserId: userId 
          });
          return false;
        }
      }
      
      logger.info('음성 채널 참여 및 리스닝 시작', { userId, channelId: channel.id });
      
      // Discord Voice 연결
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator as any,
        selfDeaf: true,  // Bot 자신의 음성을 듣지 않음 (Echo 방지!)
        selfMute: false,
      });

      // 연결 상태 모니터링
      connection.on(VoiceConnectionStatus.Ready, () => {
        logger.info('음성 연결 준비 완료', { userId, channelId: channel.id });
      });

      connection.on(VoiceConnectionStatus.Disconnected, () => {
        logger.info('음성 연결 끊어짐', { userId, channelId: channel.id });
        this.cleanup(userId);
      });

      const player = createAudioPlayer();
      
      // Player 이벤트 리스너 등록 (한 번만)
      player.on('stateChange', (oldState, newState) => {
        logger.info('Player 상태 변경', { 
          userId,
          oldStatus: oldState.status, 
          newStatus: newState.status 
        });
        
        // 재생 시작 시 isProcessing = true (Bot 자신의 음성 녹음 방지)
        if (newState.status === 'playing') {
          const session = this.activeSessions.get(userId);
          if (session) {
            session.isProcessing = true;
            logger.info('재생 중 - 녹음 중단', { userId });
          }
        }
        
        // 재생 종료 시 isProcessing = false (다시 녹음 가능)
        if (newState.status === 'idle' && oldState.status === 'playing') {
          const session = this.activeSessions.get(userId);
          if (session) {
            session.isProcessing = false;
            logger.info('재생 종료 - 녹음 재개', { userId });
          }
        }
      });
      
      player.on('error', (error) => {
        console.error('=== PLAYER ERROR ===');
        console.error('UserId:', userId);
        console.error('Error:', error);
        console.error('====================');
        logger.error('Player 오류', { userId, error });
      });

      const session: RealtimeSession = {
        connection,
        player,
        userId,
        channelId: channel.id,
        audioChunks: [],
        isProcessing: false,
        silenceTimer: null,
      };

      this.activeSessions.set(userId, session);

      // 연결 상태 모니터링
      connection.on(VoiceConnectionStatus.Ready, () => {
        logger.info('음성 연결 준비 완료', { userId });
        
        // 자동 음성 감지 시작
        this.startAutoListening(userId);
      });

      connection.on(VoiceConnectionStatus.Disconnected, () => {
        logger.info('음성 연결 끊김', { userId });
        this.cleanup(userId);
      });

      // 오디오 플레이어 이벤트
      player.on(AudioPlayerStatus.Playing, () => {
        logger.debug('AI 응답 재생 중', { userId });
      });

      player.on(AudioPlayerStatus.Idle, () => {
        logger.debug('AI 응답 재생 완료', { userId });
      });

      return true;
    } catch (error) {
      logger.error('음성 채널 참여 실패', { error, userId });
      return false;
    }
  }

  /**
   * 자동 음성 감지 시작 (핵심 로직)
   */
  private startAutoListening(userId: string): void {
    const session = this.activeSessions.get(userId);
    if (!session) return;

    logger.info('자동 음성 감지 시작', { userId });

    const receiver = session.connection.receiver;

    // 기존 리스너가 있으면 제거 (중복 방지)
    if (session.speakingListener) {
      receiver.speaking.off('start', session.speakingListener);
    }

    // 사용자가 말하기 시작할 때
    const speakingListener = (speakingUserId: string) => {
      if (speakingUserId !== userId) return;
      
      logger.info('사용자 음성 감지 → 녹음 시작', { userId });
      
      // 기존 스트림/디코더 정리 (메모리 누수 방지)
      this.cleanupStreams(session);
      
      // 기존 무음 타이머 취소
      if (session.silenceTimer) {
        clearTimeout(session.silenceTimer);
        session.silenceTimer = null;
      }
      
      // 새 녹음 시작
      session.audioChunks = [];
      
      // 오디오 스트림 구독
      const audioStream = receiver.subscribe(speakingUserId, {
        end: {
          behavior: EndBehaviorType.Manual, // 수동 제어
        },
      });
      
      // Opus → PCM 디코딩 (prism-media, Debian에서 안정적!)
      const decoder = new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960,
      });
      
      // 세션에 저장 (cleanup을 위해)
      session.currentAudioStream = audioStream;
      session.currentDecoder = decoder;
      
      let lastDataTime = Date.now();
      let chunkCount = 0;
      const MAX_BUFFER_SIZE = 1000; // 최대 버퍼 크기 제한 (약 20초 음성, 메모리 누수 방지)
      
      // Opus 스트림을 디코더로 파이프
      audioStream.pipe(decoder);
      
      decoder.on('data', (pcmChunk: Buffer) => {
        if (session.isProcessing) {
          // 재생 중에는 녹음하지 않음 (Echo 방지)
          return;
        }
        
        // 최소 오디오 크기 체크 (너무 작은 소리는 무시)
        if (pcmChunk.length < 1000) {
          return;
        }
        
        // 버퍼 크기 제한 (메모리 누수 방지)
        if (session.audioChunks.length < MAX_BUFFER_SIZE) {
          session.audioChunks.push(pcmChunk);  // PCM 데이터 저장
        } else {
          // 버퍼가 가득 차면 무음 타이머 강제 발동 (긴 음성 자동 처리)
          if (session.audioChunks.length === MAX_BUFFER_SIZE) {
            logger.warn('버퍼 가득참 → 자동 처리 시작', { 
              userId, 
              bufferSize: session.audioChunks.length 
            });
            
            // 기존 타이머 취소하고 즉시 처리
            if (session.silenceTimer) {
              clearTimeout(session.silenceTimer);
            }
            this.onSilenceDetected(userId);
          }
        }
        
        chunkCount++;
        lastDataTime = Date.now();
        
        // 무음 감지 타이머 재설정
        if (session.silenceTimer) {
          clearTimeout(session.silenceTimer);
        }
        
        // 2초 무음 감지
        session.silenceTimer = setTimeout(() => {
          logger.info('무음 타이머 발동', { userId, chunks: chunkCount });
          this.onSilenceDetected(userId);
        }, this.config.silenceThreshold);
      });
      
      decoder.on('end', () => {
        logger.debug('PCM 디코딩 종료', { userId, totalChunks: chunkCount });
        this.cleanupStreams(session);
      });
      
      decoder.on('error', (error) => {
        // Opus 디코더 에러는 무시하고 계속 진행 (일부 패킷 에러는 정상)
        logger.debug('Opus 디코더 에러 (무시)', { userId, error: error.message });
      });
    };

    // 리스너 저장 및 등록
    session.speakingListener = speakingListener;
    receiver.speaking.on('start', speakingListener);
  }

  /**
   * 스트림 정리 (메모리 누수 방지)
   */
  private cleanupStreams(session: RealtimeSession): void {
    try {
      if (session.currentAudioStream) {
        session.currentAudioStream.destroy();
        session.currentAudioStream = undefined;
      }
      
      if (session.currentDecoder) {
        session.currentDecoder.removeAllListeners();
        session.currentDecoder.destroy();
        session.currentDecoder = undefined;
      }
    } catch (error) {
      logger.debug('스트림 정리 중 에러 (무시)', { error });
    }
  }

  /**
   * 무음 감지 → 자동 처리
   */
  private async onSilenceDetected(userId: string): Promise<void> {
    const session = this.activeSessions.get(userId);
    
    if (!session) {
      logger.warn('세션 없음, 스킵', { userId });
      return;
    }
    
    if (session.isProcessing) {
      logger.warn('이미 처리 중, 스킵', { userId, isProcessing: session.isProcessing });
      return;
    }

    const pcmChunks = [...session.audioChunks]; // PCM 청크 배열 복사
    
    logger.info('무음 감지 체크', { 
      userId, 
      pcmChunkCount: pcmChunks.length,
      isProcessing: session.isProcessing 
    });
    
    if (pcmChunks.length === 0) {
      logger.warn('오디오 데이터 없음, 스킵', { userId });
      return;
    }

    const totalPcmBuffer = Buffer.concat(pcmChunks);
    
    // 최소 오디오 크기 체크 (최소 10개 패킷 이상)
    const minPacketCount = 10;
    
    if (pcmChunks.length < minPacketCount) {
      logger.warn('오디오 패킷 너무 적음 - 무음으로 판단, 스킵', { 
        userId,
        packetCount: pcmChunks.length,
        minPacketCount
      });
      session.audioChunks = [];
      return;
    }
    
    logger.info('무음 감지 → 처리 시작', { 
      userId, 
      pcmChunkCount: pcmChunks.length,
      totalPcmSize: totalPcmBuffer.length
    });
    
    // 콘솔에도 출력
    console.log('=== 음성 처리 시작 ===');
    console.log('PCM 패킷 수:', pcmChunks.length);
    console.log('총 PCM 크기:', totalPcmBuffer.length);
    console.log('=====================');

    session.isProcessing = true;
    session.audioChunks = [];

    try {
      // Gateway 파이프라인 실행 (ASR → LLM → TTS)
      const result = await this.processVoicePipeline(totalPcmBuffer, userId);
      
      // 콘솔에도 출력
      console.log('=== Gateway 응답 ===');
      console.log('성공:', result.success);
      console.log('음성 인식 결과:', result.transcript);
      console.log('AI 응답:', result.llmResponse);
      console.log('오디오 있음:', !!result.audioResponse);
      console.log('==================');
      
      if (result.success) {
        if (result.audioResponse) {
          // AI 응답 음성 재생
          await this.playAudio(userId, result.audioResponse);
        } else if (result.llmResponse) {
          // TTS 실패 시 텍스트로 출력
          logger.info('TTS 없음 - 텍스트만 출력', { 
            transcript: result.transcript,
            response: result.llmResponse 
          });
          // Discord 채널에 텍스트로 출력 (추후 구현 가능)
        } else if (result.transcript) {
          // ASR만 성공
          logger.info('음성 인식 완료', { 
            userId, 
            transcript: result.transcript 
          });
        }
      }
    } catch (error) {
      logger.error('음성 처리 오류', { error, userId });
    } finally {
      session.isProcessing = false;
      
      // 다시 대기 상태
      logger.info('처리 완료 → 다음 음성 대기 중', { userId });
    }
  }

  /**
   * PCM → WAV 변환
   */
  private pcmToWav(pcmBuffer: Buffer, sampleRate: number = 48000, channels: number = 2): Buffer {
    const bitDepth = 16;
    const byteRate = sampleRate * channels * (bitDepth / 8);
    const blockAlign = channels * (bitDepth / 8);
    const dataSize = pcmBuffer.length;
    const headerSize = 44;
    
    const wavBuffer = Buffer.alloc(headerSize + dataSize);
    
    // RIFF header
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + dataSize, 4);
    wavBuffer.write('WAVE', 8);
    
    // fmt chunk
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16); // fmt chunk size
    wavBuffer.writeUInt16LE(1, 20);  // PCM format
    wavBuffer.writeUInt16LE(channels, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(byteRate, 28);
    wavBuffer.writeUInt16LE(blockAlign, 32);
    wavBuffer.writeUInt16LE(bitDepth, 34);
    
    // data chunk
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(dataSize, 40);
    pcmBuffer.copy(wavBuffer, 44);
    
    return wavBuffer;
  }

  /**
   * 음성 파이프라인 처리 (Gateway API 사용)
   */
  private async processVoicePipeline(pcmBuffer: Buffer, userId: string): Promise<any> {
    try {
      logger.info('음성 처리 시작 (Gateway API - Groq)', { 
        pcmSize: pcmBuffer.length 
      });
      
      // PCM → WAV 변환
      const wavBuffer = this.pcmToWav(pcmBuffer, 48000, 2);
      
      logger.info('PCM → WAV 변환 완료', { 
        pcmSize: pcmBuffer.length,
        wavSize: wavBuffer.length 
      });
      
      // Gateway의 음성 파이프라인 API 호출 (WAV Binary)
      const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:8001';
      
      logger.info('WAV 데이터 전송 준비', { 
        audioSize: wavBuffer.length, 
        userId,
        gatewayUrl 
      });
      
      // Raw binary body + query parameter 방식
      const url = `${gatewayUrl}/api/voice/process${userId ? `?userId=${userId}` : ''}`;
      
      logger.info('WAV binary 전송 시작', { url });
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
        },
        body: wavBuffer,
      });
      
      logger.info('Gateway 응답 수신', { 
        status: response.status, 
        statusText: response.statusText 
      });
      
      if (!response.ok) {
        logger.error('Gateway 음성 처리 실패', { status: response.status });
        return { success: false };
      }
      
      const result = await response.json() as { 
        transcript?: string; 
        response?: string; 
        audio?: string;  // Base64 인코딩된 오디오
      };
      
      logger.info('Gateway 음성 처리 완료', { 
        transcript: result.transcript,
        hasResponse: !!result.response,
        hasAudio: !!result.audio
      });
      
      // TTS 오디오가 있으면 변환
      let audioResponse: Buffer | undefined;
      if (result.audio) {
        audioResponse = Buffer.from(result.audio, 'base64');
      }
      
      return {
        success: true,
        transcript: result.transcript,
        llmResponse: result.response,
        audioResponse,
      };
      
    } catch (error) {
      logger.error('파이프라인 오류', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { success: false };
    }
  }
  
  /**
   * LLM 호출 (Ollama)
   */
  private async callLLM(text: string, userId: string): Promise<string | null> {
    try {
      const aiWorkerUrl = process.env.AI_WORKER_URL || 'http://ai-worker:8000';
      
      const response = await fetch(`${aiWorkerUrl}/api/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shared-Secret': process.env.WORKER_SHARED_SECRET || 'default',
        },
        body: JSON.stringify({
          userId,
          username: 'VoiceUser',
          guildId: null,
          channelId: 'voice',
          content: text,
          messageId: Date.now().toString(),
          stream: false,
        }),
      });
      
      if (!response.ok) {
        logger.error('LLM 요청 실패', { status: response.status });
        return null;
      }
      
      // 스트리밍 응답 수집
      const reader = response.body?.getReader();
      if (!reader) return null;
      
      const decoder = new TextDecoder();
      let fullResponse = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullResponse += data.content;
              }
            } catch {}
          }
        }
      }
      
      return fullResponse || null;
      
    } catch (error) {
      logger.error('LLM 호출 오류', { error });
      return null;
    }
  }

  /**
   * Fallback: STT만 실행
   */
  private async fallbackSTT(audioBuffer: Buffer): Promise<any> {
    try {
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', audioBuffer, 'audio.pcm');
      
      const response = await fetch(`${this.gatewayUrl}/api/voice/stt`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders(),
      });
      
      if (response.ok) {
        const result = await response.json() as { text: string };
        return {
          success: true,
          transcript: result.text,
        };
      }
      
      return { success: false };
    } catch (error) {
      logger.error('STT fallback 실패', { error });
      return { success: false };
    }
  }

  /**
   * AI 응답 음성 재생
   */
  private async playAudio(userId: string, audioBuffer: Buffer): Promise<boolean> {
    const session = this.activeSessions.get(userId);
    if (!session) {
      logger.error('세션이 없어서 재생 불가', { userId });
      return false;
    }
    
    try {
      logger.info('오디오 재생 준비', { 
        userId, 
        audioSize: audioBuffer.length,
        hasConnection: !!session.connection,
        hasPlayer: !!session.player,
        connectionState: session.connection.state.status
      });
      
      const stream = Readable.from(audioBuffer);
      const resource = createAudioResource(stream);
      
      session.player.play(resource);
      session.connection.subscribe(session.player);
      
      logger.info('AI 응답 재생 시작', { 
        userId, 
        audioSize: audioBuffer.length,
        playerState: session.player.state.status
      });
      
      return true;
    } catch (error) {
      // 콘솔에도 출력
      console.error('=== AUDIO PLAYBACK ERROR ===');
      console.error('Error:', error);
      console.error('UserId:', userId);
      console.error('============================');
      
      logger.error('오디오 재생 실패 상세', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        userId,
        errorType: typeof error,
        errorName: error instanceof Error ? error.name : undefined
      });
      return false;
    }
  }

  /**
   * 음성 채널 나가기
   */
  async leave(userId: string): Promise<boolean> {
    const session = this.activeSessions.get(userId);
    if (!session) return false;

    try {
      session.connection.destroy();
      this.cleanup(userId);
      logger.info('음성 채널 나감', { userId });
      return true;
    } catch (error) {
      logger.error('음성 채널 나가기 실패', { error, userId });
      return false;
    }
  }

  /**
   * 세션 정리 (메모리 누수 방지 강화)
   */
  private cleanup(userId: string): void {
    const session = this.activeSessions.get(userId);
    if (!session) return;
    
    logger.info('세션 정리 시작', { userId });
    
    try {
      // 1. 타이머 정리
      if (session.silenceTimer) {
        clearTimeout(session.silenceTimer);
        session.silenceTimer = null;
      }
      
      // 2. 스트림/디코더 정리
      this.cleanupStreams(session);
      
      // 3. 이벤트 리스너 제거
      if (session.speakingListener) {
        const receiver = session.connection.receiver;
        receiver.speaking.off('start', session.speakingListener);
        session.speakingListener = undefined;
      }
      
      // 4. 오디오 버퍼 정리
      session.audioChunks = [];
      
      // 5. Player 정리
      session.player.stop();
      session.player.removeAllListeners();
      
      // 6. Connection 정리
      session.connection.destroy();
      
      logger.info('세션 정리 완료', { userId });
    } catch (error) {
      logger.error('세션 정리 오류', { error, userId });
    } finally {
      // 7. 세션 삭제
      this.activeSessions.delete(userId);
    }
  }

  /**
   * 상태 확인
   */
  isActive(userId: string): boolean {
    return this.activeSessions.has(userId);
  }

  isProcessing(userId: string): boolean {
    return this.activeSessions.get(userId)?.isProcessing || false;
  }
}

