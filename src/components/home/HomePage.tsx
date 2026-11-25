import React, { useRef } from 'react';

export interface HomePageProps {
  /** Reserved extension slot for future real-time market streaming visualizers (Canvas/SVG/WebGL/Three.js) */
  renderStageLayer?: (containerRef: React.RefObject<HTMLDivElement | null>) => React.ReactNode;
}

/**
 * Main Overview (Home)
 * Clean, full-viewport responsive stage reserved for future real-time asset market motion graphics.
 * Intentionally renders an uncluttered empty surface at this stage.
 */
export const HomePage: React.FC<HomePageProps> = ({ renderStageLayer }) => {
  const stageRef = useRef<HTMLDivElement | null>(null);

  return (
    <section
      id="home-overview-stage"
      ref={stageRef}
      aria-label="Home Overview"
      className="relative flex-1 w-full min-h-screen overflow-hidden bg-[#090D16]"
    >
      {renderStageLayer ? renderStageLayer(stageRef) : null}
    </section>
  );
};
