import React from 'react';
import About from 'src/components/About/About';

export default function Hero() {
  return (
    <div className="realative overflow-hidden ">
      {/* <div className="bg-[url('../../assets/background.png')] bg-cover blur bg-center aspect-4/3 fixed h-full  w-full opacity-30 -z-50" /> */}
      {/* <div className="h-full w-full bg-gradient-to-r dark:from-gray-900 dark:via-black dark:to-gray-900 from-gray-200 via-gray-400 to-gray-200 opacity-100 -z-50 fixed" /> */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className=" bg-cover blur-xl bg-center aspect-4/3 fixed  opacity-30 -z-50"
      >
        <source src="/assets/background2.webm" type="video/webm" />
      </video>

      {/* <AnimatePresence>
        <AnimatedFadeInContainer> */}
      <About />
      {/* </AnimatedFadeInContainer>
      </AnimatePresence> */}
    </div>
  );
}
