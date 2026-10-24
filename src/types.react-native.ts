import type * as React from "react";
import type {
    Insets,
    NativeScrollEvent,
    NativeSyntheticEvent,
    ScrollResponderMixin,
    ScrollView,
    ScrollViewComponent,
    ScrollViewProps,
    StyleProp,
    View,
    ViewStyle,
} from "react-native";

import type {
    AnchoredEndSpaceConfig,
    LegendListRef as LegendListRefBase,
    LegendListState as LegendListStateBase,
} from "@/types.base";
import type { LegendListPropsBase } from "@/types.internal";

export type {
    AdaptiveRender,
    AdaptiveRenderChangeReason,
    AdaptiveRenderConfig,
    AlwaysRenderConfig,
    AnchoredEndSpaceConfig,
    ColumnWrapperStyle,
    Insets,
    LayoutRectangle,
    LegendListAverageItemSize,
    LegendListMetrics,
    LegendListRecyclingState,
    LegendListRenderItemProps,
    LegendListScrollResult,
    MaintainScrollAtEndOnOptions,
    MaintainScrollAtEndOptions,
    MaintainVisibleContentPositionConfig,
    NativeScrollEvent,
    NativeSyntheticEvent,
    OnViewableItemsChanged,
    OnViewableItemsChangedInfo,
    ScrollIndexWithOffset,
    ScrollIndexWithOffsetAndContentOffset,
    ScrollIndexWithOffsetPosition,
    StickyHeaderConfig,
    StyleProp,
    ViewAmountToken,
    ViewabilityAmountCallback,
    ViewabilityCallback,
    ViewabilityConfig,
    ViewabilityConfigCallbackPair,
    ViewabilityConfigCallbackPairs,
    ViewStyle,
    ViewToken,
} from "@/types.base";

type LegendListPropsOverrides<ItemT, TItemType extends string | undefined> = Omit<
    LegendListPropsBase<ItemT, ScrollViewProps, TItemType>,
    | "anchoredEndSpace"
    | "contentInsetEndAdjustment"
    | "onScroll"
    | "refScrollView"
    | "renderScrollComponent"
    | "ListHeaderComponentStyle"
    | "ListFooterComponentStyle"
> & {
    anchoredEndSpace?: AnchoredEndSpaceConfig;
    onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    refScrollView?: React.Ref<ScrollView>;
    renderScrollComponent?: (props: ScrollViewProps) => React.ReactElement<ScrollViewProps>;
    ListHeaderComponentStyle?: StyleProp<ViewStyle> | undefined;
    ListFooterComponentStyle?: StyleProp<ViewStyle> | undefined;
};

export type LegendListProps<
    ItemT = any,
    TItemType extends string | undefined = string | undefined,
> = LegendListPropsOverrides<ItemT, TItemType>;

export type LegendListRef = Omit<
    LegendListRefBase,
    "getAnimatableRef" | "getNativeScrollRef" | "getScrollResponder" | "reportContentInset"
> & {
    /**
     * Returns a stable wrapper with different identity from the native instance.
     * JS scrollTo, scrollToEnd, and scrollToOffset release end following. Reanimated UI-thread scrollTo bypasses JS;
     * call cancelScroll() on the JS thread before starting that navigation.
     */
    getAnimatableRef(): React.ElementRef<typeof ScrollViewComponent>;
    /**
     * Returns a stable wrapper with different identity from the native instance.
     * JS scrollTo, scrollToEnd, and scrollToOffset commands release end following
     * and supersede queued or active list scrolling.
     */
    getNativeScrollRef(): React.ElementRef<typeof ScrollViewComponent>;
    /** Returns a stable wrapper; JS scroll and zoom commands release end following and supersede list scrolling. */
    getScrollResponder(): ScrollResponderMixin;
    reportContentInset(inset?: Partial<Insets> | null): void;
};

export type LegendListState = Omit<LegendListStateBase, "elementAtIndex"> & {
    elementAtIndex: (index: number) => View | null | undefined;
};

export type LegendListComponent = <ItemT = any>(
    props: LegendListProps<ItemT> & React.RefAttributes<LegendListRef>,
) => React.ReactElement | null;
