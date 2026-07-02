"""数据层:SQLAlchemy engine + SessionLocal + Base(§2.5 事件流持久化)。

本轮用同步 SQLAlchemy(脚手架阶段,避免引入 asyncpg 复杂度)。
agent 执行是 async task,但 DB 写入用同步 session(在 thread executor 里调用或短事务够快)。
"""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def get_db():
    """FastAPI 依赖:获取 DB session(同步)。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """启动时建表(本轮不用 Alembic)。"""
    # 确保所有 model 被导入,Base.metadata 才知道它们
    from app.models import event, session  # noqa: F401
    Base.metadata.create_all(bind=engine)
