import React from 'react';
import About from 'src/src/pages/about';

export default function Hero() {
  return (
    <div className="realative overflow-hidden ">
      {/* <video
        autoPlay
        loop
        muted
        playsInline
        className=" bg-cover blur-xl bg-center aspect-4/3 fixed  opacity-10 -z-50"
      >
        <source src="/assets/background3.webm" type="video/webm" />
      </video> */}
      <About />
    </div>
  );
}
