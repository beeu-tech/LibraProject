import crypto from 'crypto';

/**
 * HMAC-SHA256 서명 생성
 */
export function signRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  ts: string,
  nonce: string
): string {
  const payload = `${method}|${path}|${ts}|${nonce}|${crypto.createHash('sha256').update(body).digest('hex')}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * HMAC-SHA256 서명 검증
 */
export function verifySignature(
  secret: string,
  method: string,
  path: string,
  body: string,
  ts: string,
  nonce: string,
  sig: string
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const t = parseInt(ts, 10);
  
  // ±5분 드리프트 허용
  if (Math.abs(now - t) > 300) {
    return false;
  }
  
  const expected = signRequest(secret, method, path, body, ts, nonce);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

/**
 * 인증 헤더 생성
 */
export function createAuthHeaders(
  secret: string,
  method: string,
  path: string,
  body: string
) {
  console.log('createAuthHeaders called with:', {
    secret: secret ? `${secret.substring(0, 8)}...` : 'empty',
    method,
    path,
    bodyLength: body.length
  });
  
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const sig = signRequest(secret, method, path, body, ts, nonce);
  
  const headers = {
    'x-ts': ts,
    'x-nonce': nonce,
    'x-signature': sig,
  };
  
  console.log('Generated headers:', {
    'x-ts': ts,
    'x-nonce': nonce,
    'x-signature': `${sig.substring(0, 16)}...`
  });
  
  return headers;
}
