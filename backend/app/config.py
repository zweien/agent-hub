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
    llm_max_tokens: int = Field(default=16000)  # 推理模型 reasoning 计入 max_tokens,4000 会被复杂任务的推理占满导致实际回复为空
    # 模型输入上下文窗口(deepagents SummarizationMiddleware 用):
    #   compute_summarization_defaults 检 model.profile.max_input_tokens,有则走
    #   fraction 路径(trigger=85% / keep=10%,自适应);无则 fallback 到 170k fixed(偏大)。
    #   deepseek-v4-flash ~64k;按真实窗口填,不同模型可经 .env 覆盖。
    llm_context_window: int = Field(default=65536)

    # —— 沙箱(§3,A2 会话级容器)——
    # 默认用预装了气动依赖的自定义镜像(避免 per-session 容器每次 pip install aerosandbox 耗时/OOM)
    sandbox_image: str = Field(default="agent-hub-sandbox:latest")
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


# —— 模型目录(§8 模型选择)——
# 本地覆盖层:键 = 模型 id(与网关 /v1/models 返回的 id 对齐),值 = 元数据。
# GET /models 会拉网关拿 id 列表,再 merge 这里;网关有但这里没有的用全局兜底。
# 加新模型(已在网关注册):在此加一项即可,无需改代码逻辑。
# 加新模型(网关也未有):先在网关注册,再在此加覆盖(否则只有兜底值)。
MODELS: dict[str, dict] = {
    "deepseek-v4-flash": {
        "label": "DeepSeek V4 Flash",
        "max_tokens": 16000,  # reasoning 计入 max_tokens,留足空间
        "context_window": 65536,
        "supports_reasoning": True,
    },
    "MiniMax-M2.7": {
        "label": "MiniMax M2.7",
        "max_tokens": 8000,
        "context_window": 65536,
        "supports_reasoning": False,
    },
    "MiniMax-M2.5": {
        "label": "MiniMax M2.5",
        "max_tokens": 8000,
        "context_window": 65536,
        "supports_reasoning": False,
    },
}


def resolve_model(model_id: str) -> dict:
    """按模型 id 解析元数据(max_tokens/context_window/label/supports_reasoning)。

    目录优先(MODELS 覆盖层),未命中回落到全局 LLM_MAX_TOKENS/LLM_CONTEXT_WINDOW。
    build_agent 构造 ChatOpenAI 时调此函数,不再直接读全局字段。
    """
    s = get_settings()
    entry = MODELS.get(model_id)
    if entry:
        return {
            "id": model_id,
            "label": entry["label"],
            "max_tokens": entry["max_tokens"],
            "context_window": entry["context_window"],
            "supports_reasoning": entry["supports_reasoning"],
        }
    # 兜底:未知模型用全局默认,label 用原 id
    return {
        "id": model_id,
        "label": model_id,
        "max_tokens": s.llm_max_tokens,
        "context_window": s.llm_context_window,
        "supports_reasoning": False,
    }
