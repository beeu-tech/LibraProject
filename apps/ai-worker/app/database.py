import os
import asyncio
import time
from urllib.parse import urlparse, urlunparse
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import structlog

logger = structlog.get_logger()

def _redact_db_url(url: str) -> str:
    """데이터베이스 URL에서 비밀값 제거"""
    try:
        p = urlparse(url)
        # 유저/패스워드 레드액션
        netloc = p.hostname or ''
        if p.port:
            netloc += f":{p.port}"
        redacted = p._replace(netloc=netloc, username=None, password=None)
        return urlunparse(redacted)
    except Exception:
        return "<redacted>"

def _build_asyncpg_url(raw_url: str, force_ssl: bool = True) -> str:
    """안전한 asyncpg URL 빌드"""
    logger.info("Building asyncpg URL", raw_url=raw_url, force_ssl=force_ssl)
    
    p = urlparse(raw_url)
    if p.scheme not in ("postgresql", "postgresql+asyncpg"):
        raise ValueError("unsupported scheme (must be postgresql:// or postgresql+asyncpg://)")
    
    # 호스트 화이트리스트 검사
    allow_hosts = os.getenv("ALLOWED_DB_HOSTS", "").split(",") if os.getenv("ALLOWED_DB_HOSTS") else []
    if allow_hosts and (p.hostname not in allow_hosts):
        raise ValueError(f"db host not allowed: {p.hostname}")

    scheme = "postgresql+asyncpg"
    query = p.query
    logger.info("Original query", query=query)
    
    # asyncpg는 sslmode 대신 ssl 파라미터를 사용
    if force_ssl and "ssl=" not in query:
        query = (query + "&" if query else "") + "ssl=require"
        logger.info("Added ssl parameter", new_query=query)

    async_url = urlunparse((scheme, p.netloc, p.path, p.params, query, p.fragment))
    logger.info("Final asyncpg URL", url=async_url)
    return async_url

async def init_db():
    """데이터베이스 초기화 (보안 강화)"""
    try:
        # 0) 환경변수 체크 (fail-fast)
        raw_url = os.getenv("DATABASE_URL")
        if not raw_url:
            raise RuntimeError("DATABASE_URL is not set - fail-fast for security")

        # asyncpg용 URL 빌드
        database_url = _build_asyncpg_url(raw_url, force_ssl=bool(int(os.getenv("DB_SSL_REQUIRE", "1"))))
        redacted = _redact_db_url(database_url)
        logger.info("DB connecting", url=redacted)
        
        engine = create_async_engine(
            database_url,
            pool_pre_ping=True,
            pool_size=int(os.getenv("DB_POOL_SIZE", "5")),
            max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "5")),
            pool_timeout=int(os.getenv("DB_POOL_TIMEOUT", "30")),
            connect_args={
                "ssl": "disable" if not bool(int(os.getenv("DB_SSL_REQUIRE", "0"))) else "require"
            }
        )
        
        async with engine.begin() as conn:
            # 타임아웃/로캘 등 세션 파라미터
            await conn.execute(text(f"SET statement_timeout = {int(os.getenv('DB_STMT_TIMEOUT_MS', '15000'))}"))

            # === 스키마 생성 (운영에서는 DDL 금지) ===
            allow_ddl = os.getenv("ALLOW_DDL", "0") == "1"
            if not allow_ddl:
                logger.info("DDL skipped (ALLOW_DDL=0) - use Alembic for production")
                return
            
            # pgvector 확장 확인 (DDL 허용 시에만) - 주석 처리 (필요시에만 사용)
            # await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    discord_user_id VARCHAR(255) UNIQUE NOT NULL,
                    username VARCHAR(255),
                    locale VARCHAR(10) DEFAULT 'ko',
                    voice_prefs TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """))
            
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS guilds (
                    id SERIAL PRIMARY KEY,
                    discord_guild_id VARCHAR(255) UNIQUE NOT NULL,
                    name VARCHAR(255),
                    policies TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """))
            
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    channel_id VARCHAR(255),
                    mode VARCHAR(20) DEFAULT 'text',
                    state TEXT,
                    last_seen TIMESTAMP DEFAULT NOW(),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            
            # ✅ 타입 일치: messages.user_id를 INTEGER(FK)로 수정
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    session_id INTEGER REFERENCES sessions(id),
                    role VARCHAR(20) NOT NULL,
                    content TEXT NOT NULL,
                    tokens INTEGER DEFAULT 0,
                    latency_ms INTEGER,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            
            # ✅ 타입 일치: memories.user_id를 INTEGER(FK)로 수정
            # Vector 컬럼 주석 처리 (pgvector extension 필요시에만 사용)
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS memories (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    scope VARCHAR(20) DEFAULT 'user',
                    content TEXT,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            
            # 인덱스 생성
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_user_id)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_guilds_discord_id ON guilds(discord_guild_id)"))
            
        await engine.dispose()
        logger.info("DB init done")
        
    except Exception as e:
        # 비밀값 노출 금지
        logger.error("DB init failed", error=str(e))
        raise
