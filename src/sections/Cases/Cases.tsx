import React from 'react';
import CaseCarousel from 'src/src/components/CaseCarousel';
import Stepper from 'src/src/components/Stepper';

export default function Cases() {
  return (
    <section className="bg-gray-100 dark:bg-gray-900  w-full overflow-hidden">
      <Stepper step={2} stepperTitle="Projects and cases" />
      <CaseCarousel />
    </section>
  );
}
