// src/Slider.js
import React from 'react';
import { Icon } from '@iconify/react';

const images = [
  'logos:shopify',
  'logos:typescript-icon',
  'logos:slack',
  'logos:next',
  'logos:react-query',
  'logos:react',
  'logos:python',
  'logos:nodejs-icon',
  'logos:nextjs-icon',
  'logos:mongodb',
  'logos:microsoft-azure',
  'logos:javascript',
  'logos:jquery',
  'logos:ios',
  'logos:html-5',
  'logos:github-icon',
  'logos:git',
  'logos:contentful',
  'logos:android-vertical',
  'logos:angular-icon',
];

const Slider = () => {
  return (
    <div className="grid h-full w-full place-items-center overflow-hidden">
      <div className="slide-track flex animate-[Slide_60s_linear_infinite]">
        {images.map((img) => (
          <div
            className="w-36 px-4 h-full flex items-center justify-center"
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
