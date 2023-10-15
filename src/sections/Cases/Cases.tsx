import React from 'react';
import CaseCarousel from 'src/src/components/CaseCarousel';
// import Stepper from 'src/src/components/Stepper';

export default function Cases() {
  return (
    <section className="bg-gray-100 dark:bg-slate-500 lg:h-screen w-full overflow-hidden relative ">
      {/* <Stepper step={1} stepperTitle="Projects and cases" /> */}
      <CaseCarousel />
    </section>
  );
}
