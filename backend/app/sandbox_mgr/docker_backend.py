"""deepagents BackendProtocol 适配器:经会话级 docker 容器执行文件操作。

让 deepagents 的 SkillsMiddleware(发现 SKILL.md)和 FilesystemMiddleware
(agent 的 read_file/write_file/exec 等)统一操作【会话容器】的文件系统,
路径空间一致——agent 看到的 skill 路径就是它能 read_file 的容器路径。

把 BackendProtocol 的 ls/read/glob/grep/write/edit 等转发到 SandboxManager.exec
(在会话容器内跑 shell 命令)。async 方法由基类的 asyncio.to_thread 默认实现覆盖。
"""
from __future__ import annotations

import logging
from typing import Any

from deepagents.backends.protocol import (
    BackendProtocol, FileInfo, LsResult, ReadResult, WriteResult,
    GlobResult, EditResult, GrepResult, FileData,
)

logger = logging.getLogger("docker_backend")


class DockerContainerBackend(BackendProtocol):
    """把 deepagents 文件操作转发到会话级 docker 容器(经 SandboxManager.exec)。

    mgr + session_id 决定操作哪个容器。所有路径是容器内绝对路径(/开头)。
    """

    def __init__(self, mgr, session_id: str):
        self._mgr = mgr
        self._sid = session_id

    def _sh(self, cmd: str) -> str:
        """在容器内跑 shell 命令,返回 stdout(出错返回空串并记日志)。"""
        try:
            r = self._mgr.exec(self._sid, cmd, workdir="/")
            if r.exit_code != 0:
                logger.debug("docker_backend shell 失败(exit %d): %s | %s", r.exit_code, cmd[:60], r.stderr[:100])
            return r.stdout
        except Exception as e:
            logger.warning("docker_backend exec 异常: %s", e)
            return ""

    # —— ls ——
    def ls(self, path: str) -> LsResult:
        # 用 find 列目录条目(path/is_dir/size/mtime),tab 分隔,管道安全
        out = self._sh(
            f'find "{path}" -maxdepth 1 -mindepth 1 '
            f'-printf "%p\\t%y\\t%s\\t%T@\\n" 2>/dev/null || '
            f'ls -1pa "{path}" 2>/dev/null'  # 降级(printf 不支持时)
        )
        entries: list[FileInfo] = []
        for line in out.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) >= 4:
                p, typ, size, mtime = parts[0], parts[1], parts[2], parts[3]
                entries.append(FileInfo(path=p, is_dir=(typ == "d"), size=int(size) if size.isdigit() else 0))
            else:
                # 降级路径:ls -1pa 输出,name 末尾 / 是目录
                name = parts[0]
                entries.append(FileInfo(path=f"{path.rstrip('/')}/{name.rstrip('/')}", is_dir=name.endswith("/")))
        return LsResult(error=None, entries=entries)

    # —— read ——
    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        # sed -n 读指定行范围(offset 1-based 行号)
        start = offset + 1
        end = offset + limit
        content = self._sh(f'sed -n "{start},{end}p" "{file_path}" 2>/dev/null')
        if not content and not self._sh(f'test -f "{file_path}" && echo ok'):
            return ReadResult(error=f"file not found: {file_path}", file_data=None)
        return ReadResult(error=None, file_data=FileData(content=content, encoding="utf-8", created_at="", modified_at=""))

    # —— glob ——
    def glob(self, pattern: str, path: str | None = None) -> GlobResult:
        base = path or "/"
        # 把 glob pattern 转 find -name:取最后一段文件名部分(**/SKILL.md → SKILL.md)
        import os.path as _op
        # 去掉路径前缀(**/,./),只留文件名 glob
        fname = pattern
        for sep in ["**/", "**", "/", "./"]:
            if sep in fname:
                fname = fname.split(sep)[-1]
        fname = fname.replace("*", "*")
        out = self._sh(f'find "{base}" -name "{fname}" -type f 2>/dev/null | head -200')
        matches = [FileInfo(path=p.strip()) for p in out.strip().splitlines() if p.strip()]
        return GlobResult(error=None, matches=matches)

    def glob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        return self.glob(pattern, path).matches or []

    # —— grep ——
    def grep(self, pattern: str, path: str | None = None, glob: str | None = None) -> GrepResult:
        base = path or "/"
        g = f'--include="{glob}"' if glob else ""
        out = self._sh(f'grep -rn {g} "{pattern}" "{base}" 2>/dev/null | head -100')
        matches = []
        from deepagents.backends.protocol import GrepMatch
        for line in out.strip().splitlines():
            if ":" in line:
                fp, _, rest = line.partition(":")
                matches.append(GrepMatch(path=fp, line=rest))
        return GrepResult(error=None, matches=matches)

    def grep_raw(self, pattern: str, path: str | None = None, glob: str | None = None) -> list | str:
        r = self.grep(pattern, path, glob)
        return r.matches or []

    # —— write ——
    def write(self, file_path: str, content: str) -> WriteResult:
        # 经 SandboxManager.put_file 写(避免 shell 转义问题)
        try:
            self._mgr.put_file(self._sid, file_path, content.encode("utf-8"))
            return WriteResult(error=None, path=file_path)
        except Exception as e:
            return WriteResult(error=str(e), path=file_path)

    # —— edit(字符串替换)——
    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult:
        # 用 python 在容器内做替换(避免 sed 的特殊字符问题)
        script = (
            "import sys, pathlib\n"
            f"p = pathlib.Path({file_path!r})\n"
            "t = p.read_text(encoding='utf-8')\n"
            f"n = t.replace({old_string!r}, {new_string!r}{', -1' if replace_all else ''})\n"
            "p.write_text(n, encoding='utf-8')\n"
            "print(t.count(" + repr(old_string) + "))"
        )
        out = self._sh(f"python3 -c {script!r}")
        occ = int(out.strip()) if out.strip().isdigit() else 0
        return EditResult(error=None, path=file_path, occurrences=occ)

    # —— ls_info(兼容旧名)——
    def ls_info(self, path: str) -> list[FileInfo]:
        return self.ls(path).entries or []

    # —— upload/download(脚本上传用,简单实现)——
    def upload_files(self, files: list[tuple[str, bytes]]) -> list:
        from deepagents.backends.protocol import FileUploadResponse
        results = []
        for path, data in files:
            try:
                self._mgr.put_file(self._sid, path, data)
                results.append(FileUploadResponse(path=path, error=None))
            except Exception as e:
                results.append(FileUploadResponse(path=path, error=str(e)))
        return results

    def download_files(self, paths: list[str]) -> list:
        from deepagents.backends.protocol import FileDownloadResponse
        results = []
        for p in paths:
            # 经 base64 取原始 bytes(skills 发现要 .decode() 得到文本,故返回 bytes)
            b64 = self._sh(f'base64 "{p}" 2>/dev/null').replace("\n", "")
            import base64 as _b64
            try:
                raw = _b64.b64decode(b64) if b64 else b""
            except Exception:
                raw = b""
            results.append(FileDownloadResponse(path=p, content=raw, error=None if raw else "empty/not found"))
        return results
