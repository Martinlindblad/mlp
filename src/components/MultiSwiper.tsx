// src/Slider.js
import React from 'react';
import { Icon } from '@iconify/react';

const images = [
  'logos:javascript',
  'logos:react',
  'logos:nextjs-icon',
  'logos:android-vertical',
  'logos:ios',
  'logos:typescript-icon',
  'logos:react-query',
  'logos:git',
  'logos:html-5',
  'logos:jquery',
  'logos:nodejs-icon',
  'logos:mongodb',
  'logos:contentful',
  'logos:github-icon',
  'logos:slack',
  'logos:microsoft-azure',
  'logos:python',
  'logos:shopify',
  'logos:angular-icon',
];

const Slider = () => {
  return (
    <div className="grid h-full w-full place-items-center overflow-hidden ">
      <div className="slide-track flex animate-[Slide_57s_linear_infinite] w-full h-full">
        {images.map((img) => (
          <div
            className="w-36 px-8 h-full flex items-center justify-center"
            key={img}
          >
            <Icon icon={img} className="h-full w-full " />
          </div>
        ))}
        {images.map((img) => (
          <div
            className="w-36 px-8 h-full flex items-center justify-center"
            key={img}
          >
            <Icon icon={img} className="h-full w-full " />
          </div>
        ))}
      </div>
    </div>
  );
};

export default Slider;
