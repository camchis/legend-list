import { settlePendingImperativeScroll, syncScrollActive } from "@/core/cancelImperativeScroll";
import { cancelScroll } from "@/core/cancelScroll";
import { interruptMaintainScrollAtEnd, rearmEndFollowIfSettled } from "@/core/doMaintainScrollAtEnd";
import { type StateContext, set$ } from "@/state/state";
import type { ScrollResolve } from "@/types.internal";

export type ScrollRequestRun = () => boolean | "unreachable";

export interface ScrollRequestTracker {
    cancel(): void;
    isCurrent(token: number): boolean;
    isWaitingToRun(): boolean;
    runNow(token: number, resolve: ScrollResolve, run: ScrollRequestRun): void;
    runNowIfIdle(run: ScrollRequestRun): Promise<void>;
    start(resolve: ScrollResolve): number;
}

export function getScrollRequestTracker(ctx: StateContext): ScrollRequestTracker {
    if (!ctx.scrollRequestTracker) {
        let currentToken = 0;
        let waitingToken: number | undefined;

        const start = (resolve: ScrollResolve, isInternal = false) => {
            const state = ctx.state;
            // A newer explicit target supersedes automatic end-follow intent.
            if (!isInternal) {
                // A visible replacement may dispatch nothing, so stop the superseded motion first.
                if (state.scrollingTo?.animated) cancelScroll(ctx);
                state.scheduledWork.cancel("appScrollRearm");
                state.pendingEndMeasurements = undefined;
                state.visibleContentAnchor = undefined;
                state.userScrollAnchorReset = undefined;
                interruptMaintainScrollAtEnd(ctx);
            }
            state.scheduledWork.cancel("imperativeScrollReady");
            const token = ++currentToken;

            settlePendingImperativeScroll(state);
            state.pendingScrollResolve = resolve;
            waitingToken = token;
            set$(ctx, "isScrollActive", true);

            return token;
        };

        const runNow = (token: number, resolve: ScrollResolve, run: ScrollRequestRun) => {
            const state = ctx.state;
            if (token !== currentToken) {
                return;
            }

            waitingToken = undefined;
            const didStartScroll = run();
            if (didStartScroll === "unreachable") {
                cancelScroll(ctx);
                return;
            }
            if (!didStartScroll || !state.scrollingTo) {
                if (state.pendingScrollResolve === resolve) {
                    state.pendingScrollResolve = undefined;
                }
                syncScrollActive(ctx);
                rearmEndFollowIfSettled(ctx);
                resolve();
            }
        };

        ctx.scrollRequestTracker = {
            cancel: () => {
                currentToken++;
                waitingToken = undefined;
            },
            isCurrent: (token) => token === currentToken,
            isWaitingToRun: () => waitingToken === currentToken && !!ctx.state.pendingScrollResolve,
            runNow,
            runNowIfIdle: (run) => {
                const state = ctx.state;
                // Automatic end maintenance must not supersede an explicit or otherwise active scroll target.
                if (state.pendingScrollResolve || state.scrollingTo) {
                    return Promise.resolve();
                }
                return new Promise<void>((resolve) => {
                    const token = start(resolve, true);
                    runNow(token, resolve, run);
                });
            },
            start,
        };
    }

    return ctx.scrollRequestTracker;
}
