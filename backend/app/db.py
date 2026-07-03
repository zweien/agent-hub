"""数据层:SQLAlchemy engine + SessionLocal + Base(§2.5 事件流持久化)。

本轮用同步 SQLAlchemy(脚手架阶段,避免引入 asyncpg 复杂度)。
agent 执行是 async task,但 DB 写入用同步 session(在 thread executor 里调用或短事务够快)。
"""
from __future__ import annotations

import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import get_settings

logger = logging.getLogger("db")

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


def _ensure_column(table: str, column: str, ddl_type: str) -> None:
    """幂等加列(无 Alembic,开发期用):若列不存在则 ALTER TABLE ADD COLUMN。"""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if not insp.has_table(table):
        return
    existing = {c["name"] for c in insp.get_columns(table)}
    if column not in existing:
        with engine.begin() as conn:
            conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {ddl_type}'))
        logger.info("迁移:已加列 %s.%s", table, column)


def init_db():
    """启动时建表 + 插默认 agent 配置 + 样例 skill(本轮不用 Alembic)。

    create_all 不改已有表结构,故对新增列做幂等 ALTER(开发期迁移)。
    """
    # 确保所有 model 被导入,Base.metadata 才知道它们
    from app.models import event, session, user, agent_config, skill  # noqa: F401
    Base.metadata.create_all(bind=engine)
    # 幂等迁移:agent_configs 加 skill_ids(已有表,create_all 不会加列)
    _ensure_column("agent_configs", "skill_ids", "JSONB NOT NULL DEFAULT '[]'::jsonb")
    db = SessionLocal()
    try:
        # 插默认气动 agent 配置(若表空)
        from app.models.agent_config import AgentConfig
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

        # 插样例 skill(若表空)——含文件系统内容(供同步进容器)
        from app.models.skill import Skill
        if db.query(Skill).count() == 0:
            sample = Skill(
                name="气动分析技能",
                description="机翼气动特性分析。涉及升力系数、阻力、升阻比、展弦比、气动优化时使用。",
                content=(
                    "# 气动分析技能\n\n"
                    "## 气动学基本结论\n"
                    "- 展弦比(AR)增大 → 诱导阻力降低 → 升阻比(L/D)增大\n"
                    "- 椭圆升力分布的 Oswald 效率因子 e ≈ 1.0(理论最优)\n"
                    "- 薄翼理论升力线斜率 ≈ 2π·AR/(AR+2) per rad\n"
                    "- 巡航升阻比典型值:滑翔机 > 30,运输机 ~15-20\n\n"
                    "## 使用指引\n"
                    "给出翼展/面积/迎角时:算 AR=span²/S → 估 CL → 判断 L/D 量级 → 建议增大展弦比。"
                ),
                scripts=[],
                owner_id="admin", is_published=True,
            )
            db.add(sample)
            db.commit()
            # 同步写文件系统(供会话容器同步用)——传 name/description 以生成合规 frontmatter
            from app.sandbox_mgr.skill_store import save_skill_files
            save_skill_files(sample.id, sample.content, {}, name=sample.name, description=sample.description)
    finally:
        db.close()
