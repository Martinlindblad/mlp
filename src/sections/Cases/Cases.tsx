import React from 'react';
import CaseCarousel from 'src/src/components/CaseCarousel';
import Stepper from 'src/src/components/Stepper';

export default function Cases() {
  return (
    <section className="bg-white dark:bg-gray-900  w-full  xl:h-screen h-[1000px] md:h-[900px] overflow-hidden">
      <Stepper step={2} stepperTitle="Projects and cases" />
      <CaseCarousel />
    </section>
  );
}
