"""集中配置:从 .env 读取所有运行参数(§2.2 配置层)。

用 pydantic-settings 统一管理,避免散落的 os.getenv。
密钥只在内存,不进日志(脱敏方法见 settings.summary)。
"""
from __future__ import annotations

from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # —— LLM(§2 / 决策#5)——
    llm_base_url: str = Field(default="http://192.168.2.220:3000/v1")
    llm_api_key: str = Field(default="")
    llm_model: str = Field(default="deepseek-v4-flash")
    llm_max_tokens: int = Field(default=4000)  # 推理模型需较大预算(§9 发现)

    # —— 沙箱(§3)——
    sandbox_image: str = Field(default="ghcr.io/agent-infra/sandbox:latest")
    sandbox_gpu: bool = Field(default=False)
    # Compose 里 sandbox 服务地址(容器间网络);本地直跑用 http://localhost:8080
    sandbox_base_url: str = Field(default="http://sandbox:8080")
    # sandbox 对浏览器/前端的公开地址(接管 §2.3 时返回给前端)
    # 容器间用 sandbox:8080,但浏览器访问宿主机要用 localhost:8080
    sandbox_public_url: str = Field(default="http://localhost:8080")

    # —— 数据层(§4.3)——
    database_url: str = Field(default="postgresql+psycopg2://agenthub:agenthub@db:5432/agenthub")
    redis_url: str = Field(default="redis://redis:6379/0")

    # —— 应用 ——
    app_name: str = Field(default="Agent Hub V1")
    cors_origins: str = Field(default="*")

    # —— 鉴权(§7,最简硬编码三账号)——
    token_secret: str = Field(default="agent-hub-dev-secret-change-in-prod")
    token_expire_hours: int = Field(default=24)
    # 硬编码账号:"username:password:role" 列表(V1 最简,不搞用户管理)
    auth_accounts: str = Field(
        default="admin:admin123:admin,builder:builder123:builder,user:user123:user"
    )

    def accounts(self) -> dict:
        """解析硬编码账号 → {username: {password, role}}。"""
        result = {}
        for entry in self.auth_accounts.split(","):
            parts = entry.strip().split(":")
            if len(parts) == 3:
                result[parts[0]] = {"password": parts[1], "role": parts[2]}
        return result

    def summary(self) -> dict:
        """脱敏摘要(供 /health,不泄露 key)。"""
        k = self.llm_api_key
        masked = (k[:6] + "***" + k[-4:]) if len(k) > 12 else "(未设置)" if not k else "(过短)"
        return {
            "app": self.app_name,
            "llm_model": self.llm_model,
            "llm_base_url": self.llm_base_url,
            "llm_api_key": masked,
            "llm_max_tokens": self.llm_max_tokens,
            "sandbox_image": self.sandbox_image,
            "sandbox_base_url": self.sandbox_base_url,
            "sandbox_public_url": self.sandbox_public_url,
            "sandbox_gpu": self.sandbox_gpu,
            "database_url": self.database_url.replace(
                self.database_url.split("@")[0].split("//")[-1], "***"
            ) if "@" in self.database_url else self.database_url,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
