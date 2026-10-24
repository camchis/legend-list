import { cancelScroll } from "@/core/cancelScroll";
import { getObservedScrollOffset } from "@/core/emitMetrics";
import { scrollTo } from "@/core/scrollTo";
import type { StateContext } from "@/state/state";
import { isHorizontalRTL } from "@/utils/rtl";

export function scrollElementIntoView(ctx: StateContext, animated = false): boolean | "unreachable" {
    const { state } = ctx;
    const target = state.scrollElementTarget;
    const node = state.refScroller.current?.getScrollableNode() as Element | null | undefined;
    if (!target || !node?.getBoundingClientRect) return "unreachable";
    const ancestor =
        "commonAncestorContainer" in target.element ? target.element.commonAncestorContainer : target.element;
    if (!ancestor.isConnected) {
        if (state.scrollingTo && !ctx.scrollRequestTracker?.isWaitingToRun()) cancelScroll(ctx, true, "unreachable");
        state.scrollElementTarget = undefined;
        return "unreachable";
    }
    const rect = target.element.getBoundingClientRect();
    const viewport = state.refScroller.current?.isWindowScroll?.()
        ? { bottom: window.innerHeight, left: 0, right: window.innerWidth, top: 0 }
        : node.getBoundingClientRect();
    const horizontal = state.props.horizontal;
    const rtl = isHorizontalRTL(state);
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
    if (Math.abs(delta) <= 1) return false;
    scrollTo(ctx, { animated, offset: getObservedScrollOffset(ctx) + delta });
    return true;
}
