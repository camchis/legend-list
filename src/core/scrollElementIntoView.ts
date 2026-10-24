import { cancelScroll } from "@/core/cancelScroll";
import { getObservedScrollOffset } from "@/core/emitMetrics";
import { scrollTo } from "@/core/scrollTo";
import type { StateContext } from "@/state/state";
import { getNativeHorizontalRTLScrollType, isHorizontalRTL } from "@/utils/rtl";

export function getScrollElementTargetOffset(ctx: StateContext): number | "unreachable" {
    const { state } = ctx;
    const target = state.scrollElementTarget;
    const node = state.refScroller.current?.getScrollableNode() as Element | null | undefined;
    if (!target || !node?.getBoundingClientRect) return "unreachable";
    const ancestor =
        "commonAncestorContainer" in target.element ? target.element.commonAncestorContainer : target.element;
    if (!ancestor.isConnected) return "unreachable";
    const rect = target.element.getBoundingClientRect();
    let viewport: { bottom: number; left: number; right: number; top: number };
    if (state.refScroller.current?.isWindowScroll?.()) {
        viewport = { bottom: window.innerHeight, left: 0, right: window.innerWidth, top: 0 };
    } else {
        const bounds = node.getBoundingClientRect();
        const top = bounds.top + node.clientTop;
        const left = bounds.left + node.clientLeft;
        viewport = { bottom: top + node.clientHeight, left, right: left + node.clientWidth, top };
    }
    const horizontal = state.props.horizontal;
    const rtl = isHorizontalRTL(state) && getNativeHorizontalRTLScrollType(state) !== "normal";
    const start = horizontal
        ? rtl
            ? -viewport.right
            : viewport.left
        : viewport.top + (target.viewportMargin?.top ?? 0);
    const end = horizontal
        ? rtl
            ? -viewport.left
            : viewport.right
        : viewport.bottom - (target.viewportMargin?.bottom ?? 0);
    const targetStart = horizontal ? (rtl ? -rect.right : rect.left) : rect.top;
    const targetEnd = horizontal ? (rtl ? -rect.left : rect.right) : rect.bottom;
    const targetSize = horizontal ? rect.width : rect.height;
    const alignedDelta =
        target.viewPosition === undefined
            ? undefined
            : targetStart - start - target.viewPosition * (end - start - targetSize);
    const delta =
        alignedDelta ??
        (targetStart < start
            ? targetStart - start
            : targetEnd > end
              ? Math.min(targetStart - start, targetEnd - end)
              : 0);
    return getObservedScrollOffset(ctx) + delta;
}

export function scrollElementIntoView(ctx: StateContext): boolean | "unreachable" {
    const offset = getScrollElementTargetOffset(ctx);
    if (offset === "unreachable") {
        if (ctx.state.scrollingTo && !ctx.scrollRequestTracker?.isWaitingToRun())
            cancelScroll(ctx, true, "unreachable");
        ctx.state.scrollElementTarget = undefined;
        return "unreachable";
    }
    if (Math.abs(offset - getObservedScrollOffset(ctx)) <= 1) return false;
    scrollTo(ctx, { animated: ctx.state.scrollElementTarget?.animated ?? false, offset });
    return true;
}
