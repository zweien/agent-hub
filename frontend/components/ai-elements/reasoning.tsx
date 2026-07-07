"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { useState, type HTMLAttributes } from "react";

export type ReasoningProps = HTMLAttributes<HTMLDivElement> & {
  /** 推理过程文本 */
  content: string;
  /** 是否流式中(显示"思考中..."指示) */
  isStreaming?: boolean;
  /** 默认展开/折叠(默认折叠) */
  defaultOpen?: boolean;
};

/**
 * AI 推理过程展示区(可折叠)。
 *
 * 仅推理模型产生(reasoning content block 或 additional_kwargs.reasoning_content)。
 * 默认折叠,避免占用视觉空间;流式中显示"思考中"指示。
 */
export const Reasoning = ({
  content,
  isStreaming = false,
  defaultOpen = false,
  className,
  ...props
}: ReasoningProps) => {
  const [open, setOpen] = useState(defaultOpen);
  if (!content && !isStreaming) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "w-full rounded-lg border border-dashed bg-muted/30 text-xs",
        className,
      )}
      {...props}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-3 py-1.5 text-muted-foreground hover:bg-muted/50">
        <BrainIcon className="size-3.5 shrink-0" />
        <span className="font-medium">{isStreaming ? "思考中…" : "思考过程"}</span>
        <ChevronDownIcon
          className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t px-3 py-2 text-muted-foreground">
          <p className="whitespace-pre-wrap break-words leading-relaxed">{content}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
