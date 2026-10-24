import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import "../setup";

import { calculateItemsInView } from "@/core/calculateItemsInView";
import { cancelImperativeScroll } from "@/core/cancelImperativeScroll";
import { interruptUserScroll } from "@/core/cancelScroll";
import { checkFinishedScrollFallback } from "@/core/checkFinishedScroll";
import { checkResetContainers } from "@/core/checkResetContainers";
import { interruptMaintainScrollAtEnd } from "@/core/doMaintainScrollAtEnd";
import { finishInitialScroll } from "@/core/finishInitialScroll";
import { finishScrollTo } from "@/core/finishScrollTo";
import { handleLayout } from "@/core/handleLayout";
import { resetLayoutCachesForDataChange } from "@/core/resetLayoutCachesForDataChange";
import { scrollElementIntoView } from "@/core/scrollElementIntoView";
import { updateItemPositions } from "@/core/updateItemPositions";
import { updateItemSizes } from "@/core/updateItemSizes";
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
        for (const method of ["scrollIndexIntoView", "scrollItemIntoView", "scrollElementIntoView"] as const) {
            it(`stops superseded ${following ? "end-follow" : "explicit"} motion for an already-visible ${method} target`, async () => {
                const h = harness!;
                const old = trackScroll(
                    following
                        ? h.ref.scrollToEnd({ animated: true })
                        : h.ref.scrollToIndex({ animated: true, index: 50 }),
                );
                h.browser.step(100);
                if (following) h.state.maintainingScrollAtEnd = "animated";
                h.state.refScroller.current!.getScrollableNode = () =>
                    ({
                        clientHeight: 500,
                        clientLeft: 0,
                        clientTop: 0,
                        clientWidth: 100,
                        getBoundingClientRect: () => ({ left: 0, top: 0 }),
                    }) as any;
                const element = {
                    getBoundingClientRect: () => ({
                        bottom: 300 - h.browser.offset,
                        height: 100,
                        top: 200 - h.browser.offset,
                    }),
                    isConnected: true,
                };
                const ref = createImperativeHandle(h.ctx);
                const result = trackScroll(
                    method === "scrollIndexIntoView"
                        ? ref.scrollIndexIntoView({ index: 2 })
                        : method === "scrollItemIntoView"
                          ? ref.scrollItemIntoView({ item: h.state.props.data[2] })
                          : ref.scrollElementIntoView({ element: element as any }),
                );
                await flushMicrotasks();
                expect(old.value).toEqual({ reason: "superseded" });
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
        expect(result.value).toEqual({ reason: "unreachable" });
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
            if (retarget) scrollElementIntoView(h.ctx);
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

    for (const trigger of ["measurement", "data change"]) {
        it(`queued DOM retarget after ${trigger} does not cancel a newer active offset request`, async () => {
            const h = harness!;
            let top = 1400;
            const element = {
                getBoundingClientRect: () => ({
                    bottom: top + 100 - h.browser.offset,
                    height: 100,
                    left: 0,
                    right: 100,
                    top: top - h.browser.offset,
                    width: 100,
                }),
                isConnected: true,
            };
            h.state.refScroller.current!.getScrollableNode = () =>
                ({
                    clientHeight: 500,
                    clientLeft: 0,
                    clientTop: 0,
                    clientWidth: 100,
                    getBoundingClientRect: () => ({ bottom: 500, left: 0, right: 100, top: 0 }),
                }) as any;
            const old = trackScroll(
                createImperativeHandle(h.ctx).scrollElementIntoView({ animated: true, element: element as any }),
            );
            h.browser.step(100);
            top += 20;
            if (trigger === "measurement") {
                updateItemSizes(h.ctx, { itemKey: "item_0", size: { height: 120, width: 100 } });
            } else {
                h.setData(101);
                checkResetContainers(h.ctx, h.state.props.data);
            }
            const newer = trackScroll(h.ref.scrollToOffset({ animated: true, offset: 5000 }));
            await flushMicrotasks();
            expect(old.value).toEqual({ reason: "superseded" });
            expect(newer.resolved).toBe(false);
            h.browser.runToEnd();
            h.clock.advance(100);
            await flushMicrotasks();
            expect(newer.resolved).toBe(true);
            expect(newer.value).toBeUndefined();
            expect(h.browser.offset).toBe(5000);
        });
    }

    it("resolves a missing reveal index as unreachable", async () => {
        const result = trackScroll(harness!.ref.scrollIndexIntoView({ index: 100 }));
        await flushMicrotasks();
        expect(result.value).toEqual({ reason: "unreachable" });
    });

    it("preserves animated element reveal when item measurements retarget it", async () => {
        const h = harness!;
        let top = 1400;
        const element = {
            getBoundingClientRect: () => ({
                bottom: top + 100 - h.browser.offset,
                height: 100,
                left: 0,
                right: 100,
                top: top - h.browser.offset,
                width: 100,
            }),
            isConnected: true,
        };
        h.state.refScroller.current!.getScrollableNode = () =>
            ({
                clientHeight: 500,
                clientLeft: 0,
                clientTop: 0,
                clientWidth: 100,
                getBoundingClientRect: () => ({ bottom: 500, left: 0, right: 100, top: 0 }),
            }) as any;
        const result = trackScroll(
            createImperativeHandle(h.ctx).scrollElementIntoView({ animated: true, element: element as any }),
        );
        h.browser.step(100);
        top += 20;
        updateItemSizes(h.ctx, { itemKey: "item_0", size: { height: 120, width: 100 } });
        await flushMicrotasks();
        expect(h.scrollToCalls.at(-1)?.animated).toBe(true);
        expect(h.browser.offset).toBe(100);
        h.browser.runToEnd();
        h.clock.advance(100);
        await flushMicrotasks();
        expect(result.resolved).toBe(true);
        expect(result.value).toBeUndefined();
        expect(h.browser.offset).toBe(1020);
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
                    clientHeight: 500,
                    clientLeft: 0,
                    clientTop: 0,
                    clientWidth: 100,
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
        it(`resolves scrollToEnd on empty data as unreachable (header: ${headerSize})`, async () => {
            const h = harness!;
            h.setData(0);
            h.ctx.values.set("headerSize", headerSize);
            const result = trackScroll(h.ref.scrollToEnd({ animated: true }));
            await flushMicrotasks();
            expect(result.resolved).toBe(true);
            expect(result.value).toEqual({ reason: "unreachable" });
            expect(h.scrollToCalls).toHaveLength(0);
            expect(h.browser.offset).toBe(0);
        });
    }

    it("resolves scrollToIndex on empty data as unreachable", async () => {
        const h = harness!;
        h.setData(0);
        spyOn(Date, "now").mockImplementation(() => h.clock.now);
        const result = trackScroll(h.ref.scrollToIndex({ index: 0 }));
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
