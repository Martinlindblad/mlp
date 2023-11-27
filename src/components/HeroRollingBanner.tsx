import React from 'react';
import { Icon } from '@iconify/react';
import Link from 'next/link';
import useWindowDimensions from '../hooks/useWindowDimensions';

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
  const width = useWindowDimensions().width;

  return (
    <Link
      href={'/experience'}
      className="absolute hover:cursor-pointer h-20 left-0 bottom-0 w-full flex justify-center contrast-125 hover:scale-105 transition-transform duration-300 ease-in-out inset-shadow"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-black to-transparent opacity-50"></div>
      <div className="grid h-full w-full place-items-center overflow-hidden relative">
        <div className="slide-track flex absolute left-0 animate-[Slide_114s_linear_infinite]">
          <div className="slide-track flex absolute h-full">
            {[...images, ...images].map((img, index) => (
              <div
                style={{
                  width: `calc(${width / 19}px + 96px)`,
                }}
                className={`h-full flex items-center justify-center`}
                key={img + index}
              >
                <Icon icon={img} className="h-8 w-full mx-10  p-1" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
};

export default HeroRollingBanner;
