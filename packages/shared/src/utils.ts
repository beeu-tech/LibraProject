import { createHash } from 'crypto';

/**
 * 문자열을 SHA-256 해시로 변환
 */
export function hashString(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * 캐시 키 생성
 */
export function generateCacheKey(prefix: string, ...parts: string[]): string {
  const key = parts.join(':');
  return `${prefix}:${hashString(key)}`;
}

/**
 * 지연 함수
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 재시도 함수
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        throw lastError;
      }
      
      await delay(delayMs * attempt);
    }
  }
  
  throw lastError!;
}

/**
 * 안전한 JSON 파싱
 */
export function safeJsonParse<T>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return defaultValue;
  }
}

/**
 * 토큰 수 추정 (간단한 방법)
 */
export function estimateTokens(text: string): number {
  // 한국어: 평균 1.5자/토큰, 영어: 평균 4자/토큰
  const koreanChars = (text.match(/[가-힣]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  const otherChars = text.length - koreanChars - englishChars;
  
  return Math.ceil(
    (koreanChars / 1.5) + 
    (englishChars / 4) + 
    (otherChars / 3)
  );
}

/**
 * 응답 시간 포맷팅
 */
export function formatLatency(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    return `${(ms / 60000).toFixed(1)}m`;
  }
}

/**
 * 토큰 수 포맷팅
 */
export function formatTokens(count: number): string {
  if (count < 1000) {
    return `${count}`;
  } else if (count < 1000000) {
    return `${(count / 1000).toFixed(1)}K`;
  } else {
    return `${(count / 1000000).toFixed(1)}M`;
  }
}
