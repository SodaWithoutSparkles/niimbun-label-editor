import { useState, useRef, type RefObject } from 'react';

function getDistance(p1: { x: number; y: number }, p2: { x: number; y: number }) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

function getCenter(p1: { x: number; y: number }, p2: { x: number; y: number }) {
    return {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
    };
}

export const useCanvasNavigation = (stageRef: RefObject<any>) => {
    const [stagePos, setStagePos] = useState({ x: 0, y: 0, scale: 1 });
    const lastDistRef = useRef<number>(0);
    const lastCenterRef = useRef<{ x: number; y: number } | null>(null);

    const handleWheel = (e: any) => {
        e.evt.preventDefault();
        const scaleBy = 1.1;
        const stage = stageRef.current;
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();

        if (!pointer) return;

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };

        const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;

        setStagePos({
            scale: newScale,
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        });
    };

    const handleTouchMove = (e: any) => {
        const stage = stageRef.current;
        const touch1 = e.evt.touches[0];
        const touch2 = e.evt.touches[1];

        if (touch1 && touch2) {
            e.evt.preventDefault();
            // Pinch zoom logic
            const p1 = { x: touch1.clientX, y: touch1.clientY };
            const p2 = { x: touch2.clientX, y: touch2.clientY };

            if (!lastCenterRef.current) {
                lastDistRef.current = getDistance(p1, p2);
                lastCenterRef.current = getCenter(p1, p2);
                return;
            }

            const newDist = getDistance(p1, p2);
            const newCenter = getCenter(p1, p2);

            const distScale = newDist / lastDistRef.current;
            const oldScale = stage.scaleX();
            const newScale = oldScale * distScale;

            // Calculate new position
            // We want to zoom into the center point of the pinch
            // The center point in stage coords:
            const centerInStage = {
                x: (lastCenterRef.current.x - stage.x()) / oldScale,
                y: (lastCenterRef.current.y - stage.y()) / oldScale,
            };

            const newPos = {
                x: newCenter.x - centerInStage.x * newScale,
                y: newCenter.y - centerInStage.y * newScale,
                scale: newScale
            };

            setStagePos(newPos);
            stage.position({ x: newPos.x, y: newPos.y });
            stage.scale({ x: newPos.scale, y: newPos.scale });

            lastDistRef.current = newDist;
            lastCenterRef.current = newCenter;
        }
    };

    const handleTouchEnd = () => {
        lastDistRef.current = 0;
        lastCenterRef.current = null;
    };

    return { stagePos, setStagePos, handleWheel, handleTouchMove, handleTouchEnd };
};

