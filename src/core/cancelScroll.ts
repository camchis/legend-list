import { cancelImperativeScroll, syncScrollActive } from "@/core/cancelImperativeScroll";
import { interruptMaintainScrollAtEnd } from "@/core/doMaintainScrollAtEnd";
import { getNativeScrollPoint } from "@/core/doScrollParams";
import { clearPreservedInitialScrollTarget, supersedeInitialScroll } from "@/core/finishInitialScroll";
import { getObservedScrollOffset } from "@/core/observedScroll";
import { updateScroll } from "@/core/updateScroll";
import { Platform } from "@/platform/Platform";
import { peek$, type StateContext } from "@/state/state";

export function cancelScroll(ctx: StateContext, stopAnimation = true, commitAdjust = true) {
    const { state } = ctx;
    // Without a native observation, scrollPending has not yet absorbed deferred adjustments.
    const observed = getObservedScrollOffset(ctx, peek$(ctx, "scrollAdjustPending") ? state.scrollPending : undefined);
    // A superseded animation keeps running natively while its replacement waits to dispatch.
    const wasAnimating = !!state.scrollingTo?.animated || !!ctx.scrollRequestTracker?.cancel();
    releaseScrollOwners(ctx, true);
    state.scrollPending = observed;
    // Deferred adjustments are not applied natively yet, so the observed offset is current even
    // inside their MVCP ignore window; dropping it would count them twice in the commit below.
    const ignoreScrollFromMVCP = state.ignoreScrollFromMVCP;
    if (peek$(ctx, "scrollAdjustPending")) state.ignoreScrollFromMVCP = undefined;
    updateScroll(ctx, observed, true, { markHasScrolled: false });
    state.ignoreScrollFromMVCP = ignoreScrollFromMVCP;
    if (wasAnimating && stopAnimation) stopScrollAnimation(ctx, observed);
    // Apply MVCP adjustments deferred during the cancelled animation now, or mark them superseded
    // so the replacement's finishScrollTo does not add them to its own offset target.
    if (commitAdjust) state.scrollAdjustHandler.commitPendingAdjust();
    else state.scrollAdjustHandler.supersedePendingAdjust();
}

export function stopScrollAnimation(ctx: StateContext, observed = getObservedScrollOffset(ctx)) {
    const { state } = ctx;
    const scroller = state.refScroller.current;
    // Stop at the scroller's own raw offset when it reports one, avoiding an RTL round trip.
    const x = state.props.horizontal
        ? (scroller?.getCurrentScrollOffset?.() ?? getNativeScrollPoint(ctx, observed).x)
        : 0;
    scroller?.scrollTo({ animated: false, x, y: state.props.horizontal ? 0 : observed });
}

function releaseScrollOwners(ctx: StateContext, supersedeInitial: boolean) {
    const { state } = ctx;
    ctx.scrollRequestTracker?.cancel();
    interruptMaintainScrollAtEnd(ctx);
    cancelImperativeScroll(state);
    // Before supersedeInitialScroll, whose released onScroll may set a new anchor re-entrantly.
    state.pendingEndMeasurements = undefined;
    state.visibleContentAnchor = undefined;
    if (supersedeInitial) supersedeInitialScroll(ctx);
    clearPreservedInitialScrollTarget(state);
    // After supersedeInitialScroll, so a scroll started re-entrantly from its onScroll stays active.
    syncScrollActive(ctx);
}

export function interruptUserScroll(ctx: StateContext) {
    if (ctx.state.scrollingTo || (ctx.state.initialScroll && !ctx.state.didFinishInitialScroll)) {
        cancelScroll(ctx, Platform.OS === "web");
    } else {
        releaseScrollOwners(ctx, false);
    }
}
