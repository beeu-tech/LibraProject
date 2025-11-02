"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signRequest = signRequest;
exports.verifySignature = verifySignature;
exports.createAuthHeaders = createAuthHeaders;
const crypto_1 = __importDefault(require("crypto"));
/**
 * 요청 서명 생성
 */
function signRequest(secret, method, path, body, timestamp, nonce) {
    const payload = `${method}|${path}|${timestamp}|${nonce}|${crypto_1.default.createHash('sha256').update(body).digest('hex')}`;
    return crypto_1.default.createHmac('sha256', secret).update(payload).digest('hex');
}
/**
 * 서명 검증
 */
function verifySignature(secret, method, path, body, timestamp, nonce, signature) {
    const now = Math.floor(Date.now() / 1000);
    const t = parseInt(timestamp, 10);
    // 타임스탬프 드리프트 허용 (±5분)
    if (Math.abs(now - t) > 300) {
        return false;
    }
    const expected = signRequest(secret, method, path, body, timestamp, nonce);
    return crypto_1.default.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
/**
 * 요청 헤더 생성
 */
function createAuthHeaders(secret, method, path, body) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto_1.default.randomUUID();
    const signature = signRequest(secret, method, path, body, timestamp, nonce);
    return {
        'x-ts': timestamp,
        'x-nonce': nonce,
        'x-signature': signature,
    };
}
//# sourceMappingURL=signing.js.map