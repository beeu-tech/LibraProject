import { z } from 'zod';

// 기본 사용자 스키마
export const UserSchema = z.object({
  id: z.string(),
  discord_user_id: z.string(),
  username: z.string(),
  locale: z.string().default('ko'),
  voice_prefs: z.record(z.any()).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

// 길드 스키마
export const GuildSchema = z.object({
  id: z.string(),
  discord_guild_id: z.string(),
  name: z.string().optional(),
  policies: z.record(z.any()).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

// 세션 스키마
export const SessionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  channel_id: z.string(),
  mode: z.enum(['text', 'voice']).default('text'),
  state: z.record(z.any()).optional(),
  last_seen: z.string().optional(),
  created_at: z.string().optional(),
});

// 메시지 스키마
export const MessageSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  session_id: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  tokens: z.number().default(0),
  latency_ms: z.number().optional(),
  created_at: z.string().optional(),
});

// 채팅 요청 스키마
export const ChatRequestSchema = z.object({
  userId: z.string(),
  username: z.string(),
  guildId: z.string().nullable(),
  channelId: z.string(),
  content: z.string().min(1).max(2000),
  messageId: z.string(),
  stream: z.boolean().default(true),
});

// 채팅 응답 스키마
export const ChatResponseSchema = z.object({
  content: z.string(),
  finished: z.boolean().default(false),
  tokens_used: z.number().optional(),
  latency_ms: z.number().optional(),
  error: z.string().optional(),
});

// 음성 요청 스키마
export const VoiceRequestSchema = z.object({
  userId: z.string(),
  username: z.string(),
  guildId: z.string().nullable(),
  channelId: z.string(),
  audioData: z.string(), // base64 인코딩된 오디오
  format: z.enum(['wav', 'mp3', 'ogg']).default('wav'),
  sampleRate: z.number().default(48000),
});

// 음성 응답 스키마
export const VoiceResponseSchema = z.object({
  audioData: z.string(), // base64 인코딩된 오디오
  text: z.string().optional(), // STT 결과
  format: z.string().default('wav'),
  sampleRate: z.number().default(48000),
  duration_ms: z.number().optional(),
});

// API 에러 스키마
export const ApiErrorSchema = z.object({
  error: z.string(),
  statusCode: z.number(),
  timestamp: z.string(),
  details: z.any().optional(),
});

// 타입 추출
export type User = z.infer<typeof UserSchema>;
export type Guild = z.infer<typeof GuildSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type VoiceRequest = z.infer<typeof VoiceRequestSchema>;
export type VoiceResponse = z.infer<typeof VoiceResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

// 환경변수 스키마
export const EnvSchema = z.object({
  // Discord
  DISCORD_TOKEN: z.string(),
  DISCORD_CLIENT_ID: z.string(),
  DISCORD_GUILD_ID: z.string().optional(),
  
  // API
  BFF_PORT: z.string().default('3001'),
  AI_WORKER_PORT: z.string().default('8000'),
  AUDIO_WORKER_PORT: z.string().default('8001'),
  
  // 데이터베이스
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  
  // AI 모델
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DEFAULT_LLM_MODEL: z.string().default('gpt-4'),
  
  // STT/TTS
  ELEVENLABS_API_KEY: z.string().optional(),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().optional(),
  
  // 보안
  JWT_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  
  // 환경
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof EnvSchema>;
