import React from 'react';
import CaseCarousel from 'src/src/components/CaseCarousel';

export default function Cases() {
  return (
    <section className="lg:h-screen  w-full overflow-hidden relative">
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute z-10 w-full h-full object-cover"
      >
        <source src="/assets/man.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video>
      <div className="absolute z-20 inset-0 bg-gradient-to-b from-gray-900 to-gray-400 opacity-60"></div>
      <div className="relative z-30">
        <CaseCarousel />
      </div>
    </section>
  );
}
