import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import "../setup";

import { calculateItemsInView } from "@/core/calculateItemsInView";
import { cancelImperativeScroll } from "@/core/cancelImperativeScroll";
import { interruptUserScroll } from "@/core/cancelScroll";
import { interruptMaintainScrollAtEnd } from "@/core/doMaintainScrollAtEnd";
import { finishScrollTo } from "@/core/finishScrollTo";
import { resetLayoutCachesForDataChange } from "@/core/resetLayoutCachesForDataChange";
import { scrollElementIntoView } from "@/core/scrollElementIntoView";
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
    it("resolves a key still missing after the settle window as unreachable without dispatch", async () => {
        const h = harness!;
        spyOn(Date, "now").mockImplementation(() => h.clock.now);
        const result = trackScroll(h.ref.scrollToKey({ animated: true, key: "absent" }));
        await flushMicrotasks();
        expect(result.resolved).toBe(false);
        h.clock.advance(1000);
        await flushMicrotasks();
        expect(result.resolved).toBe(true);
        expect(result.value).toEqual({ reason: "unreachable" });
        expect(h.scrollToCalls).toHaveLength(0);
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
        it(`resolves a deleted ${queued ? "queued" : "active"} keyed target as unreachable`, async () => {
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
            expect(result.value).toEqual({ reason: "unreachable" });
            expect(h.state.scrollingTo).toBeUndefined();
            expect(h.scrollToCalls.length).toBeLessThanOrEqual(calls + 1);
        });
    }

    for (const method of ["scrollToItem", "scrollItemIntoView"] as const) {
        it(`resolves a missing ${method} item as unreachable`, async () => {
            const h = harness!;
            const result = trackScroll(h.ref[method]({ animated: true, item: { id: -1 } }));
            await flushMicrotasks();
            expect(result.resolved).toBe(true);
            expect(result.value).toEqual({ reason: "unreachable" });
        });
        it(`resolves a deleted active ${method} item as unreachable`, async () => {
            const h = harness!;
            const result = trackScroll(h.ref[method]({ animated: true, item: h.state.props.data[50] }));
            h.browser.step(400);
            h.setData(10);
            updateItemPositions(h.ctx, true);
            await flushMicrotasks();
            expect(result.value).toEqual({ reason: "unreachable" });
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

    for (const retarget of [false, true]) {
        it(`preserves a newer waiting request when an older DOM target detaches (retarget: ${retarget})`, async () => {
            const h = harness!;
            const target = { element: { isConnected: false } as any };
            void h.ref.scrollToOffset({ animated: true, offset: 1000 });
            h.state.didDataChange = true;
            const newer = trackScroll(h.ref.scrollToIndex({ animated: true, index: 20 }));
            // A queued retarget/completion from the older request still sees its detached element.
            h.state.scrollElementTarget = target;
            h.state.refScroller.current!.getScrollableNode = () => ({ getBoundingClientRect() {} }) as any;
            if (retarget) scrollElementIntoView(h.ctx, true);
            else finishScrollTo(h.ctx);
            await flushMicrotasks();
            expect(newer.resolved).toBe(false);
            h.state.scrollElementTarget = undefined;
            h.state.didDataChange = false;
            h.clock.advance(32);
            h.browser.runToEnd();
            h.clock.advance(100);
            await flushMicrotasks();
            expect(newer.resolved).toBe(true);
            expect(newer.value).toBeUndefined();
            expect(h.browser.offset).toBe(2000);
        });
    }

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
        expect(result.value).toEqual({ reason: "unreachable" });
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

    it("resolves a missing reveal index as unreachable", async () => {
        const result = trackScroll(harness!.ref.scrollIndexIntoView({ index: 100 }));
        await flushMicrotasks();
        expect(result.value).toEqual({ reason: "unreachable" });
    });

    for (const detachedDuringScroll of [false, true]) {
        it(`resolves an element detached ${detachedDuringScroll ? "during" : "before"} scrolling as unreachable`, async () => {
            const h = harness!;
            const element = {
                getBoundingClientRect: () => ({
                    bottom: 1500,
                    height: 100,
                    left: 0,
                    right: 100,
                    top: 1400,
                    width: 100,
                }),
                isConnected: detachedDuringScroll,
            };
            h.state.refScroller.current!.getScrollableNode = () =>
                ({
                    getBoundingClientRect: () => ({
                        bottom: 500,
                        height: 500,
                        left: 0,
                        right: 100,
                        top: 0,
                        width: 100,
                    }),
                }) as any;
            const result = trackScroll(
                createImperativeHandle(h.ctx).scrollElementIntoView({ animated: true, element: element as any }),
            );
            element.isConnected = false;
            if (detachedDuringScroll) {
                h.browser.runToEnd();
                h.clock.advance(100);
            }
            await flushMicrotasks();
            expect(result.resolved).toBe(true);
            expect(result.value).toEqual({ reason: "unreachable" });
            expect(h.state.scrollingTo).toBeUndefined();
        });
    }

    it("resolves an index that is still missing after settling as unreachable", async () => {
        const h = harness!;
        spyOn(Date, "now").mockImplementation(() => h.clock.now);
        const result = trackScroll(h.ref.scrollToIndex({ animated: true, index: 200 }));
        h.clock.advance(1000);
        await flushMicrotasks();
        expect(result.value).toEqual({ reason: "unreachable" });
        expect(h.scrollToCalls).toHaveLength(0);
    });

    it("resolves an active index removed by truncation as unreachable", async () => {
        const h = harness!;
        const result = trackScroll(h.ref.scrollToIndex({ animated: true, index: 50 }));
        h.browser.step(400);
        h.setData(10);
        updateItemPositions(h.ctx, true);
        await flushMicrotasks();
        expect(result.value).toEqual({ reason: "unreachable" });
        expect(h.state.scrollingTo).toBeUndefined();
    });

    it("resolves a landed scroll with undefined", async () => {
        const h = harness!;
        const scroll = trackScroll(h.ref.scrollToOffset({ animated: true, offset: 1200 }));

        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();

        expect(scroll.resolved).toBe(true);
        expect(scroll.value).toBeUndefined();
        expect(h.browser.offset).toBe(1200);
    });

    it("resolves a superseded scrollToIndex with reason superseded and lands the newer one", async () => {
        const h = harness!;
        const first = trackScroll(h.ref.scrollToIndex({ animated: true, index: 50 }));
        h.browser.step(400);

        const second = trackScroll(h.ref.scrollToOffset({ animated: true, offset: 300 }));
        await flushMicrotasks();
        expect(first.resolved).toBe(true);
        expect(first.value).toEqual({ reason: "superseded" });
        expect(second.resolved).toBe(false);

        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(second.resolved).toBe(true);
        expect(second.value).toBeUndefined();
        expect(h.browser.offset).toBe(300);
    });

    it("resolves a scroll waiting for data to settle as superseded when replaced", async () => {
        const h = harness!;
        h.state.didDataChange = true;
        const first = trackScroll(h.ref.scrollToIndex({ animated: true, index: 20 }));
        const second = trackScroll(h.ref.scrollToIndex({ animated: true, index: 30 }));
        await flushMicrotasks();

        expect(first.value).toEqual({ reason: "superseded" });
        expect(second.resolved).toBe(false);
    });

    it("resolves with reason interrupted when user input stops an end-follow scroll", async () => {
        const h = harness!;
        const scroll = trackScroll(h.ref.scrollToEnd({ animated: true }));
        h.clock.tick();
        h.state.maintainingScrollAtEnd = "animated";
        h.browser.step(400);

        expect(interruptMaintainScrollAtEnd(h.ctx)).toBe(true);
        await flushMicrotasks();
        expect(scroll.value).toEqual({ reason: "interrupted" });
    });

    it("supersedes active end following when a newer explicit request takes ownership", async () => {
        const h = harness!;
        const first = trackScroll(h.ref.scrollToEnd({ animated: true }));
        h.clock.tick();
        h.state.maintainingScrollAtEnd = "animated";
        h.browser.step(400);

        const second = trackScroll(h.ref.scrollToOffset({ animated: true, offset: 300 }));
        await flushMicrotasks();
        expect(first.value).toEqual({ reason: "superseded" });
        expect(second.resolved).toBe(false);

        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(second.resolved).toBe(true);
        expect(second.value).toBeUndefined();
        expect(h.browser.offset).toBe(300);
    });

    for (const maintaining of [false, true]) {
        it(`resolves user cancellation as interrupted (end following: ${maintaining})`, async () => {
            const h = harness!;
            const scroll = trackScroll(h.ref.scrollToEnd({ animated: true }));
            h.clock.tick();
            if (maintaining) h.state.maintainingScrollAtEnd = "animated";
            h.browser.step(400);

            interruptUserScroll(h.ctx);
            await flushMicrotasks();
            expect(scroll.value).toEqual({ reason: "interrupted" });
            expect(h.browser.destination).toBeUndefined();
            expect(h.state.scrollingTo).toBeUndefined();
        });

        it(`resolves programmatic cancellation as superseded (end following: ${maintaining})`, async () => {
            const h = harness!;
            const scroll = trackScroll(h.ref.scrollToEnd({ animated: true }));
            h.clock.tick();
            if (maintaining) h.state.maintainingScrollAtEnd = "animated";
            h.browser.step(400);

            h.ref.cancelScroll();
            await flushMicrotasks();
            expect(scroll.value).toEqual({ reason: "superseded" });
            expect(h.browser.destination).toBeUndefined();
            expect(h.state.scrollingTo).toBeUndefined();
        });
    }

    it("resolves a queued request as interrupted when user input cancels it", async () => {
        const h = harness!;
        h.state.didDataChange = true;
        const scroll = trackScroll(h.ref.scrollToIndex({ animated: true, index: 20 }));
        expect(h.state.scrollingTo).toBeUndefined();

        interruptUserScroll(h.ctx);
        h.state.didDataChange = false;
        h.clock.advance(2000);
        await flushMicrotasks();
        expect(scroll.value).toEqual({ reason: "interrupted" });
        expect(h.scrollToCalls).toHaveLength(0);
    });

    it("resolves programmatic teardown with the default superseded reason", async () => {
        const h = harness!;
        const scroll = trackScroll(h.ref.scrollToIndex({ animated: true, index: 50 }));
        h.browser.step(400);

        cancelImperativeScroll(h.state);
        await flushMicrotasks();
        expect(scroll.value).toEqual({ reason: "superseded" });
        expect(scroll.rejected).toBe(false);
    });
});
