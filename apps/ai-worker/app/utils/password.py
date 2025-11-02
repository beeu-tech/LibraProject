"""
비밀번호 단방향 암호화 유틸리티
bcrypt를 사용한 안전한 비밀번호 해싱 및 검증
"""

import bcrypt
import structlog

logger = structlog.get_logger(__name__)


def hash_password(password: str, rounds: int = 12) -> str:
    """
    비밀번호를 bcrypt로 해싱
    
    Args:
        password: 평문 비밀번호
        rounds: bcrypt 라운드 수 (기본 12, 높을수록 안전하지만 느림)
        
    Returns:
        해싱된 비밀번호 (문자열)
    """
    if not password:
        raise ValueError("Password cannot be empty")
    
    if len(password) > 72:
        # bcrypt는 최대 72바이트까지만 처리
        logger.warning("Password truncated to 72 bytes")
        password = password[:72]
    
    try:
        # Salt 생성 및 해싱
        salt = bcrypt.gensalt(rounds=rounds)
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        
        logger.debug("Password hashed successfully", rounds=rounds)
        return hashed.decode('utf-8')
        
    except Exception as e:
        logger.error("Failed to hash password", error=str(e))
        raise


def verify_password(password: str, hashed: str) -> bool:
    """
    비밀번호 검증 (constant-time 비교)
    
    Args:
        password: 평문 비밀번호
        hashed: 해싱된 비밀번호
        
    Returns:
        일치 여부 (True/False)
    """
    if not password or not hashed:
        return False
    
    try:
        # Timing-safe 비교
        result = bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
        
        if not result:
            logger.warning("Password verification failed")
        
        return result
        
    except Exception as e:
        logger.error("Password verification error", error=str(e))
        return False


def needs_rehash(hashed: str, target_rounds: int = 12) -> bool:
    """
    비밀번호가 재해싱이 필요한지 확인
    (이전 라운드 수가 목표보다 낮으면 재해싱 권장)
    
    Args:
        hashed: 해싱된 비밀번호
        target_rounds: 목표 라운드 수
        
    Returns:
        재해싱 필요 여부
    """
    try:
        # bcrypt 해시에서 라운드 수 추출 ($2b$12$... 형식)
        parts = hashed.split('$')
        if len(parts) < 4:
            return True
        
        current_rounds = int(parts[2])
        return current_rounds < target_rounds
        
    except Exception as e:
        logger.error("Failed to check rehash", error=str(e))
        return False


# 사용 예시
if __name__ == "__main__":
    # 비밀번호 해싱
    plain_password = "my_secure_password_123"
    hashed_password = hash_password(plain_password)
    print(f"Hashed: {hashed_password}")
    
    # 비밀번호 검증
    is_valid = verify_password(plain_password, hashed_password)
    print(f"Valid: {is_valid}")
    
    # 잘못된 비밀번호 검증
    is_invalid = verify_password("wrong_password", hashed_password)
    print(f"Invalid: {is_invalid}")
    
    # 재해싱 필요 여부
    needs_update = needs_rehash(hashed_password, target_rounds=14)
    print(f"Needs rehash: {needs_update}")

