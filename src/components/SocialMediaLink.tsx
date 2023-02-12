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
        );
      case 'Github':
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="#fff"
            className="w-8 rounded-full "
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
        );
      case 'Instagram':
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 333333 333333"
            shape-rendering="geometricPrecision"
            text-rendering="geometricPrecision"
            image-rendering="optimizeQuality"
            fillRule="evenodd"
            clipRule="evenodd"
            className="w-8 bg-sky-200 rounded-full "
          >
            <defs>
              <linearGradient
                id="a"
                gradientUnits="userSpaceOnUse"
                x1="250181"
                y1="308196"
                x2="83152.4"
                y2="25137"
              >
                <stop offset="0" stop-color="#f58529"></stop>
                <stop offset=".169" stop-color="#feda77"></stop>
                <stop offset=".478" stop-color="#dd2a7b"></stop>
                <stop offset=".78" stop-color="#8134af"></stop>
                <stop offset="1" stop-color="#515bd4"></stop>
              </linearGradient>
            </defs>
            <path
              d="M166667 0c92048 0 166667 74619 166667 166667s-74619 166667-166667 166667S0 258715 0 166667 74619 0 166667 0zm-40642 71361h81288c30526 0 55489 24654 55489 54772v81069c0 30125-24963 54771-55488 54771l-81289-1c-30526 0-55492-24646-55492-54771v-81069c0-30117 24966-54771 55492-54771zm40125 43843c29663 0 53734 24072 53734 53735 0 29667-24071 53735-53734 53735-29672 0-53739-24068-53739-53735 0-29663 24068-53735 53739-53735zm0 18150c19643 0 35586 15939 35586 35585 0 19647-15943 35589-35586 35589-19650 0-35590-15943-35590-35589s15940-35585 35590-35585zm51986-25598c4819 0 8726 3907 8726 8721 0 4819-3907 8726-8726 8726-4815 0-8721-3907-8721-8726 0-4815 3907-8721 8721-8721zm-85468-20825h68009c25537 0 46422 20782 46422 46178v68350c0 25395-20885 46174-46422 46174l-68009 1c-25537 0-46426-20778-46426-46174v-68352c0-25395 20889-46177 46426-46177z"
              fill="url(#a)"
            ></path>
          </svg>
        );
      case 'LinkedIn':
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 333333 333333"
            shape-rendering="geometricPrecision"
            text-rendering="geometricPrecision"
            image-rendering="optimizeQuality"
            fillRule="evenodd"
            className="w-8   rounded-full "
            clipRule="evenodd"
          >
            <path
              d="M166667 0c46023 0 87690 18655 117851 48816s48816 71828 48816 117851-18655 87690-48816 117851-71828 48816-117851 48816-87690-18655-117851-48816S0 212690 0 166667 18655 78977 48816 48816 120644 0 166667 0zm-18386 141742h26667v13671l386 1c3714-6663 12794-13671 26335-13671 28159-1 33367 17523 33367 40319v46437l-27811 1v-41165c0-9813-204-22446-14460-22446-14481 0-16699 10682-16699 21731v41880h-27786v-86757zm-19280-24100c0 7983-6478 14461-14461 14461-7982 0-14463-6478-14463-14461s6480-14460 14463-14460 14461 6478 14461 14460zm-28924 24100h28924v86757h-28924v-86757zm173218-81703c-27287-27287-64987-44165-106628-44165-41642 0-79341 16878-106628 44165s-44165 64987-44165 106628c0 41642 16878 79341 44165 106628s64987 44165 106628 44165c41642 0 79341-16878 106628-44165s44165-64987 44165-106628c0-41642-16878-79341-44165-106628z"
              fill="#0077b5"
              fillRule="nonzero"
            ></path>
          </svg>
        );

      default:
        break;
    }
  }, [socialmedia.name]);
  return (
    <AnimatedItem
      className="rounded-md cursor-pointer"
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
