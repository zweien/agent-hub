"""SandboxTemplate ORM(沙箱配置模板,grilling 决策:预置包运行时装 + 硬件配置)。

一个模板 = 沙箱环境的可复用配置:
  - base_image:用哪个镜像(默认 agent-hub-sandbox,已预装 aerosandbox)
  - pip_packages:会话起容器后 pip install 的额外包(运行时装,不 docker build)
  - env_vars:容器环境变量
  - cpu_limit/mem_limit/gpu_count/shm_size:硬件限制(docker run 参数)

模板挂在 AgentConfig 上(agent 配置选一个模板),会话起容器时按模板创建。
"""
from __future__ import annotations

import uuid
from sqlalchemy import Column, String, Text, Boolean, DateTime, Float, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.db import Base


def _new_id() -> str:
    return "sb_" + uuid.uuid4().hex[:16]


class SandboxTemplate(Base):
    __tablename__ = "sandbox_templates"

    id = Column(String(64), primary_key=True, default=_new_id)
    name = Column(String(128), nullable=False)
    base_image = Column(String(256), nullable=False, default="agent-hub-sandbox:latest")
    # 运行时装的额外 pip 包(镜像已预装的无需重复,如 aerosandbox)
    pip_packages = Column(JSONB, nullable=False, default=list)   # ["scipy", "pandas"]
    env_vars = Column(JSONB, nullable=False, default=dict)       # {"OMP_NUM_THREADS": "4"}
    # 硬件限制(nullable=不限,用宿主机全部资源)
    cpu_limit = Column(Float, nullable=True)    # 核数,如 2.0(nano_cpus = cpu_limit * 1e9)
    mem_limit = Column(String(32), nullable=True)  # 如 "4g"/"512m"
    gpu_count = Column(Integer, nullable=False, default=0)  # 0=不用,>0=透传 N 张,"all" 另存
    shm_size = Column(String(32), nullable=True)  # 如 "2g"
    owner_id = Column(String(64), nullable=False)
    is_published = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "base_image": self.base_image,
            "pip_packages": self.pip_packages or [], "env_vars": self.env_vars or {},
            "cpu_limit": self.cpu_limit, "mem_limit": self.mem_limit,
            "gpu_count": self.gpu_count, "shm_size": self.shm_size,
            "owner_id": self.owner_id, "is_published": self.is_published,
        }
