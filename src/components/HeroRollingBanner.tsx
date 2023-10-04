import React from 'react';
import { Icon } from '@iconify/react';

const images = [
  'logos:javascript',
  'logos:react',
  'logos:typescript-icon',
  'logos:nextjs-icon',
  'logos:android-vertical',
  'logos:ios',
  'logos:nodejs-icon',
  'logos:mongodb',
  'logos:contentful',
  'logos:git',
  'logos:react-query',
  'logos:microsoft-azure',
  'logos:jquery',
  'logos:github-icon',
  'logos:html-5',
  'logos:slack',
  'logos:shopify',
  'logos:python',
  'logos:angular-icon',
];

const HeroRollingBanner = () => {
  return (
    <div className="grid h-full w-full place-items-center overflow-hidden relative">
      <div className="slide-track flex absolute animate-[Slide_57s_linear_infinite]">
        {[...images, ...images].map((img, index) => (
          <div
            className="w-36 mx-12 h-full flex items-center justify-center"
            key={img + index}
          >
            <Icon icon={img} className="h-28 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
};

export default HeroRollingBanner;
