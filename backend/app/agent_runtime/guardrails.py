"""运行时防护策略(§5.4)。

三模式(决策#13):strict(严谨)/standard(标准)/yolo
- strict:真实工具强制确认 + 紧熔断
- standard:仅首次确认 + 中熔断
- yolo:关确认 + 宽熔断(留总超时底线)

工具分类:
- 需确认工具(有副作用):run_sweep_in_sandbox(sandbox 执行/装包)
- 纯计算工具(默认不确认):run_aero_tool(strict 模式下也确认)
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Mode(str, Enum):
    STRICT = "strict"      # 严谨:强制确认 + 紧熔断
    STANDARD = "standard"  # 标准:首次确认 + 中熔断
    YOLO = "yolo"          # YOLO:关确认 + 宽熔断

    @classmethod
    def parse(cls, s: str | None) -> "Mode":
        if not s:
            return cls.STANDARD
        try:
            return cls(s.lower())
        except ValueError:
            return cls.STANDARD


@dataclass
class Limits:
    """熔断上限(按模式定)。"""
    max_rounds: int       # 最大轮数(每个 superstep 算一轮)
    max_tool_calls: int   # 最大工具调用次数
    timeout_s: float      # 总执行超时(秒)

    @classmethod
    def for_mode(cls, mode: Mode) -> "Limits":
        # Deep Agents 自带 file/subagent 工具会消耗 tool_call 预算,阈值较纯 ReAct 放松
        return {
            Mode.STRICT:   cls(max_rounds=25, max_tool_calls=60, timeout_s=600),
            Mode.STANDARD: cls(max_rounds=40, max_tool_calls=100, timeout_s=1200),
            Mode.YOLO:     cls(max_rounds=80, max_tool_calls=200, timeout_s=2400),
        }[mode]


# 默认需确认的工具(有副作用)
CONFIRM_TOOLS = {"run_sweep_in_sandbox"}
# 纯计算工具(默认不确认,但 strict 模式下也确认)
PURE_TOOLS = {"run_aero_tool"}


def needs_confirm(tool_name: str, mode: Mode, call_count: int) -> bool:
    """判断该次工具调用是否需用户确认。

    - yolo:永不确认
    - strict:所有工具(CONFIRM+PURE)都确认
    - standard:CONFIRM_TOOLS 仅首次确认(后续信任);PURE 不确认
    """
    if mode == Mode.YOLO:
        return False
    if mode == Mode.STRICT:
        return True
    # standard
    if tool_name in CONFIRM_TOOLS:
        return call_count == 0  # 仅首次
    return False
