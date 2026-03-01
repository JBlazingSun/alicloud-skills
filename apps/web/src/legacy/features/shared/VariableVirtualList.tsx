import {
  ForwardedRef,
  Ref,
  ReactNode,
  UIEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

type VariableVirtualListProps<T> = {
  items: T[];
  estimateHeight: (item: T, index: number) => number;
  overscan?: number;
  virtualThreshold?: number;
  className?: string;
  renderItem: (item: T, index: number) => ReactNode;
  followTail?: boolean;
  followThreshold?: number;
  onFollowTailChange?: (following: boolean) => void;
};

export type VariableVirtualListHandle = {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  isNearBottom: () => boolean;
};

function VariableVirtualListInner<T>({
  items,
  estimateHeight,
  overscan = 4,
  virtualThreshold = 120,
  className,
  renderItem,
  followTail = false,
  followThreshold = 80,
  onFollowTailChange,
}: VariableVirtualListProps<T>, ref: ForwardedRef<VariableVirtualListHandle>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [followEnabled, setFollowEnabled] = useState(true);
  const useVirtual = items.length > virtualThreshold;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    setViewportHeight(node.clientHeight);
  }, []);

  const heights = useMemo(
    () => items.map((item, index) => Math.max(48, estimateHeight(item, index))),
    [estimateHeight, items],
  );

  const prefix = useMemo(() => {
    const sums: number[] = new Array(heights.length + 1).fill(0);
    for (let i = 0; i < heights.length; i += 1) {
      sums[i + 1] = sums[i] + heights[i];
    }
    return sums;
  }, [heights]);

  const totalHeight = prefix[prefix.length - 1] ?? 0;

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior = 'auto') => {
        const node = containerRef.current;
        if (!node) return;
        node.scrollTo({ top: Math.max(0, node.scrollHeight - node.clientHeight), behavior });
      },
      isNearBottom: () => {
        const node = containerRef.current;
        if (!node) return true;
        const distance = node.scrollHeight - node.clientHeight - node.scrollTop;
        return distance <= followThreshold;
      },
    }),
    [followThreshold]
  );

  const findIndexByOffset = (offset: number) => {
    let low = 0;
    let high = heights.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (prefix[mid] <= offset) low = mid + 1;
      else high = mid;
    }
    return Math.max(0, low - 1);
  };

  const start = Math.max(0, findIndexByOffset(scrollTop) - overscan);
  const end = Math.min(items.length, findIndexByOffset(scrollTop + viewportHeight) + overscan + 1);

  const topSpacer = prefix[start] ?? 0;
  const bottomSpacer = Math.max(0, totalHeight - (prefix[end] ?? 0));

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (useVirtual) {
      setScrollTop(node.scrollTop);
      if (node.clientHeight !== viewportHeight) {
        setViewportHeight(node.clientHeight);
      }
    }
    if (followTail) {
      const distance = node.scrollHeight - node.clientHeight - node.scrollTop;
      const nextFollowEnabled = distance <= followThreshold;
      if (nextFollowEnabled !== followEnabled) {
        setFollowEnabled(nextFollowEnabled);
        onFollowTailChange?.(nextFollowEnabled);
      }
    }
  };

  useEffect(() => {
    if (!followTail || !followEnabled) return;
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
  }, [followTail, followEnabled, totalHeight, items.length]);

  if (!useVirtual) {
    return (
      <div ref={containerRef} className={className} onScroll={onScroll}>
        {items.map((item, index) => renderItem(item, index))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className} onScroll={onScroll}>
      {topSpacer > 0 && <div style={{ height: topSpacer }} />}
      {items.slice(start, end).map((item, idx) => renderItem(item, start + idx))}
      {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
    </div>
  );
}

export const VariableVirtualList = forwardRef(VariableVirtualListInner) as <T>(
  props: VariableVirtualListProps<T> & { ref?: Ref<VariableVirtualListHandle> }
) => ReactNode;
