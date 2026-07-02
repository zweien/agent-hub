"""
Sandbox Manager 控制面雏形(§3)。

agent-infra/sandbox 只是数据面(运行时),没有开源 manager。
本模块是平台自建的"最薄控制面",承担:
  1. 会话→容器映射(§3 职责1)
  2. 生命周期:按需创建/回收容器(§3 职责2)
  3. 在容器内执行命令并收集日志(§3 职责4/5)
  4. GPU 透传(§3 职责3)——标记为待 GPU 机器启用

设计(§6.4 统一抽象层):
  SandboxManager 接口固定(acquire/exec/release),V1 用 DockerDialect 实现,
  未来切 K8s 只换 K8sDialect,调用方不变。
"""
from __future__ import annotations

import time
import logging
from dataclasses import dataclass, field, asdict
from typing import Optional

import docker
from docker.errors import NotFound, APIError

logger = logging.getLogger("sandbox_mgr")

SANDBOX_IMAGE = "ghcr.io/agent-infra/sandbox:latest"
CONTAINER_PREFIX = "agent-sandbox-"


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


@dataclass
class SandboxSession:
    """会话→容器映射记录(§3 职责1)。"""
    session_id: str
    container_id: str
    container_name: str
    created_at: float
    gpu: bool = False
    exec_log: list[ExecResult] = field(default_factory=list)


class SandboxManager:
    """
    统一抽象层(§6.4):会话级沙箱生命周期 + 执行。
    V1 后端 = docker-py(单机);生产后端 = K8s(待实现,接口不变)。
    """

    def __init__(self, backend: str = "docker", image: str = SANDBOX_IMAGE):
        assert backend == "docker", "V1 仅实现 docker 后端;K8s 后端待生产化"
        self.backend = backend
        self.image = image
        self._client = docker.from_env()
        self._sessions: dict[str, SandboxSession] = {}

    # —— 生命周期 ——
    def acquire(self, session_id: str, gpu: bool = False) -> str:
        """
        为会话获取/复用一个 sandbox 容器,返回容器名(可据此连 API)。
        复用:同一 session_id 已有容器则直接返回(§2.3 会话亲和)。
        """
        if session_id in self._sessions:
            logger.info("复用会话 %s 的容器", session_id)
            return self._sessions[session_id].container_name

        name = f"{CONTAINER_PREFIX}{session_id}"
        # §3 职责3:GPU 透传(device_requests)——待 GPU 机器启用
        device_requests = None
        if gpu:
            try:
                from docker.types import DeviceRequest
                device_requests = [DeviceRequest(count="all", capabilities=[["gpu"]])]
                logger.warning("启用 GPU 透传(本机若无 GPU 将启动失败)")
            except Exception as e:
                logger.warning("GPU 透传配置失败,降级 CPU:%s", e)

        logger.info("创建 sandbox 容器: %s (gpu=%s)", name, gpu)
        container = self._client.containers.run(
            self.image,
            name=name,
            detach=True,
            device_requests=device_requests,
            # sandbox 内服务对外可访问(接管前提 §2.3)
            publish_all_ports=True,
            tty=True,
            stdin_open=True,
        )
        self._sessions[session_id] = SandboxSession(
            session_id=session_id,
            container_id=container.id,
            container_name=name,
            created_at=time.time(),
            gpu=gpu,
        )
        # 给容器一点启动时间
        time.sleep(2)
        return name

    # —— 执行(进事件流 §2.5)——
    def exec(self, session_id: str, command: str, workdir: str = "/workspace") -> ExecResult:
        """在会话对应容器内执行命令,收集结果(§3 职责4/5)。
        workdir 不存在时自动创建(兼容不同镜像)。"""
        if session_id not in self._sessions:
            raise KeyError(f"会话 {session_id} 无关联容器,先 acquire()")
        container = self._client.containers.get(self._sessions[session_id].container_id)

        # 确保 workdir 存在(不同镜像默认目录不同)
        container.exec_run(["bash", "-lc", f"mkdir -p {workdir}"])

        t0 = time.time()
        exit_code, output = container.exec_run(
            ["bash", "-lc", command], workdir=workdir, demux=True
        )
        duration = time.time() - t0
        stdout = (output[0].decode("utf-8", "replace") if output and output[0] else "")
        stderr = (output[1].decode("utf-8", "replace") if output and output[1] else "")
        result = ExecResult(
            exit_code=int(exit_code), stdout=stdout, stderr=stderr,
            duration_s=round(duration, 3), command=command,
        )
        self._sessions[session_id].exec_log.append(result)
        logger.info("exec[%s] exit=%d %.3fs | %s", session_id, exit_code, duration, command[:80])
        return result

    # —— 文件拷入(把 run_aero 等工具代码放进容器)——
    def put_file(self, session_id: str, path: str, data: bytes):
        """把文件写入容器指定路径(path 含目录时自动创建目录)。"""
        container = self._client.containers.get(self._sessions[session_id].container_id)
        import io, tarfile
        target_dir = path.rsplit("/", 1)[0] or "/"
        fname = path.rsplit("/", 1)[-1]
        # 先确保目标目录存在(不同镜像默认目录不同)
        container.exec_run(["bash", "-lc", f"mkdir -p {target_dir}"])
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as tar:
            info = tarfile.TarInfo(name=fname)
            info.size = len(data)
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(data))
        stream.seek(0)
        container.put_archive(target_dir, stream)

    # —— 回收 ——
    def release(self, session_id: str, destroy: bool = False):
        """释放会话(destroy=True 销毁容器,False 仅解绑留待复用)。"""
        sess = self._sessions.pop(session_id, None)
        if not sess:
            return
        try:
            container = self._client.containers.get(sess.container_id)
            if destroy:
                container.remove(force=True)
                logger.info("销毁容器 %s", sess.container_name)
            else:
                container.stop(timeout=5)
                logger.info("停止容器 %s(保留可复用)", sess.container_name)
        except NotFound:
            logger.info("容器 %s 已不存在", sess.container_name)

    def get_log(self, session_id: str) -> list[dict]:
        """取会话执行日志(供事件流回放 §5.1)。"""
        return [r.to_dict() for r in self._sessions.get(session_id, SandboxSession("", "", "", 0)).exec_log]


if __name__ == "__main__":
    # POC 自测:起容器 → 跑命令 → 装包 → 回收
    import sys, json
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    mgr = SandboxManager()
    sid = "poc-aero-001"
    try:
        name = mgr.acquire(sid, gpu=False)
        print(f"容器就绪: {name}")
        r = mgr.exec(sid, "python3 --version && echo 'sandbox ready'")
        print(f"exit={r.exit_code}\nstdout:\n{r.stdout}")
        if r.stderr.strip():
            print(f"stderr:\n{r.stderr}")
    finally:
        mgr.release(sid, destroy=True)
        print("已回收")
