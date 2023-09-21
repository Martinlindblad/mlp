import React from 'react';
import AnimatedFadeInContainer from 'src/src/components/Layouts/AnimatedFadeInContainer';
import Stepper from 'src/src/components/Stepper';
import Skills from '../Skills';

const MainPageShortcuts = () => {
  return (
    <section className="container">
      <div className="w-full flex align-center justify-center flex-col pt-24 lg:pt-0 ">
        <Stepper step={1} stepperTitle={'My Journey'} />
        <AnimatedFadeInContainer className="px-4 ">
          <Skills />
        </AnimatedFadeInContainer>
      </div>
    </section>
  );
};
export default MainPageShortcuts;
