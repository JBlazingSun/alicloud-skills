import { CSSProperties, ReactNode, UIEvent, useMemo, useState } from 'react';

type VirtualizedListProps<T> = {
  items: T[];
  itemHeight: number;
  overscan?: number;
  className?: string;
  renderItem: (item: T, index: number) => ReactNode;
};

export function VirtualizedList<T>({
  items,
  itemHeight,
  overscan = 6,
  className,
  renderItem,
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + overscan * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);

  const visibleItems = useMemo(() => {
    const rows: Array<{ item: T; index: number }> = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      rows.push({ item: items[index], index });
    }
    return rows;
  }, [endIndex, items, startIndex]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    setScrollTop(target.scrollTop);
    if (target.clientHeight !== viewportHeight) {
      setViewportHeight(target.clientHeight);
    }
  };

  return (
    <div className={className} onScroll={onScroll}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map(({ item, index }) => {
          const style: CSSProperties = {
            position: 'absolute',
            top: index * itemHeight,
            left: 0,
            right: 0,
            height: itemHeight,
          };
          return (
            <div key={index} style={style}>
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
