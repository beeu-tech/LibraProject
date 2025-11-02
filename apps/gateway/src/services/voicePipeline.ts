/**
 * Voice Pipeline - 실시간 음성 대화 오케스트레이션
 * 
 * Audio → ASR → LLM → TTS → Audio
 */

import FormData from 'form-data';
import { createLogger } from '../utils/logger';

const logger = createLogger('voice-pipeline');

interface PipelineResult {
  success: boolean;
  transcript?: string;
  llmResponse?: string;
  audioResponse?: Buffer;
  error?: string;
}

export class VoicePipeline {
  // ASR 설정
  private asrUrl: string;
  private asrProvider: string;
  private asrExternalUrl: string;
  private asrModel: string;
  
  // LLM 설정
  private llmUrl: string;
  private llmProvider: string;
  private llmBaseUrl: string;
  private llmModel: string;
  private openaiKey: string;
  
  // TTS 설정
  private ttsProvider: string;
  private elevenLabsKey: string;
  private cfApiToken: string;
  private cfAccountId: string;
  private cfTtsModel: string;
  private cfTtsVoice: string;
  private piperTtsUrl: string;
  
  constructor() {
    // ASR 초기화
    this.asrUrl = process.env.ASR_URL || 'http://asr:5005';
    this.asrProvider = process.env.ASR_PROVIDER || 'local';
    this.asrExternalUrl = process.env.ASR_EXTERNAL_URL || '';
    this.asrModel = process.env.ASR_MODEL || 'whisper-large-v3';
    
    // LLM 초기화
    this.llmUrl = process.env.LLM_URL || 'http://llm:11434';
    this.llmProvider = process.env.LLM_PROVIDER || 'ollama';
    this.llmBaseUrl = process.env.LLM_BASE_URL || '';
    this.llmModel = process.env.LLM_MODEL || 'qwen2.5:7b-instruct';
    this.openaiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.DEEPINFRA_API_KEY || '';
    
    // TTS 초기화
    this.ttsProvider = process.env.TTS_PROVIDER || 'elevenlabs';
    this.elevenLabsKey = process.env.ELEVENLABS_API_KEY || '';
    this.cfApiToken = process.env.CF_API_TOKEN || '';
    this.cfAccountId = process.env.CF_ACCOUNT_ID || '';
    this.cfTtsModel = process.env.CF_TTS_MODEL || '@cf/myshell-ai/melotts';
    this.cfTtsVoice = process.env.CF_TTS_VOICE || 'female';
    this.piperTtsUrl = process.env.PIPER_TTS_URL || '';
    
    logger.info('VoicePipeline 초기화', {
      asrProvider: this.asrProvider,
      llmProvider: this.llmProvider,
      ttsProvider: this.ttsProvider,
    });
  }
  
  /**
   * 전체 파이프라인 실행
   * Audio → ASR → LLM → TTS → Audio
   */
  async process(audioBuffer: Buffer, userId?: string): Promise<PipelineResult> {
    try {
      logger.info('파이프라인 시작', { audioSize: audioBuffer.length });
      
      // 1. ASR: 음성 → 텍스트
      const transcript = await this.speechToText(audioBuffer);
      if (!transcript) {
        return { success: false, error: 'ASR 실패' };
      }
      
      logger.info('ASR 완료', { transcript });
      
      // 2. LLM: 텍스트 → 응답 생성
      const llmResponse = await this.generateResponse(transcript, userId);
      if (!llmResponse) {
        return { success: false, error: 'LLM 실패', transcript };
      }
      
      logger.info('LLM 완료', { response: llmResponse.substring(0, 100) });
      
      // 콘솔에도 출력
      console.log('=== LLM 응답 ===');
      console.log('생성된 응답:', llmResponse);
      console.log('===============');
      
      // 3. TTS: 텍스트 → 음성 (선택적 - 실패해도 텍스트는 반환)
      const ttsAudio = await this.textToSpeech(llmResponse);
      if (!ttsAudio) {
        logger.warn('TTS 실패 - 텍스트만 반환');
        return { success: true, transcript, llmResponse, audioResponse: undefined };
      }
      
      logger.info('TTS 완료', { audioSize: ttsAudio.length });
      
      // 4. WAV → Opus 변환 (Discord 최적화)
      // Discord는 WAV도 재생 가능하므로 변환 생략 (EPIPE 에러 방지)
      logger.info('TTS 오디오 반환 (WAV 형식)', { audioSize: ttsAudio.length });
      const audioResponse = ttsAudio; // WAV 그대로 사용
      
      // const audioResponse = await this.wavToOpus(ttsAudio);
      // if (!audioResponse) {
      //   logger.warn('WAV → Opus 변환 실패 - 원본 WAV 사용');
      //   return { success: true, transcript, llmResponse, audioResponse: ttsAudio };
      // }
      
      // logger.info('Opus 변환 완료', { opusSize: audioResponse.length });
      
      return {
        success: true,
        transcript,
        llmResponse,
        audioResponse,
      };
      
    } catch (error) {
      logger.error('파이프라인 오류:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * ASR: 음성 → 텍스트
   * 로컬(faster-whisper) 또는 외부(Groq/OpenAI Whisper) 지원
   */
  async speechToText(audioBuffer: Buffer): Promise<string | null> {
    try {
      // 외부 Whisper API (Groq/OpenAI)
      if (this.asrProvider === 'external' && this.asrExternalUrl) {
        return await this.externalWhisperTranscribe(audioBuffer, false);  // WAV만 전송
      }
      
      // 로컬 faster-whisper (기본)
      logger.info('ASR 요청 시작 (로컬)', { url: `${this.asrUrl}/transcribe` });
      
      const formData = new FormData();
      formData.append('audio_file', audioBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav',
      });
      formData.append('language', 'ko');
      
      const response = await fetch(`${this.asrUrl}/transcribe`, {
        method: 'POST',
        body: formData as any,
        headers: formData.getHeaders(),
      });
      
      if (!response.ok) {
        logger.error('ASR 요청 실패', { status: response.status });
        return null;
      }
      
      const result = await response.json() as { text: string };
      return result.text || null;
      
    } catch (error) {
      logger.error('ASR 오류:', error);
      return null;
    }
  }
  
  /**
   * WAV → Opus 변환 (ffmpeg 사용, Discord 최적화)
   */
  private async wavToOpus(wavBuffer: Buffer): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      
      const ffmpeg = spawn('ffmpeg', [
        '-f', 'wav',           // 입력: WAV
        '-i', 'pipe:0',        // stdin
        '-f', 'opus',          // 출력: Opus
        '-ar', '48000',        // 48kHz (Discord 표준)
        '-ac', '2',            // 스테레오
        '-b:a', '128k',        // 비트레이트
        'pipe:1',              // stdout
      ]);
      
      const chunks: Buffer[] = [];
      
      ffmpeg.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      
      ffmpeg.stderr.on('data', (data: Buffer) => {
        // ffmpeg 에러는 무시 (정상 작동 중에도 stderr에 정보 출력)
      });
      
      ffmpeg.on('close', (code: number) => {
        if (code === 0 && chunks.length > 0) {
          const opusBuffer = Buffer.concat(chunks);
          logger.info('ffmpeg WAV → Opus 변환 성공', { 
            inputSize: wavBuffer.length,
            outputSize: opusBuffer.length 
          });
          resolve(opusBuffer);
        } else {
          logger.error('ffmpeg WAV → Opus 변환 실패', { code, chunksCount: chunks.length });
          resolve(null);
        }
      });
      
      ffmpeg.on('error', (error: Error) => {
        logger.error('ffmpeg 프로세스 오류:', error);
        resolve(null);
      });
      
      // stdin 에러 핸들링 (EPIPE 방지)
      ffmpeg.stdin.on('error', (error: Error) => {
        logger.error('ffmpeg stdin 오류 (무시):', error.message);
        // EPIPE 에러는 무시하고 계속 진행
      });
      
      // WAV 데이터 전송
      try {
        ffmpeg.stdin.write(wavBuffer);
        ffmpeg.stdin.end();
      } catch (error) {
        logger.error('ffmpeg 데이터 전송 실패:', error);
        ffmpeg.kill();
        resolve(null);
      }
    });
  }
  
  /**
   * Opus → WAV 변환 (ffmpeg 사용)
   */
  private async opusToWav(opusBuffer: Buffer): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      
      // raw Opus 패킷은 헤더가 없으므로 Ogg 컨테이너로 감싸야 함
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',          // raw PCM 입력으로 시도 (Opus 디코딩 대신)
        '-ar', '48000',         // 샘플레이트
        '-ac', '2',             // 스테레오
        '-i', 'pipe:0',         // stdin
        '-f', 'wav',            // WAV 출력
        'pipe:1'                // stdout
      ]);
      
      const chunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      
      ffmpeg.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      
      ffmpeg.stderr.on('data', (data: Buffer) => {
        stderrChunks.push(data);
      });
      
      ffmpeg.on('close', (code: number) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          const errorMsg = Buffer.concat(stderrChunks).toString();
          console.error('=== FFMPEG OPUS→WAV ERROR ===');
          console.error('Exit code:', code);
          console.error('Error output:', errorMsg.substring(0, 500));
          console.error('============================');
          logger.error('ffmpeg Opus → WAV 변환 실패', { exitCode: code, error: errorMsg.substring(0, 200) });
          resolve(null);
        }
      });
      
      ffmpeg.on('error', (error: Error) => {
        logger.error('ffmpeg 실행 오류:', error);
        resolve(null);
      });
      
      // Opus 데이터를 stdin으로 전송
      ffmpeg.stdin.write(opusBuffer);
      ffmpeg.stdin.end();
    });
  }

  /**
   * 외부 Whisper API 호출 (Groq/OpenAI 등)
   */
  private async externalWhisperTranscribe(audioBuffer: Buffer, isOpus: boolean = false): Promise<string | null> {
    try {
      // Opus인 경우 WAV로 변환 (raw Opus 패킷 → 완전한 WAV 파일)
      let finalAudioBuffer = audioBuffer;
      if (isOpus) {
        logger.info('raw Opus → WAV 변환 시작 (ffmpeg)', { opusSize: audioBuffer.length });
        const wavBuffer = await this.opusToWav(audioBuffer);
        if (!wavBuffer) {
          logger.error('Opus → WAV 변환 실패');
          return null;
        }
        finalAudioBuffer = wavBuffer;
        logger.info('Opus → WAV 변환 완료', { wavSize: wavBuffer.length });
      }
      
      logger.info('외부 Whisper API 요청', { 
        url: this.asrExternalUrl,
        audioSize: finalAudioBuffer.length,
        model: this.asrModel,
        hasKey: !!this.openaiKey,
        format: 'wav'
      });
      
      // FormData를 사용하지 않고 fetch의 네이티브 FormData 사용
      const formData = new (globalThis as any).FormData();
      
      // WAV 파일로 전송
      const audioBlob = new Blob([finalAudioBuffer], { type: 'audio/wav' });
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', this.asrModel);
      formData.append('language', 'ko');
      formData.append('response_format', 'json');
      
      logger.info('FormData 생성 완료', {
        hasFile: true,
        model: this.asrModel,
        language: 'ko',
        audioSize: audioBuffer.length
      });
      
      const response = await fetch(this.asrExternalUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiKey}`,
        },
        body: formData,
      });
      
      logger.info('Groq ASR 응답 수신', { 
        status: response.status, 
        ok: response.ok 
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        
        // 콘솔에 직접 출력
        console.error('=== GROQ ASR FAILED ===');
        console.error('Status:', response.status);
        console.error('Status Text:', response.statusText);
        console.error('Error Response:', errorText);
        console.error('=======================');
        
        logger.error('외부 Whisper API 실패', { 
          status: response.status,
          statusText: response.statusText,
          error: errorText.substring(0, 500)
        });
        return null;
      }
      
      const result = await response.json() as { text: string };
      logger.info('ASR 변환 완료', { 
        transcript: result.text,
        transcriptLength: result.text?.length || 0
      });
      
      // 콘솔에도 출력
      console.log('=== ASR 결과 ===');
      console.log('변환된 텍스트:', result.text);
      console.log('===============');
      
      return result.text || null;
      
    } catch (error) {
      logger.error('외부 Whisper API 오류:', error);
      if (error instanceof Error) {
        logger.error('오류 상세:', {
          message: error.message,
          stack: error.stack?.substring(0, 500)
        });
      }
      return null;
    }
  }
  
  /**
   * LLM: 대화 생성
   * Ollama(로컬) 또는 OpenAI 호환(Groq/OpenRouter/DeepInfra) 지원
   */
  async generateResponse(text: string, userId?: string): Promise<string | null> {
    try {
      logger.info('LLM 요청 시작', { 
        provider: this.llmProvider,
        text: text.substring(0, 100) 
      });
      
      // OpenAI 호환 API (Groq/OpenRouter/DeepInfra 등)
      if (this.llmProvider === 'openai' && this.llmBaseUrl) {
        return await this.openaiCompatibleGenerate(text, userId);
      }
      
      // Ollama API (로컬, 기본)
      const response = await fetch(`${this.llmUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.llmModel,
          prompt: this.buildPrompt(text),
          stream: false,
          options: {
            num_predict: parseInt(process.env.LLM_NUM_PREDICT || '60'),
            temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.6'),
          },
        }),
      });
      
      if (!response.ok) {
        logger.error('Ollama 요청 실패', { status: response.status });
        return null;
      }
      
      const result = await response.json() as { response: string };
      return result.response || null;
      
    } catch (error) {
      logger.error('LLM 오류:', error);
      return null;
    }
  }
  
  /**
   * OpenAI 호환 API 호출 (Groq, OpenRouter, DeepInfra 등)
   */
  private async openaiCompatibleGenerate(text: string, userId?: string): Promise<string | null> {
    try {
      logger.info('OpenAI 호환 API 요청', { 
        baseUrl: this.llmBaseUrl,
        model: this.llmModel 
      });
      
      const systemPrompt = `당신은 리브라입니다. Discord의 친근한 AI 어시스턴트입니다.

답변 방식:
- 자연스러운 한국어로 대화하세요
- 질문에 직접적으로 답변하세요
- 간결하고 명확하게 답변하세요
- 음성으로 읽을 것이므로 3-6문장 정도로 답변하세요`;
      
      const response = await fetch(`${this.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiKey}`,
        },
        body: JSON.stringify({
          model: this.llmModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
          max_tokens: parseInt(process.env.LLM_NUM_PREDICT || '256'),
          temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.6'),
          top_p: 0.9,
          frequency_penalty: 0.1,
          presence_penalty: 0.1,
          stream: false,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error('OpenAI 호환 API 실패', { 
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          model: this.llmModel,
          baseUrl: this.llmBaseUrl
        });
        
        console.error('=== LLM API 실패 ===');
        console.error('Status:', response.status, response.statusText);
        console.error('Model:', this.llmModel);
        console.error('Base URL:', this.llmBaseUrl);
        console.error('Error:', errorText);
        console.error('==================');
        
        return null;
      }
      
      const result = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      
      let content = result.choices?.[0]?.message?.content || null;
      
      // <think> 태그 제거 (Qwen 모델의 추론 과정 필터링)
      if (content && content.includes('<think>')) {
        const parts = content.split('</think>');
        content = parts.length > 1 ? parts[parts.length - 1].trim() : content;
        logger.info('CoT 태그 필터링됨', { 
          original_length: result.choices?.[0]?.message?.content?.length,
          filtered_length: content.length 
        });
      }
      
      return content;
      
    } catch (error) {
      logger.error('OpenAI 호환 API 오류:', error);
      return null;
    }
  }
  
  /**
   * TTS: 텍스트 → 음성
   * 우선순위: Cloudflare(무료) → ElevenLabs(유료) → Piper(로컬 백업)
   */
  async textToSpeech(text: string): Promise<Buffer | null> {
    try {
      logger.info('TTS 요청 시작', { 
        provider: this.ttsProvider,
        textLength: text.length 
      });
      
      // 1순위: Cloudflare Workers AI (무료, 10만 neurons/일)
      if (this.ttsProvider === 'cloudflare' && this.cfApiToken && this.cfAccountId) {
        const result = await this.cloudflareTTS(text);
        if (result) return result;
        logger.warn('Cloudflare TTS 실패, 폴백 시도');
      }
      
      // 2순위: ElevenLabs (유료, 음질 최고)
      if ((this.ttsProvider === 'elevenlabs' || !this.ttsProvider) && this.elevenLabsKey) {
        const result = await this.elevenLabsTTS(text);
        if (result) return result;
        logger.warn('ElevenLabs TTS 실패, 폴백 시도');
      }
      
      // 3순위: Piper (로컬, 완전 무료)
      if (this.piperTtsUrl) {
        const result = await this.piperTTS(text);
        if (result) return result;
        logger.warn('Piper TTS 실패');
      }
      
      logger.error('모든 TTS 프로바이더 실패');
      return null;
      
    } catch (error) {
      logger.error('TTS 오류:', error);
      return null;
    }
  }
  
  /**
   * Cloudflare Workers AI TTS (무료)
   */
  private async cloudflareTTS(text: string): Promise<Buffer | null> {
    try {
      logger.info('Cloudflare TTS 요청', { model: this.cfTtsModel });
      
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.cfAccountId}/ai/run/${this.cfTtsModel}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.cfApiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: text,  // MeloTTS는 'prompt' 사용
            voice: this.cfTtsVoice,
          }),
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Cloudflare TTS 실패', { 
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          accountId: this.cfAccountId,
          hasToken: !!this.cfApiToken,
          model: this.cfTtsModel
        });
        
        // 콘솔에도 출력
        console.error('=== CLOUDFLARE TTS FAILED ===');
        console.error('Status:', response.status, response.statusText);
        console.error('Error:', errorText);
        console.error('Account ID:', this.cfAccountId);
        console.error('Model:', this.cfTtsModel);
        console.error('============================');
        
        return null;
      }
      
      const contentType = response.headers.get('content-type');
      
      // Cloudflare는 JSON으로 base64 인코딩된 오디오를 반환
      const responseData = await response.json() as { result: { audio: string } };
      const audioBuffer = Buffer.from(responseData.result.audio, 'base64');
      
      logger.info('Cloudflare TTS 성공', { 
        size: audioBuffer.length,
        contentType,
        firstBytes: audioBuffer.slice(0, 20).toString('hex')
      });
      
      // 콘솔에도 출력
      console.log('=== CLOUDFLARE TTS 성공 ===');
      console.log('오디오 크기:', audioBuffer.length);
      console.log('Content-Type:', contentType);
      console.log('첫 20바이트 (디코드 후):', audioBuffer.slice(0, 20).toString('hex'));
      console.log('===========================');
      
      return audioBuffer;
      
    } catch (error) {
      logger.error('Cloudflare TTS 오류:', error);
      return null;
    }
  }
  
  /**
   * ElevenLabs TTS (유료, 음질 최고)
   */
  private async elevenLabsTTS(text: string): Promise<Buffer | null> {
    try {
      logger.info('ElevenLabs TTS 요청');
      
      const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel
      
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': this.elevenLabsKey,
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error('ElevenLabs TTS 실패', { 
          status: response.status,
          error: errorText 
        });
        return null;
      }
      
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      logger.info('ElevenLabs TTS 성공', { size: audioBuffer.length });
      
      return audioBuffer;
      
    } catch (error) {
      logger.error('ElevenLabs TTS 오류:', error);
      return null;
    }
  }
  
  /**
   * Piper TTS (로컬, 완전 무료)
   */
  private async piperTTS(text: string): Promise<Buffer | null> {
    try {
      logger.info('Piper TTS 요청', { url: this.piperTtsUrl });
      
      const response = await fetch(this.piperTtsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });
      
      if (!response.ok) {
        logger.error('Piper TTS 실패', { status: response.status });
        return null;
      }
      
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      logger.info('Piper TTS 성공', { size: audioBuffer.length });
      
      return audioBuffer;
      
    } catch (error) {
      logger.error('Piper TTS 오류:', error);
      return null;
    }
  }
  
  /**
   * LLM 프롬프트 생성
   */
  private buildPrompt(userMessage: string): string {
    const systemPrompt = `당신은 친절하고 도움이 되는 AI 어시스턴트 '리브라'입니다.
간결하고 자연스러운 대화체로 응답하세요.
음성으로 읽을 것이므로 너무 길지 않게 답변하세요 (2-3문장 권장).`;
    
    return `${systemPrompt}\n\n사용자: ${userMessage}\n리브라:`;
  }
}

