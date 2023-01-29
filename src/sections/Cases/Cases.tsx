import React from 'react';
import CaseCarousel from 'src/components/CaseCarousel';
import Stepper from 'src/components/Stepper';

export default function Cases() {
  return (
    <section className="bg-white dark:bg-gray-900 h-screen w-full pt-10 ">
      <Stepper step={2} stepperTitle="Projects and cases" />
      <CaseCarousel />
    </section>
  );
}
