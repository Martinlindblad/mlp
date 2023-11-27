import React from 'react';
// import Stepper from 'src/src/components/Stepper';
import CentralContentPageLinks from '../CentralContentPageLinks';

const MainPageShortcuts = () => {
  return (
    <section className="container">
      <div className="w-full flex flex-col align-center justify-center pt-24  lg:py-24">
        {/* <Stepper step={2} stepperTitle={'My Journey'} /> */}

        <div className="gap-16 items-center py-8 mx-auto  max-w-screen-xl lg:grid lg:grid-cols-2 lg:py-16 lg:px-0">
          <div className="font-light text-gray-500 sm:text-lg dark:text-gray-400">
            <h2 className="mb-4 text-4xl tracking-tight font-extrabold text-gray-900 dark:text-white">
              The Architect of User Experiences
            </h2>
            <p className="mb-4">
              In the realm of code, I bring together form and function to craft
              seamless digital experiences. Agile and meticulous, I navigate the
              complexities of development, scaling the heights of innovation to
              transform your vision into reality.
            </p>
            <p>
              Merging creativity with technology, I forge interactive pathways
              that connect and engage. If you&apos;re ready to elevate the
              standard and create something truly unique, let&apos;s build the
              future of digital interaction, one user experience at a time.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-8">
            <img
              className="w-full rounded-lg"
              src="https://flowbite.s3.amazonaws.com/blocks/marketing-ui/content/office-long-2.png"
              alt="office content 1"
            />
            <img
              className="mt-4 w-full lg:mt-10 rounded-lg"
              src="https://flowbite.s3.amazonaws.com/blocks/marketing-ui/content/office-long-1.png"
              alt="office content 2"
            />
          </div>
        </div>
        <CentralContentPageLinks />
      </div>
    </section>
  );
};

export default MainPageShortcuts;
