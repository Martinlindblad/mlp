import React from 'react';
import CaseCarousel from 'src/src/components/CaseCarousel';
import Stepper from 'src/src/components/Stepper';

export default function Cases() {
  return (
    <section className="bg-gray-100 dark:bg-gray-900 lg:h-screen w-full overflow-hidden relative mb-24">
      <Stepper step={1} stepperTitle="Projects and cases" />
      <CaseCarousel />
    </section>
  );
}
