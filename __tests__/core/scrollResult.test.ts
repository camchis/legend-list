import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import "../setup";

import { calculateItemsInView } from "@/core/calculateItemsInView";
import { cancelImperativeScroll } from "@/core/cancelImperativeScroll";
import { interruptUserScroll } from "@/core/cancelScroll";
import { checkFinishedScrollFallback } from "@/core/checkFinishedScroll";
import { interruptMaintainScrollAtEnd } from "@/core/doMaintainScrollAtEnd";
import { finishInitialScroll } from "@/core/finishInitialScroll";
import { handleLayout } from "@/core/handleLayout";
import { resetLayoutCachesForDataChange } from "@/core/resetLayoutCachesForDataChange";
import { updateItemPositions } from "@/core/updateItemPositions";
import { Platform } from "@/platform/Platform";
import { createImperativeHandle } from "@/utils/createImperativeHandle";
import { normalizeMaintainVisibleContentPosition } from "@/utils/normalizeMaintainVisibleContentPosition";
import {
    createWebScrollHarness,
    flushMicrotasks,
    trackScroll,
    type WebScrollHarness,
} from "../helpers/webScrollHarness";

let harness: WebScrollHarness | undefined;

beforeEach(() => {
    Platform.OS = "web";
    harness = createWebScrollHarness();
});

afterEach(() => {
    harness?.restore();
    harness = undefined;
});

describe("imperative scroll results", () => {
    for (const following of [false, true]) {
        for (const method of ["scrollIndexIntoView", "scrollItemIntoView"] as const) {
            it(`stops superseded ${following ? "end-follow" : "explicit"} motion for an already-visible ${method} target`, async () => {
                const h = harness!;
                const old = trackScroll(
                    following
                        ? h.ref.scrollToEnd({ animated: true })
                        : h.ref.scrollToIndex({ animated: true, index: 50 }),
                );
                h.browser.step(100);
                if (following) h.state.maintainingScrollAtEnd = "animated";
                const ref = createImperativeHandle(h.ctx);
                const result = trackScroll(
                    method === "scrollIndexIntoView"
                        ? ref.scrollIndexIntoView({ index: 2 })
                        : ref.scrollItemIntoView({ item: h.state.props.data[2] }),
                );
                await flushMicrotasks();
                expect(old.value).toBeUndefined();
                expect(result.resolved).toBe(true);
                expect(result.value).toBeUndefined();
                h.browser.runToEnd();
                h.clock.advance(100);
                expect(h.browser.offset).toBeLessThanOrEqual(200);
                expect(h.browser.offset + h.state.scrollLength).toBeGreaterThanOrEqual(300);
                expect(h.state.scrollingTo).toBeUndefined();
            });
        }
    }

    it("dispatches a fresh web RTL request using negative browser offsets", async () => {
        harness!.restore();
        harness = createWebScrollHarness({
            horizontal: true,
            horizontalRTLScrollType: "negative",
            rtl: true,
        });
        const h = harness;
        h.state.horizontalRTLScrollType = undefined;
        const result = trackScroll(h.ref.scrollToIndex({ animated: false, index: 20 }));
        h.clock.advance(1000);
        await flushMicrotasks();
        expect(h.browser.offset).toBe(2000);
        expect(result.resolved).toBe(true);
        expect(result.value).toBeUndefined();
    });

    it("keeps offset initial-scroll completion in logical RTL coordinates", () => {
        harness!.restore();
        harness = createWebScrollHarness({
            horizontal: true,
            horizontalRTLScrollType: "negative",
            rtl: true,
        });
        const h = harness;
        h.browser.moveTo(500);
        h.state.initialScrollSession = { kind: "offset" } as any;
        finishInitialScroll(h.ctx, { syncObservedOffset: true });
        expect(h.state.scroll).toBe(500);
        expect(h.state.scrollPending).toBe(500);
        expect(h.state.scrollPrev).toBe(500);
    });

    it("settles a key still missing after the settle window without dispatch", async () => {
        const h = harness!;
        spyOn(Date, "now").mockImplementation(() => h.clock.now);
        const result = trackScroll(h.ref.scrollToKey({ animated: true, key: "absent" }));
        await flushMicrotasks();
        expect(result.resolved).toBe(false);
        h.clock.advance(1000);
        await flushMicrotasks();
        expect(result.resolved).toBe(true);
        expect(result.value).toBeUndefined();
        expect(h.scrollToCalls).toHaveLength(0);
    });

    it("retargets scrollToEnd when rows are appended during the animation", async () => {
        const h = harness!;
        const result = trackScroll(h.ref.scrollToEnd({ animated: true }));
        h.browser.step(400);
        h.setData(110);
        updateItemPositions(h.ctx, true);
        await flushMicrotasks();
        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(result.resolved).toBe(true);
        expect(result.value).toBeUndefined();
        expect(h.browser.offset).toBe(10500);
    });

    it("retries the new native end after rows are appended", async () => {
        const h = harness!;
        Platform.OS = "ios";
        h.state.didContainersLayout = h.state.didFinishInitialScroll = true;
        const result = trackScroll(h.ref.scrollToEnd({ animated: false }));
        h.state.scroll = h.state.scrollPending = 9500;
        h.setData(110);
        updateItemPositions(h.ctx, true);
        checkFinishedScrollFallback(h.ctx);
        await flushMicrotasks();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(h.scrollToCalls.at(-1)?.y).toBe(10500);
        h.state.scroll = h.state.scrollPending = 10500;
        h.clock.advance(100);
        await flushMicrotasks();
        expect(result.resolved).toBe(true);
        expect(result.value).toBeUndefined();
    });

    it("lands on a key that arrives in the render after the call", async () => {
        const h = harness!;
        const result = trackScroll(h.ref.scrollToKey({ animated: true, key: "item_100" }));
        h.setData(101);
        h.clock.advance(32);
        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(result.resolved).toBe(true);
        expect(result.value).toBeUndefined();
        expect(h.browser.offset).toBe(9600);
    });

    for (const queued of [true, false]) {
        it(`settles a deleted ${queued ? "queued" : "active"} keyed target`, async () => {
            const h = harness!;
            h.ctx.values.set("numContainers", 10);
            h.ctx.values.set("readyToRender", true);
            h.state.didContainersLayout = true;
            h.state.didFinishInitialScroll = true;
            h.state.props.keyExtractor = (item: { id: number }) => `item_${item.id}`;
            h.state.didDataChange = queued;
            spyOn(Date, "now").mockImplementation(() => h.clock.now);
            const result = trackScroll(h.ref.scrollToKey({ animated: true, key: "item_50" }));
            if (!queued) h.browser.step(400);
            const calls = h.scrollToCalls.length;
            h.setData(10);
            calculateItemsInView(h.ctx, { dataChanged: true, doMVCP: true });
            h.state.didDataChange = false;
            h.clock.advance(1000);
            await flushMicrotasks();
            expect(result.resolved).toBe(true);
            expect(result.value).toBeUndefined();
            expect(h.state.scrollingTo).toBeUndefined();
            expect(h.scrollToCalls.length).toBeLessThanOrEqual(calls + 1);
        });
    }

    for (const method of ["scrollToItem", "scrollItemIntoView"] as const) {
        it(`settles a missing ${method} item`, async () => {
            const h = harness!;
            const result = trackScroll(h.ref[method]({ animated: true, item: { id: -1 } }));
            await flushMicrotasks();
            expect(result.resolved).toBe(true);
            expect(result.value).toBeUndefined();
        });
        it(`settles a deleted active ${method} item`, async () => {
            const h = harness!;
            const result = trackScroll(h.ref[method]({ animated: true, item: h.state.props.data[50] }));
            h.browser.step(400);
            h.setData(10);
            updateItemPositions(h.ctx, true);
            await flushMicrotasks();
            expect(result.value).toBeUndefined();
            expect(h.state.scrollingTo).toBeUndefined();
        });
        it(`retains ${method} through an immutable same-key update and prepend`, async () => {
            const h = harness!;
            h.state.props.keyExtractor = (item: { id: number }) => `item_${item.id}`;
            const result = trackScroll(h.ref[method]({ animated: true, item: h.state.props.data[50] }));
            h.browser.step(400);
            h.state.props.data = [{ id: -1 }, ...h.state.props.data.map((item: { id: number }) => ({ ...item }))];
            resetLayoutCachesForDataChange(h.state);
            updateItemPositions(h.ctx, true);
            expect(h.state.scrollingTo?.index).toBe(51);
            expect(result.resolved).toBe(false);
            h.browser.runToEnd();
            h.clock.advance(100);
            await flushMicrotasks();
            expect(result.resolved).toBe(true);
            expect(result.value).toBeUndefined();
            expect(h.browser.offset).toBe(method === "scrollToItem" ? 5100 : 4700);
        });
    }

    it("retains an item key when viewport resize retargets navigation", async () => {
        const h = harness!;
        h.state.props.keyExtractor = (entry: { id: number }) => `item_${entry.id}`;
        h.state.lastLayout = { height: 500, width: 400, x: 0, y: 0 };
        h.state.otherAxisSize = 400;
        const item = h.state.props.data[50];
        const result = trackScroll(h.ref.scrollItemIntoView({ animated: true, item }));
        await flushMicrotasks();
        h.browser.step(400);
        const key = h.state.scrollingTo?.key;
        expect(key).toBe("item_50");
        handleLayout(h.ctx, { height: 450, width: 400, x: 0, y: 0 }, () => {});
        const resizedKey = h.state.scrollingTo?.key;
        h.state.props.data = h.state.props.data.filter((entry: { id: number }) => entry !== item);
        resetLayoutCachesForDataChange(h.state);
        updateItemPositions(h.ctx, true);
        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(resizedKey).toBe(key);
        expect(result.resolved).toBe(true);
        expect(result.value).toBeUndefined();
        expect(h.state.scrollingTo).toBeUndefined();
    });

    it("keeps index ownership for item navigation without a key extractor", async () => {
        const h = harness!;
        const result = trackScroll(h.ref.scrollToItem({ animated: true, item: h.state.props.data[50] }));
        h.browser.step(400);
        h.state.props.data = h.state.props.data.map((item: { id: number }) => ({ ...item }));
        updateItemPositions(h.ctx, true);
        expect(h.state.scrollingTo?.index).toBe(50);
        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(result.value).toBeUndefined();
        expect(h.browser.offset).toBe(5000);
    });

    it("stops once without duplicate MVCP writes when the active target and an earlier row are deleted", async () => {
        const h = harness!;
        h.ctx.values.set("numContainers", 10);
        h.ctx.values.set("readyToRender", true);
        h.state.didContainersLayout = h.state.didFinishInitialScroll = true;
        h.state.props.keyExtractor = (item: { id: number }) => `item_${item.id}`;
        h.state.props.maintainVisibleContentPosition = normalizeMaintainVisibleContentPosition(true);
        const result = trackScroll(h.ref.scrollToKey({ animated: true, key: "item_50" }));
        h.browser.step(400);
        h.state.props.data = h.state.props.data.filter((item: { id: number }) => item.id !== 0 && item.id !== 50);
        const calls = h.scrollToCalls.length;
        calculateItemsInView(h.ctx, { dataChanged: true, doMVCP: true });
        h.clock.advance(100);
        await flushMicrotasks();
        expect(result.value).toBeUndefined();
        // The removed scroll target owned MVCP; its obsolete correction must be abandoned.
        expect(h.state.scroll).toBe(400);
        expect(h.browser.offset).toBe(400);
        expect(h.scrollToCalls.slice(calls).map(({ y }) => y)).toEqual([400]);
    });

    it("keeps an already visible row successful", async () => {
        const result = trackScroll(harness!.ref.scrollIndexIntoView({ index: 0 }));
        await flushMicrotasks();
        expect(result.resolved).toBe(true);
        expect(result.value).toBeUndefined();
    });

    for (const method of ["scrollIndexIntoView", "scrollItemIntoView"] as const) {
        it(`aligns the start of an oversized row entering the viewport with ${method}`, async () => {
            const h = harness!;
            h.measure({ 2: 800 });
            const result = trackScroll(
                method === "scrollIndexIntoView"
                    ? h.ref.scrollIndexIntoView({ index: 2 })
                    : h.ref.scrollItemIntoView({ item: h.state.props.data[2] }),
            );
            h.browser.runToEnd();
            h.clock.advance(100);
            await flushMicrotasks();

            expect(result.resolved).toBe(true);
            expect(result.value).toBeUndefined();
            expect(h.browser.offset).toBe(200);
        });
    }

    for (const offset of [0, 250, 500]) {
        it(`leaves an oversized row covering the viewport in place (offset: ${offset})`, async () => {
            const h = harness!;
            h.measure({ 0: 1000 });
            h.browser.moveTo(offset);
            for (let i = 0; i < 2; i++) {
                const result = trackScroll(h.ref.scrollIndexIntoView({ index: 0 }));
                h.browser.runToEnd();
                h.clock.advance(100);
                await flushMicrotasks();
                expect(result.resolved).toBe(true);
                expect(result.value).toBeUndefined();
                expect(h.browser.offset).toBe(offset);
            }
            expect(h.scrollToCalls).toHaveLength(0);
        });
    }

    it("settles a missing reveal index", async () => {
        const result = trackScroll(harness!.ref.scrollIndexIntoView({ index: 100 }));
        await flushMicrotasks();
        expect(result.value).toBeUndefined();
    });

    for (const index of [-1, 200]) {
        it(`clamps scrollToIndex to existing data after settling (index: ${index})`, async () => {
            const h = harness!;
            spyOn(Date, "now").mockImplementation(() => h.clock.now);
            h.browser.moveTo(500);
            const result = trackScroll(h.ref.scrollToIndex({ animated: true, index }));
            h.clock.advance(1000);
            h.browser.runToEnd();
            h.clock.advance(100);
            await flushMicrotasks();
            expect(result.resolved).toBe(true);
            expect(result.value).toBeUndefined();
            expect(h.browser.offset).toBe(index < 0 ? 0 : 9500);
        });
    }

    for (const headerSize of [0, 1200]) {
        it(`settles scrollToEnd on empty data (header: ${headerSize})`, async () => {
            const h = harness!;
            h.setData(0);
            h.ctx.values.set("headerSize", headerSize);
            const result = trackScroll(h.ref.scrollToEnd({ animated: true }));
            await flushMicrotasks();
            expect(result.resolved).toBe(true);
            expect(result.value).toBeUndefined();
            expect(h.scrollToCalls).toHaveLength(0);
            expect(h.browser.offset).toBe(0);
        });
    }

    it("settles scrollToIndex on empty data", async () => {
        const h = harness!;
        h.setData(0);
        spyOn(Date, "now").mockImplementation(() => h.clock.now);
        const result = trackScroll(h.ref.scrollToIndex({ index: 0 }));
        h.clock.advance(1000);
        await flushMicrotasks();
        expect(result.value).toBeUndefined();
        expect(h.scrollToCalls).toHaveLength(0);
    });

    it("settles an active index removed by truncation", async () => {
        const h = harness!;
        const result = trackScroll(h.ref.scrollToIndex({ animated: true, index: 50 }));
        h.browser.step(400);
        h.setData(10);
        updateItemPositions(h.ctx, true);
        await flushMicrotasks();
        expect(result.value).toBeUndefined();
        expect(h.state.scrollingTo).toBeUndefined();
    });

    it("waits for observed landing with scrollToKey", async () => {
        const h = harness!;
        const result = trackScroll(h.ref.scrollToKey({ animated: true, key: "item_50" }));
        await flushMicrotasks();
        expect(result.resolved).toBe(false);
        h.browser.step(100);
        await flushMicrotasks();
        expect(result.resolved).toBe(false);
        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(h.browser.offset).toBe(5000);
        expect(result.resolved).toBe(true);
        expect(result.value).toBeUndefined();
    });

    it("waits for clamped landing with scrollToOffset", async () => {
        const h = harness!;
        h.browser.moveTo(500);
        spyOn(Date, "now").mockImplementation(() => h.clock.now);
        const result = trackScroll(h.ref.scrollToOffset({ animated: true, offset: 20000 }));
        await flushMicrotasks();
        expect(result.resolved).toBe(false);
        h.clock.advance(1000);
        await flushMicrotasks();
        expect(result.resolved).toBe(false);
        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(h.browser.offset).toBe(9500);
        expect(result.resolved).toBe(true);
    });

    for (const edge of ["start", "end", "inset"] as const) {
        it(`reveals a normal row clipped at the ${edge} boundary despite an inclusive render range`, async () => {
            const h = harness!;
            const offset = edge === "start" ? 210 : edge === "inset" ? 100 : 90;
            const index = edge === "start" ? 2 : 5;
            h.browser.moveTo(offset);
            h.state.startNoBuffer = 0;
            h.state.endNoBuffer = 10;
            if (edge === "inset") h.state.contentInsetOverride = { bottom: 10 };
            const result = trackScroll(h.ref.scrollIndexIntoView({ index }));
            h.browser.runToEnd();
            h.clock.advance(100);
            await flushMicrotasks();
            expect(h.browser.offset).toBe(edge === "start" ? 200 : edge === "inset" ? 110 : 100);
            expect(result.resolved).toBe(true);
            const calls = h.scrollToCalls.length;
            await h.ref.scrollIndexIntoView({ index });
            expect(h.scrollToCalls).toHaveLength(calls);
        });
    }

    for (const extent of ["headerSize", "footerSize"] as const) {
        for (const method of [
            "scrollToIndex",
            "scrollToItem",
            "scrollToKey",
            "scrollToEnd",
            "scrollIndexIntoView",
            "scrollItemIntoView",
        ] as const) {
            it(`settles empty ${method} without transport with ${extent}`, async () => {
                const h = harness!;
                h.setData(0);
                h.ctx.values.set(extent, 1200);
                spyOn(Date, "now").mockImplementation(() => h.clock.now);
                const result = trackScroll(h.ref[method]({ index: 0, item: { id: 0 }, key: "item_0" }));
                h.clock.advance(1000);
                await flushMicrotasks();
                expect(result.resolved).toBe(true);
                expect(result.value).toBeUndefined();
                expect(h.scrollToCalls).toHaveLength(0);
            });
        }
    }

    it("emits public following transitions until unsubscribe", async () => {
        const h = harness!;
        h.state.props.maintainScrollAtEnd = { animated: false };
        const values: boolean[] = [];
        const unsubscribe = h.ref.getState().listen("isFollowingEnd", (value) => values.push(value));
        const end = h.ref.scrollToEnd({ animated: false });
        h.clock.advance(100);
        await end;
        interruptMaintainScrollAtEnd(h.ctx);
        const next = h.ref.scrollToEnd({ animated: false });
        h.clock.advance(100);
        await next;
        expect(values).toEqual([false, true, false, true]);
        unsubscribe();
        interruptMaintainScrollAtEnd(h.ctx);
        expect(values).toEqual([false, true, false, true]);
    });

    it("resolves a landed scroll", async () => {
        const h = harness!;
        const scroll = trackScroll(h.ref.scrollToOffset({ animated: true, offset: 1200 }));

        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();

        expect(scroll.resolved).toBe(true);
        expect(scroll.value).toBeUndefined();
        expect(h.browser.offset).toBe(1200);
    });

    it("settles a superseded scrollToIndex and lands the newer one", async () => {
        const h = harness!;
        const first = trackScroll(h.ref.scrollToIndex({ animated: true, index: 50 }));
        h.browser.step(400);

        const second = trackScroll(h.ref.scrollToOffset({ animated: true, offset: 300 }));
        await flushMicrotasks();
        expect(first.resolved).toBe(true);
        expect(first.value).toBeUndefined();
        expect(second.resolved).toBe(false);

        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(second.resolved).toBe(true);
        expect(second.value).toBeUndefined();
        expect(h.browser.offset).toBe(300);
    });

    it("settles a scroll waiting for data to settle when replaced", async () => {
        const h = harness!;
        h.state.didDataChange = true;
        const first = trackScroll(h.ref.scrollToIndex({ animated: true, index: 20 }));
        const second = trackScroll(h.ref.scrollToIndex({ animated: true, index: 30 }));
        await flushMicrotasks();

        expect(first.value).toBeUndefined();
        expect(second.resolved).toBe(false);
    });

    it("settles when user input stops an end-follow scroll", async () => {
        const h = harness!;
        const scroll = trackScroll(h.ref.scrollToEnd({ animated: true }));
        h.clock.tick();
        h.state.maintainingScrollAtEnd = "animated";
        h.browser.step(400);

        interruptMaintainScrollAtEnd(h.ctx);
        expect(h.state.scrollingTo).toBeUndefined();
        await flushMicrotasks();
        expect(scroll.value).toBeUndefined();
    });

    it("supersedes active end following when a newer explicit request takes ownership", async () => {
        const h = harness!;
        const first = trackScroll(h.ref.scrollToEnd({ animated: true }));
        h.clock.tick();
        h.state.maintainingScrollAtEnd = "animated";
        h.browser.step(400);

        const second = trackScroll(h.ref.scrollToOffset({ animated: true, offset: 300 }));
        await flushMicrotasks();
        expect(first.value).toBeUndefined();
        expect(second.resolved).toBe(false);

        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(second.resolved).toBe(true);
        expect(second.value).toBeUndefined();
        expect(h.browser.offset).toBe(300);
    });

    for (const maintaining of [false, true]) {
        it(`settles user cancellation (end following: ${maintaining})`, async () => {
            const h = harness!;
            const scroll = trackScroll(h.ref.scrollToEnd({ animated: true }));
            h.clock.tick();
            if (maintaining) h.state.maintainingScrollAtEnd = "animated";
            h.browser.step(400);

            interruptUserScroll(h.ctx);
            await flushMicrotasks();
            expect(scroll.value).toBeUndefined();
            expect(h.browser.destination).toBeUndefined();
            expect(h.state.scrollingTo).toBeUndefined();
        });

        it(`settles programmatic cancellation (end following: ${maintaining})`, async () => {
            const h = harness!;
            const scroll = trackScroll(h.ref.scrollToEnd({ animated: true }));
            h.clock.tick();
            if (maintaining) h.state.maintainingScrollAtEnd = "animated";
            h.browser.step(400);

            h.ref.cancelScroll();
            await flushMicrotasks();
            expect(scroll.value).toBeUndefined();
            expect(h.browser.destination).toBeUndefined();
            expect(h.state.scrollingTo).toBeUndefined();
        });
    }

    it("settles a queued request when user input cancels it", async () => {
        const h = harness!;
        h.state.didDataChange = true;
        const scroll = trackScroll(h.ref.scrollToIndex({ animated: true, index: 20 }));
        expect(h.state.scrollingTo).toBeUndefined();

        interruptUserScroll(h.ctx);
        h.state.didDataChange = false;
        h.clock.advance(2000);
        await flushMicrotasks();
        expect(scroll.value).toBeUndefined();
        expect(h.scrollToCalls).toHaveLength(0);
    });

    it("settles on programmatic teardown", async () => {
        const h = harness!;
        const scroll = trackScroll(h.ref.scrollToIndex({ animated: true, index: 50 }));
        h.browser.step(400);

        cancelImperativeScroll(h.state);
        await flushMicrotasks();
        expect(scroll.value).toBeUndefined();
        expect(scroll.rejected).toBe(false);
    });
});

// Apps place a DOM range by scrolling to its key, measuring, then scrolling to a precise offset.
describe("scrollToOffset as a list-owned scroll", () => {
    it("replaces an in-flight keyed scroll and settles when the offset lands", async () => {
        const h = harness!;
        h.state.props.keyExtractor = (item: { id: number }) => `item_${item.id}`;
        const keyed = trackScroll(h.ref.scrollToKey({ animated: true, key: "item_50" }));
        h.clock.tick();
        h.browser.step(400);
        expect(h.browser.destination).toBe(h.targetOffsetForIndex(50));

        const placed = trackScroll(h.ref.scrollToOffset({ animated: true, offset: 1234 }));
        await flushMicrotasks();
        expect(keyed.resolved).toBe(true);
        expect(placed.resolved).toBe(false);
        expect(h.state.scrollingTo?.index).toBeUndefined();
        expect(h.browser.destination).toBe(1234);

        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(placed.resolved).toBe(true);
        expect(h.browser.offset).toBe(1234);
        expect(h.scrollToCalls.at(-1)?.y).toBe(1234);
    });
});
