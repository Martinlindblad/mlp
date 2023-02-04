import React from 'react';
import About from 'src/components/About/About';

export default function Hero() {
  return (
    <div className="realative overflow-hidden">
      <div className="bg-[url('../../assets/background.png')] bg-cover bg-center aspect-4/3 fixed h-full  w-full opacity-30 -z-50" />
      <About />
    </div>
  );
}
