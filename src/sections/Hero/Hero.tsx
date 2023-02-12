import { AnimatePresence } from 'framer-motion';
import React from 'react';
import About from 'src/components/About/About';
import { Canvas } from '@react-three/fiber';

export default function Hero() {
  return (
    <div className="realative overflow-hidden ">
      {/* <div className="bg-[url('../../assets/background.png')] bg-cover blur bg-center aspect-4/3 fixed h-full  w-full opacity-30 -z-50" /> */}
      {/* <div className="h-full w-full bg-gradient-to-r dark:from-gray-900 dark:via-black dark:to-gray-900 from-gray-200 via-gray-400 to-gray-200 opacity-100 -z-50 fixed" /> */}
      {/* <video
        autoPlay
        loop
        muted
        playsInline
        className=" bg-cover blur-xl bg-center aspect-4/3 fixed  opacity-10 -z-50"
      >
        <source src="/assets/background3.webm" type="video/webm" />
      </video> */}
      {/* <div className="fixed h-full w-full">
        <Canvas className="">
          <pointLight position={[40, 40, 40]} />
          <mesh>
            <sphereGeometry />
            <meshStandardMaterial color="hotpink" />
            <meshStandardMaterial color="hotpink" />
            <meshStandardMaterial color="hotpink" />
          </mesh>
        </Canvas>
      </div> */}

      <About />
    </div>
  );
}
