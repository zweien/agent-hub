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
    """启动时建表 + 插默认 agent 配置(本轮不用 Alembic)。"""
    # 确保所有 model 被导入,Base.metadata 才知道它们
    from app.models import event, session, user, agent_config  # noqa: F401
    Base.metadata.create_all(bind=engine)
    # 插默认气动 agent 配置(若表空)
    from app.models.agent_config import AgentConfig
    db = SessionLocal()
    try:
        if db.query(AgentConfig).count() == 0:
            db.add(AgentConfig(
                name="机翼气动优化助手(默认)",
                system_prompt=(
                    "你是机翼气动优化助手。你能:\n"
                    "1) 用 run_aero_tool 做单次气动分析(给定翼展/面积/迎角,返回CL/CDi/L_D);\n"
                    "2) 用 run_sweep_in_sandbox 做展弦比扫描找最优升阻比(在隔离沙箱跑)。\n"
                    "用户提需求时,先判断是否需要扫描;给出建议时附上数据支撑(具体数值)。\n"
                    "气动常识:大展弦比降低诱导阻力、提升升阻比;椭圆分布 Oswald≈1。"
                ),
                tools=["run_aero_tool", "run_sweep_in_sandbox"],
                model="deepseek-v4-flash", mode="standard",
                owner_id="admin", is_published=True,
            ))
            db.commit()
    finally:
        db.close()
