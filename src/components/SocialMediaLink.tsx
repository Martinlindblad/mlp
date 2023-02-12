import Link from 'next/link';
import React, { useCallback, useMemo } from 'react';
import { SocailMediaLink } from 'src/../types/DBTypes';
import AnimatedItem from './Layouts/AnimatedItem';

const SocialMediaLink = ({
  socialmedia,
  index,
}: {
  index: number;
  socialmedia: SocailMediaLink;
}): JSX.Element => {
  const itemVariant = useMemo(() => {
    return {
      hidden: {
        opacity: 0,
        y: -40,
        x: -30,
      },
      visible: {
        opacity: 1,
        x: 0,
        y: 0,
        transition: {
          delay: index * 0.4,
          duration: 0.5,
        },
      },
    };
  }, [index]);

  const whileHover = useMemo(() => {
    return {
      whileHover: {
        scale: 1.05,
        duration: 1.5,
      },
    };
  }, []);

  const renderIcon = useCallback(() => {
    switch (socialmedia.name) {
      case 'Facebook':
        return (
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              shape-rendering="geometricPrecision"
              text-rendering="geometricPrecision"
              image-rendering="optimizeQuality"
              fillRule="evenodd"
              clipRule="evenodd"
              viewBox="0 0 640 640"
              fill="#fff"
              className="w-8 bg-sky-600 p-2 rounded-full "
            >
              <path d="M380.001 120.001h99.993V0h-99.993c-77.186 0-139.986 62.8-139.986 139.986v60h-80.009V320h79.985v320h120.013V320h99.994l19.996-120.013h-119.99v-60.001c0-10.843 9.154-19.996 19.996-19.996v.012z"></path>
            </svg>
          </div>
        );
      case 'Github':
        return (
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="#fff"
              className="w-8 rounded-full "
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </div>
        );
      case 'Instagram':
        return <div></div>;
      case 'LinkedIn':
        return <div></div>;
    }
  }, [socialmedia.name]);
  return (
    <AnimatedItem
      className="rounded-md realative cursor-pointer"
      itemVariant={itemVariant}
      containerProps={whileHover}
    >
      <div className="w-10 h-10 bg-gradient-to-tr to-transparent from-sky-900 rounded-full  shadow-sky-900 flex justify-center items-center">
        <Link className="overflow-hidden" href={socialmedia.link}>
          {renderIcon()}
        </Link>
      </div>
    </AnimatedItem>
  );
};
export default SocialMediaLink;
