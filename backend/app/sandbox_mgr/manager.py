"""Sandbox 控制面(§3,会话级容器版——A2 决策)。

经 docker-py 管理每会话独立容器(1会话=1容器):
  - acquire: 会话首条消息时起容器(复用已有),publish_all_ports 供接管
  - exec/put_file: docker exec_run / put_archive(不经 HTTP,无需端口映射池)
  - release: 会话空闲超时/取消时回收容器

依赖:docker.sock 挂载进后端容器(compose 配置)。docker-py 已在 requirements。
移植自 poc/sandbox/manager.py,补 on_exec 回调(写 sandbox_exec 事件 §5.1)。

注意:exec/put_file 签名带 session_id(每会话独立容器)。
"""
from __future__ import annotations

import io
import logging
import tarfile
import time
from dataclasses import dataclass, asdict
from typing import Callable, Optional

import docker
from docker.errors import NotFound, APIError

logger = logging.getLogger("sandbox_mgr")

CONTAINER_PREFIX = "agent-sandbox-"


# 每次 exec 后被调用,供调用方写事件流(§5.1)。
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
    """会话级容器控制面(1会话=1容器,docker-py 后端)。"""

    def __init__(self, image: str = "ghcr.io/agent-infra/sandbox:latest", on_exec: Optional[ExecObserver] = None):
        self.image = image
        # exec observer 按 session_id 路由(单例 manager 服务多会话,每会话写各自事件流)。
        # on_exec 参数保留向后兼容(若有,作为无 session 注册时的默认回调)。
        self._exec_observers: dict[str, ExecObserver] = {}
        self._default_observer: Optional[ExecObserver] = on_exec
        self._client = docker.from_env()
        # session_id → {"container_id", "name"}
        self._sessions: dict[str, dict] = {}

    def register_exec_observer(self, session_id: str, cb: ExecObserver) -> None:
        """注册某会话的 exec observer(每次该会话 exec 调用 cb,写 sandbox_exec 事件 §5.1)。

        取代旧的单一 on_exec 字段:单例 manager 服务多会话,每会话需独立 observer。
        """
        self._exec_observers[session_id] = cb

    def unregister_exec_observer(self, session_id: str) -> None:
        """注销会话 observer(会话结束/容器回收时调,防泄漏)。"""
        self._exec_observers.pop(session_id, None)

    def _container_for(self, session_id: str):
        """取会话对应的容器对象。"""
        info = self._sessions.get(session_id)
        if not info:
            raise KeyError(f"会话 {session_id} 无关联容器,先 acquire()")
        try:
            return self._client.containers.get(info["container_id"])
        except NotFound:
            raise KeyError(f"会话 {session_id} 的容器已不存在")

    # —— 生命周期 ——
    def acquire(self, session_id: str, gpu: bool = False, image: str | None = None,
                cpu_limit: float | None = None, mem_limit: str | None = None,
                shm_size: str | None = None, env_vars: dict | None = None,
                gpu_count: int = 0) -> str:
        """为会话获取/复用一个 sandbox 容器,返回容器名。

        复用:同一 session_id 已有容器则直接返回(§2.3 会话亲和 / 断线重连)。
        硬件参数(沙箱模板 grilling 决策):
          image: 覆盖默认镜像(None=用 self.image)
          cpu_limit: 核数(如 2.0)→ nano_cpus
          mem_limit: 内存上限(如 "4g")
          shm_size: /dev/shm 大小(如 "2g")
          env_vars: 容器环境变量 dict
          gpu_count: >0 透传 N 张 GPU;"all" 透传全部(覆盖 gpu 布尔)
        """
        if session_id in self._sessions:
            # 确认容器还活着
            try:
                self._client.containers.get(self._sessions[session_id]["container_id"])
                logger.info("复用会话 %s 的容器", session_id)
                return self._sessions[session_id]["name"]
            except NotFound:
                logger.warning("会话 %s 容器已丢失,重新创建", session_id)
                self._sessions.pop(session_id, None)

        name = f"{CONTAINER_PREFIX}{session_id}"
        use_image = image or self.image

        # GPU 透传:gpu_count > 0 或 legacy gpu=True
        device_requests = None
        want_gpu = gpu or gpu_count > 0
        if want_gpu:
            try:
                from docker.types import DeviceRequest
                count = gpu_count if gpu_count and gpu_count > 0 else "all"
                device_requests = [DeviceRequest(count=count, capabilities=[["gpu"]])]
                logger.warning("启用 GPU 透传(count=%s)", count)
            except Exception as e:
                logger.warning("GPU 透传配置失败,降级 CPU:%s", e)

        # 组装 run kwargs(硬件限制 + 环境变量;两处 run 调用共用,避免重试路径丢参数)
        run_kwargs: dict = {
            "name": name, "detach": True,
            "device_requests": device_requests,
            "publish_all_ports": True,  # 接管 §2.3:容器内服务对外可访问
            "tty": True, "stdin_open": True,
            # Chromium 命名空间沙箱所需(AIO Sandbox 镜像官方要求):
            # 非特权容器内 Chromium setuid 沙箱需 seccomp=unconfined + SYS_ADMIN,
            # 否则 zygote FATAL "Operation not permitted" → browser 面板一直 reconnecting。
            "security_opt": ["seccomp=unconfined"],
            "cap_add": ["SYS_ADMIN"],
            # 共享 pip 缓存卷:每会话独立容器,但 pip 下载的包复用
            "volumes": {"agent-hub-pip-cache": {"bind": "/root/.cache/pip", "mode": "rw"}},
        }
        if cpu_limit and cpu_limit > 0:
            run_kwargs["nano_cpus"] = int(cpu_limit * 1e9)  # 2.0 核 → 2_000_000_000
        if mem_limit:
            run_kwargs["mem_limit"] = mem_limit
        if shm_size:
            run_kwargs["shm_size"] = shm_size
        if env_vars:
            run_kwargs["environment"] = env_vars

        hw_desc = f"cpu={cpu_limit} mem={mem_limit} shm={shm_size} gpu={want_gpu}"
        logger.info("创建 sandbox 容器: %s image=%s (%s)", name, use_image, hw_desc)
        try:
            container = self._client.containers.run(use_image, **run_kwargs)
        except APIError as e:
            # 名字冲突(旧容器残留)→ 清理后重试(同一 run_kwargs,保留硬件限制)
            if "Conflict" in str(e) or "already in use" in str(e):
                logger.warning("容器名 %s 冲突,清理后重试", name)
                try:
                    old = self._client.containers.get(name)
                    old.remove(force=True)
                except Exception:
                    pass
                container = self._client.containers.run(use_image, **run_kwargs)
            else:
                raise

        self._sessions[session_id] = {"container_id": container.id, "name": name}
        time.sleep(2)  # 给容器启动时间(sandbox 内服务就绪)
        return name

    def release(self, session_id: str, destroy: bool = True) -> None:
        """释放会话容器(destroy=True 销毁;False 仅停止留复用)。"""
        info = self._sessions.pop(session_id, None)
        if not info:
            return
        try:
            c = self._client.containers.get(info["container_id"])
            if destroy:
                c.remove(force=True)
                logger.info("销毁容器 %s", info["name"])
            else:
                c.stop(timeout=5)
                logger.info("停止容器 %s", info["name"])
        except NotFound:
            logger.info("容器 %s 已不存在", info["name"])

    def get_container_port(self, session_id: str, internal_port: int = 8080) -> Optional[int]:
        """取容器 8080 映射的宿主端口(接管 URL 用)。"""
        try:
            c = self._client.containers.get(self._sessions[session_id]["container_id"])
        except (KeyError, NotFound):
            return None
        ports = c.ports.get(f"{internal_port}/tcp")
        if ports:
            return int(ports[0]["HostPort"])
        return None

    # —— 执行(进事件流 §2.5)——
    def exec(self, session_id: str, command: str, workdir: str = "/workspace") -> ExecResult:
        """在会话容器内执行命令(docker exec_run),收集结果(§3 职责4/5)。"""
        container = self._container_for(session_id)
        # 确保 workdir 存在
        container.exec_run(["bash", "-lc", f"mkdir -p {workdir}"])
        t0 = time.time()
        exit_code, output = container.exec_run(
            ["bash", "-lc", command], workdir=workdir, demux=True,
        )
        duration = time.time() - t0
        stdout = (output[0].decode("utf-8", "replace") if output and output[0] else "")
        stderr = (output[1].decode("utf-8", "replace") if output and output[1] else "")
        result = ExecResult(
            exit_code=int(exit_code), stdout=stdout, stderr=stderr,
            duration_s=round(duration, 3), command=command,
        )
        # observer 按 session_id 路由(每会话写各自事件流);无注册则用默认(向后兼容)
        cb = self._exec_observers.get(session_id) or self._default_observer
        if cb is not None:
            try:
                cb(result)
            except Exception:
                logger.debug("on_exec 回调异常(已忽略)", exc_info=True)
        logger.info("exec[%s] exit=%d %.3fs | %s", session_id, exit_code, duration, command[:80])
        return result

    def put_file(self, session_id: str, path: str, data: bytes) -> None:
        """把文件写入容器指定路径(tar + put_archive,POC 验证)。path 含目录时自动建。"""
        container = self._container_for(session_id)
        target_dir = path.rsplit("/", 1)[0] or "/"
        fname = path.rsplit("/", 1)[-1]
        container.exec_run(["bash", "-lc", f"mkdir -p {target_dir}"])
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as tar:
            info = tarfile.TarInfo(name=fname)
            info.size = len(data)
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(data))
        stream.seek(0)
        container.put_archive(target_dir, stream)

    def put_files(self, session_id: str, files: dict[str, bytes]) -> None:
        """批量写文件 {path: content}。"""
        for path, data in files.items():
            self.put_file(session_id, path, data)


# 进程单例
_manager: Optional[SandboxManager] = None


def get_manager(on_exec: Optional[ExecObserver] = None) -> SandboxManager:
    """取进程级单例 SandboxManager。

    on_exec 仅在首次构造时注入(之后忽略,由 SessionRegistry.persist_sandbox_exec 统一接管)。
    """
    global _manager
    if _manager is None:
        from app.config import get_settings
        s = get_settings()
        _manager = SandboxManager(image=s.sandbox_image, on_exec=on_exec)
    return _manager
