import crypto from 'crypto';

/**
 * 요청 서명 생성
 */
export function signRequest(
  secret: string, 
  method: string, 
  path: string, 
  body: string, 
  timestamp: string, 
  nonce: string
): string {
  const payload = `${method}|${path}|${timestamp}|${nonce}|${crypto.createHash('sha256').update(body).digest('hex')}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * 서명 검증
 */
export function verifySignature(
  secret: string, 
  method: string, 
  path: string, 
  body: string, 
  timestamp: string, 
  nonce: string, 
  signature: string
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const t = parseInt(timestamp, 10);
  
  // 타임스탬프 드리프트 허용 (±5분)
  if (Math.abs(now - t) > 300) {
    return false;
  }
  
  const expected = signRequest(secret, method, path, body, timestamp, nonce);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * 요청 헤더 생성
 */
export function createAuthHeaders(
  secret: string,
  method: string,
  path: string,
  body: string
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const signature = signRequest(secret, method, path, body, timestamp, nonce);
  
  return {
    'x-ts': timestamp,
    'x-nonce': nonce,
    'x-signature': signature,
  };
}
