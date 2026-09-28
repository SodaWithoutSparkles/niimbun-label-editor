import { useState, useEffect, type RefObject } from 'react';

export const useCanvasDimensions = (containerRef: RefObject<HTMLDivElement | null>) => {
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.offsetWidth,
                    height: containerRef.current.offsetHeight
                });
            }
        };

        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, [containerRef]);

    return dimensions;
};
