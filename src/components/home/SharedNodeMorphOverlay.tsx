import React from 'react';
import { motion } from 'motion/react';
import type { NodeScreenSnapshot } from './MarketNetworkGraph';

export interface SharedMorphPayload {
  phase: 'entering' | 'exiting';
  snapshot: NodeScreenSnapshot;
  fromRect: { left: number; top: number; width: number; height: number };
  toRect: { left: number; top: number; width: number; height: number };
  onComplete: () => void;
}

export interface SharedNodeMorphOverlayProps {
  morph: SharedMorphPayload;
  reducedMotion: boolean;
}

export const SharedNodeMorphOverlay: React.FC<SharedNodeMorphOverlayProps> = ({
  morph,
  reducedMotion,
}) => {
  const { phase, snapshot, fromRect, toRect, onComplete } = morph;
  const isEntering = phase === 'entering';

  const duration = reducedMotion ? 0.05 : isEntering ? 0.42 : 0.36;
  const ease = isEntering
    ? ([0.16, 1, 0.3, 1] as const)
    : ([0.22, 1, 0.36, 1] as const);

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-40 pointer-events-none overflow-hidden"
    >
      <motion.div
        initial={{
          left: fromRect.left,
          top: fromRect.top,
          width: fromRect.width,
          height: fromRect.height,
          opacity: isEntering ? 1 : 0.96,
        }}
        animate={{
          left: toRect.left,
          top: toRect.top,
          width: toRect.width,
          height: toRect.height,
          opacity: isEntering ? [1, 1, 0.92] : [0.96, 1, 0.2],
        }}
        transition={{
          duration,
          ease,
          opacity: {
            duration,
            times: isEntering ? [0, 0.72, 1] : [0, 0.78, 1],
          },
        }}
        onAnimationComplete={onComplete}
        style={{
          position: 'fixed',
          borderRadius: '9999px',
          backgroundColor: snapshot.fillColor,
          border: `1.5px solid ${snapshot.strokeColor}`,
          boxShadow: `0 0 24px ${snapshot.polarityColor}26, inset 0 0 18px ${snapshot.polarityColor}12`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          willChange: 'left, top, width, height, opacity',
        }}
      >
        {/* Subtle outer spatial ring */}
        <motion.div
          initial={{ scale: isEntering ? 1 : 1.18, opacity: isEntering ? 0.45 : 0.28 }}
          animate={{ scale: isEntering ? 1.24 : 1, opacity: 0 }}
          transition={{ duration, ease }}
          style={{
            position: 'absolute',
            inset: -8,
            borderRadius: '9999px',
            border: `1px solid ${snapshot.polarityColor}`,
            pointerEvents: 'none',
          }}
        />

        <div className="flex flex-col items-center justify-center text-center px-2 select-none">
          <span
            className="font-bold text-[#F2F5F7] leading-tight"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: isEntering ? 14 : 13,
            }}
          >
            {snapshot.label}
          </span>
          <span
            className="font-mono-tabular text-[#F2F5F7]/85 mt-0.5 leading-tight"
            style={{ fontSize: 11.5 }}
          >
            {snapshot.primaryText}
          </span>
          <span
            className="font-mono-tabular font-semibold mt-0.5 leading-tight"
            style={{ color: snapshot.secondaryColor, fontSize: 10.5 }}
          >
            {snapshot.secondaryText}
          </span>
        </div>
      </motion.div>
    </div>
  );
};
