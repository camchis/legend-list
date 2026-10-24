import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import "../setup";

import { Platform } from "@/platform/Platform";
import { checkResetContainers } from "../../src/core/checkResetContainers";
import { finishMaintainScrollAtEnd } from "../../src/core/doMaintainScrollAtEnd";
import { onScroll } from "../../src/core/onScroll";
import { updateItemSizes } from "../../src/core/updateItemSizes";
import * as screenReader from "../../src/platform/screenReader";
import { peek$ } from "../../src/state/state";
import { createMockContext } from "../__mocks__/createMockContext";

describe("screen reader scroll ownership", () => {
    const originalPlatform = Platform.OS;
    let enabled = true;
    beforeEach(() => {
        Platform.OS = "android";
        enabled = true;
        spyOn(screenReader, "isScreenReaderEnabled").mockImplementation(() => enabled);
    });
    afterEach(() => {
        Platform.OS = originalPlatform;
    });
    function setup(horizontal = false, rtl = false) {
        const callback = mock(() => {});
        const ctx = createMockContext(
            { isFollowingEnd: true },
            {
                didFinishInitialScroll: true,
                props: { horizontal, maintainScrollAtEnd: { animated: true }, onUserScroll: callback, rtl },
                scroll: 700,
                scrollLength: 300,
                totalSize: 1000,
                triggerCalculateItemsInView: () => {},
            },
        );
        const scroll = (offset: number, content = ctx.state.totalSize, length = ctx.state.scrollLength) =>
            onScroll(ctx, {
                nativeEvent: {
                    contentOffset: { x: horizontal ? (rtl ? -offset : offset) : 0, y: horizontal ? 0 : offset },
                    contentSize: { height: horizontal ? 300 : content, width: horizontal ? content : 300 },
                    layoutMeasurement: { height: horizontal ? 300 : length, width: horizontal ? length : 300 },
                },
            } as any);
        return { callback, ctx, scroll };
    }
    for (const [horizontal, rtl] of [
        [false, false],
        [true, false],
        [true, true],
    ]) {
        it(`releases a quiet scroll away once per burst (${horizontal}, ${rtl})`, () => {
            const { ctx, callback, scroll } = setup(horizontal, rtl);
            scroll(700);
            scroll(650);
            scroll(600);
            scroll(550);
            expect(peek$(ctx, "isFollowingEnd")).toBe(false);
            expect(callback).toHaveBeenCalledTimes(1);
            ctx.state.scheduledWork.dispose();
        });
    }
    it("reports a quiet accessibility gesture toward the end", () => {
        const { ctx, callback, scroll } = setup();
        scroll(400);
        scroll(450);
        scroll(500);
        expect(callback).toHaveBeenCalledTimes(1);
        ctx.state.scheduledWork.dispose();
    });
    it("starts another burst after idle or reversal", () => {
        let time = 1000;
        spyOn(Date, "now").mockImplementation(() => time);
        const { ctx, callback, scroll } = setup();
        scroll(700);
        scroll(650);
        time += 100;
        scroll(600);
        expect(callback).toHaveBeenCalledTimes(1);
        time += 251;
        scroll(550);
        scroll(600);
        expect(callback).toHaveBeenCalledTimes(3);
        ctx.state.scheduledWork.dispose();
    });
    it("clears observations when a screen reader is disabled", () => {
        const { ctx, callback, scroll } = setup();
        scroll(700);
        enabled = false;
        scroll(650);
        enabled = true;
        scroll(600);
        expect(callback).not.toHaveBeenCalled();
        scroll(550);
        expect(callback).toHaveBeenCalledTimes(1);
        ctx.state.scheduledWork.dispose();
    });
    it("does nothing while a screen reader is off", () => {
        enabled = false;
        const { ctx, callback, scroll } = setup();
        scroll(700);
        scroll(650);
        scroll(600);
        expect(peek$(ctx, "isFollowingEnd")).toBe(true);
        expect(callback).not.toHaveBeenCalled();
        ctx.state.scheduledWork.dispose();
    });
    for (const alreadyMeasured of [false, true]) {
        it(`accepts accessibility input after an append is measured (cached: ${alreadyMeasured})`, () => {
            const { ctx, callback, scroll } = setup();
            const state = ctx.state;
            state.props.maintainScrollAtEnd = { animated: true, on: { dataChange: true } };
            state.previousData = Array.from({ length: 9 }, (_, id) => ({ id }));
            state.props.data = [...state.previousData, { id: 9 }];
            state.props.estimatedItemSize = 100;
            state.indexByKey.set("item_9", 9);
            if (alreadyMeasured) state.sizesKnown.set("item_9", 100);
            checkResetContainers(ctx, state.props.data);
            expect(state.pendingEndMeasurements?.size).toBe(alreadyMeasured ? 0 : 1);
            if (!alreadyMeasured) {
                scroll(700);
                scroll(650);
                expect(callback).not.toHaveBeenCalled();
                expect(peek$(ctx, "isFollowingEnd")).toBe(true);
                updateItemSizes(ctx, { itemKey: "item_9", size: { height: 100, width: 300 } });
                expect(state.pendingEndMeasurements?.size).toBe(0);
            }
            // The append follow has settled; only completed measurement state remains.
            finishMaintainScrollAtEnd(ctx);
            scroll(600);
            scroll(550);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(peek$(ctx, "isFollowingEnd")).toBe(false);
            state.scheduledWork.dispose();
        });
    }
    for (const owner of [
        "queued-follow",
        "animated-follow",
        "explicit-end",
        "queued-request",
        "native-ref",
        "initial",
        "mvcp",
        "adjust",
        "drag",
        "momentum",
        "drag-handoff",
        "end-measurements",
        "queued-end",
        "mvcp-ignore",
    ]) {
        it(`excludes ${owner} and its handoff event`, () => {
            const { ctx, callback, scroll } = setup();
            const s = ctx.state;
            scroll(700);
            if (owner === "queued-follow") s.pendingMaintainScrollAtEnd = true;
            if (owner === "animated-follow") s.maintainingScrollAtEnd = "animated";
            if (owner === "explicit-end") s.scrollingTo = { animated: true, isScrollToEnd: true, offset: 700 } as any;
            if (owner === "queued-request") s.pendingScrollResolve = () => {};
            if (owner === "native-ref") s.scheduledWork.timeout(() => {}, 500, "appScrollRearm");
            if (owner === "initial") {
                s.initialScroll = { offset: 700 } as any;
                s.didFinishInitialScroll = false;
            }
            if (owner === "mvcp") s.pendingNativeMVCPAdjust = { amount: -50, startScroll: 700 } as any;
            if (owner === "adjust") ctx.values.set("scrollAdjustPending", -50);
            if (owner === "drag") s.isDragging = true;
            if (owner === "momentum") s.isMomentumScrolling = true;
            if (owner === "drag-handoff") {
                s.releasedFromUserDrag = true;
                s.scheduledWork.timeout(() => {}, 500, "endFollowRearm");
            }
            if (owner === "end-measurements") s.pendingEndMeasurements = new Set(["unmeasured"]);
            if (owner === "queued-end") s.pendingScrollToEnd = {} as any;
            if (owner === "mvcp-ignore") s.ignoreScrollFromMVCP = { gt: 0, lt: 700 };
            scroll(650);
            scroll(600);
            expect(callback).not.toHaveBeenCalled();
            s.pendingMaintainScrollAtEnd = false;
            s.maintainingScrollAtEnd = undefined;
            s.scrollingTo = undefined;
            s.pendingScrollResolve = undefined;
            s.initialScroll = undefined;
            s.didFinishInitialScroll = true;
            s.pendingNativeMVCPAdjust = undefined;
            ctx.values.set("scrollAdjustPending", 0);
            s.isDragging = false;
            s.isMomentumScrolling = false;
            s.releasedFromUserDrag = false;
            s.pendingEndMeasurements = undefined;
            s.pendingScrollToEnd = undefined;
            s.ignoreScrollFromMVCP = undefined;
            s.scheduledWork.cancel("appScrollRearm");
            s.scheduledWork.cancel("endFollowRearm");
            scroll(550);
            expect(callback).not.toHaveBeenCalled();
            ctx.state.scheduledWork.dispose();
        });
    }
    for (const metrics of ["append", "shrink-clamp", "viewport"]) {
        it(`excludes ${metrics} scroll events`, () => {
            const { ctx, callback, scroll } = setup();
            scroll(700);
            if (metrics === "append") {
                ctx.state.totalSize = 1100;
                scroll(650, 1100);
            }
            if (metrics === "shrink-clamp") {
                ctx.state.totalSize = 900;
                scroll(600, 900);
            }
            if (metrics === "viewport") {
                ctx.state.scrollLength = 400;
                scroll(600, 1000, 400);
            }
            expect(callback).not.toHaveBeenCalled();
            expect(peek$(ctx, "isFollowingEnd")).toBe(true);
            ctx.state.scheduledWork.dispose();
        });
    }
});
