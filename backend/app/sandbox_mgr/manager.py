"""Sandbox 控制面(§3,HTTP 后端版——POC 架构优化)。

迁移自 poc/sandbox/manager.py,改为经 sandbox HTTP API 执行(§9 发现):
  - 生命周期:本轮 sandbox 作为 Compose 常驻服务,控制面不做 acquire/release
  - exec / put_file 走 sandbox HTTP API(/v1/shell/exec),无需 docker socket
  - 保留 ExecResult 接口(事件流 §2.5 的 sandbox_exec payload)

未来(§6.4):补 DockerDialect(按需起停容器)+ K8sDialect,接口不变。
"""
from __future__ import annotations

import base64
import logging
import time
import urllib.request
import json
from dataclasses import dataclass, asdict
from typing import Callable, Optional

logger = logging.getLogger("sandbox_mgr")


# 回调类型:每次 exec 后被调用,传入 ExecResult(供调用方写事件流 §2.5)。
# sandbox_mgr 不依赖 agent_runtime(§0 边界),由调用方注入回调。
ExecObserver = Callable[["ExecResult"], None]


@dataclass
class ExecResult:
    """容器内命令执行结果(进事件流 §2.5 的 sandbox_exec 事件 payload)。"""
    exit_code: int
    stdout: str
    stderr: str
    duration_s: float
    command: str

    def to_dict(self) -> dict:
        return asdict(self)


class SandboxManager:
    """
    经 sandbox HTTP API 控制沙箱(本轮:Compose 常驻服务)。

    本轮不做会话→容器映射(单常驻 sandbox);后续多实例时再按 session_id 路由。
    """

    def __init__(self, base_url: str = "http://sandbox:8080", api_key: Optional[str] = None,
                 on_exec: Optional[ExecObserver] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.on_exec = on_exec  # 每次 exec 后回调(供调用方持久化为 sandbox_exec 事件)
        self.exec_log: list[ExecResult] = []

    def _post(self, path: str, payload: dict) -> dict:
        url = f"{self.base_url}{path}"
        data = json.dumps(payload).encode()
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(url, data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=300) as resp:
            return json.loads(resp.read())

    def exec(self, command: str, workdir: str = "/home/gem") -> ExecResult:
        """经 /v1/shell/exec 在 sandbox 内执行命令,收集结果(§3 职责4/5)。"""
        t0 = time.time()
        resp = self._post("/v1/shell/exec", {"command": f"cd {workdir} && {command}"})
        duration = time.time() - t0
        data = resp.get("data", {})
        result = ExecResult(
            exit_code=int(data.get("exit_code", -1)),
            stdout=str(data.get("output", "")),
            stderr="",  # sandbox API 不分 stdout/stderr,合并在 output
            duration_s=round(duration, 3),
            command=command,
        )
        self.exec_log.append(result)
        if self.on_exec is not None:
            try:
                self.on_exec(result)  # 通知调用方(写事件流 §5.1)
            except Exception:
                logger.debug("on_exec 回调异常(已忽略)", exc_info=True)
        logger.info("exec exit=%d %.3fs | %s", result.exit_code, duration, command[:80])
        return result

    def put_file(self, path: str, data: bytes):
        """经 exec + base64 写文件到 sandbox(sandbox HTTP file write 端点待确认,用 exec 最稳)。"""
        b64 = base64.b64encode(data).decode()
        target_dir = path.rsplit("/", 1)[0] or "/"
        r = self.exec(f"mkdir -p {target_dir} && echo {b64} | base64 -d > {path}")
        if r.exit_code != 0:
            raise RuntimeError(f"put_file 失败({path}): {r.stdout}")

    def get_log(self) -> list[dict]:
        """取执行日志(供事件流回放 §5.1)。"""
        return [r.to_dict() for r in self.exec_log]


# 兼容 POC 调用方(acquire/release 在 HTTP 后端是 no-op,因为 Compose 常驻)
def get_manager(base_url: str = "http://sandbox:8080", on_exec: Optional[ExecObserver] = None) -> SandboxManager:
    return SandboxManager(base_url=base_url, on_exec=on_exec)
