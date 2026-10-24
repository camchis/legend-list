import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

import "../setup";

import { doScrollTo } from "@/core/doScrollTo.native";
import { Platform } from "@/platform/Platform";
import { createMockContext } from "../__mocks__/createMockContext";
import { installFakeClock } from "../helpers/webScrollHarness";

describe("doScrollTo (native)", () => {
    const originalPlatform = Platform.OS;

    beforeEach(() => {
        Platform.OS = originalPlatform;
    });

    afterEach(() => {
        Platform.OS = originalPlatform;
    });

    it.each(["ios", "android"] as const)("uses the minWidth extent for %s RTL offsets", (platform) => {
        Platform.OS = platform;
        const scrollTo = mock();
        const ctx = createMockContext(
            { totalSize: 300 },
            {
                props: { contentContainerMinSize: 2000, data: [], horizontal: true, rtl: true },
                refScroller: { current: { scrollTo } } as any,
                scrollLength: 300,
            },
        );
        doScrollTo(ctx, { animated: true, horizontal: true, offset: 1400 });
        expect(scrollTo).toHaveBeenCalledWith({ animated: true, x: 300, y: 0 });
        ctx.state.scheduledWork.dispose();
    });

    it("uses the Android RTL default before the native horizontal mode is detected", () => {
        Platform.OS = "android";
        const scrollTo = mock();
        const ctx = createMockContext(
            {
                totalSize: 1000,
            },
            {
                props: {
                    data: [],
                    horizontal: true,
                    rtl: true,
                },
                refScroller: {
                    current: {
                        scrollTo,
                    },
                } as any,
                scrollLength: 300,
            },
        );

        doScrollTo(ctx, { animated: true, horizontal: true, offset: 100 });

        expect(scrollTo).toHaveBeenCalledWith({ animated: true, x: 600, y: 0 });
        expect(ctx.state.horizontalRTLScrollType).toBeUndefined();
    });

    it("uses the iOS RTL default before the native horizontal mode is detected", () => {
        Platform.OS = "ios";
        const scrollTo = mock();
        const ctx = createMockContext(
            {
                totalSize: 1000,
            },
            {
                props: {
                    data: [],
                    horizontal: true,
                    rtl: true,
                },
                refScroller: {
                    current: {
                        scrollTo,
                    },
                } as any,
                scrollLength: 300,
            },
        );

        doScrollTo(ctx, { animated: true, horizontal: true, offset: 100 });

        expect(scrollTo).toHaveBeenCalledWith({ animated: true, x: 600, y: 0 });
        expect(ctx.state.horizontalRTLScrollType).toBeUndefined();
    });

    it.each([false, true])("preserves released-drag ownership only for adjustment re-asserts (%s)", (isAdjustment) => {
        const ctx = createMockContext(
            {},
            {
                refScroller: { current: { scrollTo: mock() } } as any,
                userScrollContentSize: 1000,
            },
        );
        doScrollTo(ctx, { animated: true, isAdjustment, offset: 100 });
        expect(ctx.state.userScrollContentSize).toBe(isAdjustment ? 1000 : undefined);
        ctx.state.scheduledWork.dispose();
    });

    it.each(["ios", "android"] as const)("waits for fresh %s animation events after an idle period", (platform) => {
        Platform.OS = platform;
        const clock = installFakeClock();
        const now = spyOn(Date, "now").mockImplementation(() => clock.now);
        const resolve = mock();
        const ctx = createMockContext(
            { totalSize: 1000 },
            {
                didContainersLayout: true,
                didFinishInitialScroll: true,
                hasScrolled: true,
                lastNativeScrollTime: 0,
                pendingScrollResolve: resolve,
                refScroller: { current: { scrollTo: mock() } } as any,
                scroll: 0,
                scrollingTo: { animated: true, offset: 600, targetOffset: 600 },
                scrollLength: 300,
                scrollPending: 0,
            },
        );
        try {
            clock.advance(1000);
            doScrollTo(ctx, { animated: true, offset: 600 });
            clock.advance(100);
            expect(ctx.state.scrollingTo).toBeDefined();
            expect(resolve).not.toHaveBeenCalled();
            clock.advance(1900);
            expect(resolve).toHaveBeenCalledWith({ reason: "unreachable" });
            expect(ctx.state.scrollingTo).toBeUndefined();
        } finally {
            ctx.state.scheduledWork.dispose();
            now.mockRestore();
            clock.restore();
        }
    });

    it.each(["ios", "android"] as const)("bounds a silent animated %s request without native events", (platform) => {
        Platform.OS = platform;
        const clock = installFakeClock();
        const resolve = mock();
        const ctx = createMockContext(
            { totalSize: 1000 },
            {
                didContainersLayout: true,
                didFinishInitialScroll: true,
                pendingScrollResolve: resolve,
                refScroller: { current: { scrollTo: mock() } } as any,
                scroll: 0,
                scrollingTo: { animated: true, offset: 100, targetOffset: 100 },
                scrollLength: 300,
                scrollPending: 0,
            },
        );
        try {
            doScrollTo(ctx, { animated: true, offset: 100 });
            clock.advance(2000);
            expect(resolve).toHaveBeenCalledWith({ reason: "unreachable" });
            expect(ctx.state.scrollingTo).toBeUndefined();
            expect(clock.pendingTimerCount()).toBe(0);
        } finally {
            ctx.state.scheduledWork.dispose();
            clock.restore();
        }
    });

    for (const platform of ["ios", "android"] as const) {
        it(`finishes an animated ${platform} request that is already at its target`, () => {
            Platform.OS = platform;
            const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
            let pendingFrame: FrameRequestCallback | undefined;
            globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
                pendingFrame = callback;
                return 1;
            }) as typeof requestAnimationFrame;
            const resolveScroll = mock();
            const scrollTo = mock();
            const ctx = createMockContext(
                { totalSize: 1000 },
                {
                    hasScrolled: true,
                    pendingScrollResolve: resolveScroll,
                    refScroller: {
                        current: {
                            scrollTo,
                        },
                    } as any,
                    scroll: 100,
                    scrollingTo: {
                        animated: true,
                        offset: 100,
                        targetOffset: 100,
                    } as any,
                    scrollLength: 300,
                    scrollPending: 100,
                },
            );

            try {
                doScrollTo(ctx, { animated: true, horizontal: false, offset: 100 });
                pendingFrame?.(0);
            } finally {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            }

            expect(scrollTo).toHaveBeenCalledWith({ animated: true, x: 0, y: 100 });
            expect(resolveScroll).toHaveBeenCalledTimes(1);
            expect(ctx.state.pendingScrollResolve).toBeUndefined();
            expect(ctx.state.scrollingTo).toBeUndefined();
        });
    }
});
