"""
Docker Secrets 및 환경변수 로더 유틸리티
"""

import os
from pathlib import Path
import structlog

logger = structlog.get_logger(__name__)


def load_secret(env_var_name: str, required: bool = True) -> str | None:
    """
    환경변수 또는 Docker Secrets 파일에서 비밀값 로드
    
    우선순위:
    1. {ENV_VAR_NAME}_FILE 환경변수가 가리키는 파일
    2. {ENV_VAR_NAME} 환경변수 직접 값
    3. required=True면 에러, False면 None 반환
    
    Args:
        env_var_name: 환경변수 이름 (예: "DISCORD_TOKEN")
        required: 필수 여부 (True면 없을 때 RuntimeError)
        
    Returns:
        비밀값 또는 None
    """
    # 1. Secrets 파일 확인
    file_env = f"{env_var_name}_FILE"
    secret_file = os.getenv(file_env)
    
    if secret_file:
        try:
            secret_path = Path(secret_file)
            if secret_path.exists():
                value = secret_path.read_text().strip()
                if value and value != f"placeholder_{env_var_name.lower()}":
                    logger.info(f"Loaded {env_var_name} from secret file", 
                              file=secret_file)
                    return value
                else:
                    logger.warning(f"Secret file contains placeholder", 
                                 env=env_var_name, file=secret_file)
            else:
                logger.warning(f"Secret file not found", 
                             env=env_var_name, file=secret_file)
        except Exception as e:
            logger.error(f"Failed to read secret file", 
                       env=env_var_name, error=str(e))
    
    # 2. 환경변수 직접 확인
    value = os.getenv(env_var_name)
    if value:
        logger.info(f"Loaded {env_var_name} from environment variable")
        return value
    
    # 3. 필수인데 없으면 에러
    if required:
        raise RuntimeError(
            f"{env_var_name} is not set. "
            f"Set {env_var_name} env var or {file_env} pointing to secret file."
        )
    
    logger.debug(f"{env_var_name} not found (optional)", env=env_var_name)
    return None


def load_all_secrets() -> dict[str, str]:
    """
    모든 필수 비밀값을 로드하여 딕셔너리로 반환
    
    Returns:
        비밀값 딕셔너리 {env_var_name: value}
    """
    secrets = {}
    
    # 필수 비밀값 목록
    required_secrets = [
        "WORKER_SHARED_SECRET",
        "DATABASE_URL",
    ]
    
    # 선택적 비밀값 목록
    optional_secrets = [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "DISCORD_TOKEN",
        "ELEVENLABS_API_KEY",
        "AZURE_SPEECH_KEY",
    ]
    
    # 필수 비밀값 로드
    for secret_name in required_secrets:
        secrets[secret_name] = load_secret(secret_name, required=True)
    
    # 선택적 비밀값 로드
    for secret_name in optional_secrets:
        value = load_secret(secret_name, required=False)
        if value:
            secrets[secret_name] = value
    
    logger.info("All secrets loaded", 
               required_count=len(required_secrets),
               optional_count=len([s for s in optional_secrets if s in secrets]))
    
    return secrets


# 사용 예시
if __name__ == "__main__":
    # 단일 비밀값 로드
    try:
        db_url = load_secret("DATABASE_URL", required=True)
        print(f"DB URL loaded: {db_url[:20]}...")
    except RuntimeError as e:
        print(f"Error: {e}")
    
    # 모든 비밀값 로드
    all_secrets = load_all_secrets()
    print(f"Loaded {len(all_secrets)} secrets")

