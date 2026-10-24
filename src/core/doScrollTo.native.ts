import { checkFinishedScroll, checkFinishedScrollFallback } from "@/core/checkFinishedScroll";
import type { DoScrollToParams } from "@/core/doScrollParams";
import { initialScrollCompletion } from "@/core/initialScrollSession";
import { getContentSize } from "@/state/getContentSize";
import type { StateContext } from "@/state/state";
import { toNativeHorizontalOffset } from "@/utils/rtl";

export function doScrollTo(ctx: StateContext, params: DoScrollToParams) {
    const state = ctx.state;
    const { animated, horizontal, isInitialScroll, offset } = params;
    const isAnimated = !!animated;
    const { refScroller } = state;
    const scroller = refScroller.current;

    if (!scroller) {
        return;
    }

    if (!params.isAdjustment) {
        // Explicit requests own their momentum; MVCP re-assertions keep the gesture's ownership.
        state.userScrollContentSize = undefined;
    }

    const isHorizontal = !!horizontal;
    const contentSize = isHorizontal
        ? Math.max(getContentSize(ctx), state.props.contentContainerMinSize ?? 0)
        : undefined;
    const nativeOffset = toNativeHorizontalOffset(state, offset, contentSize);

    scroller.scrollTo({
        animated: isAnimated,
        x: isHorizontal ? nativeOffset : 0,
        y: isHorizontal ? 0 : offset,
    });
    if (isInitialScroll) {
        initialScrollCompletion.markInitialScrollNativeDispatch(state);
    }

    if (isAnimated && Math.abs(state.scroll - offset) <= 1) {
        checkFinishedScroll(ctx);
    }

    if (!isAnimated) {
        state.scroll = offset;
    }
    // Native can accept an animated request without emitting any completion events.
    checkFinishedScrollFallback(ctx);
}
