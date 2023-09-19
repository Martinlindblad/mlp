import Link from 'next/link';
import React, { useCallback, useMemo } from 'react';
import AnimatedItem from './Layouts/AnimatedItem';
import { SocailMediaLink } from 'src/types/DBTypes';

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
        y: -10,
        x: -2,
      },
      visible: {
        opacity: 1,
        x: 0,
        y: 0,
        transition: {
          delay: index * 0.4,
          duration: 0.3,
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

  const renderImage = useCallback(() => {
    switch (socialmedia.name) {
      case 'Facebook':
        return (
          <div className="align-center justify-center flex p-1.5 bg-slate-50 rounded-full">
            <img
              src="/images/facebook.png"
              alt="Facebook"
              className="w-6 rounded-sm"
            />
          </div>
        );
      case 'Github':
        return (
          <div className="align-center justify-center flex p-1.5 bg-slate-50 rounded-full">
            <img
              src="/images/github.png"
              alt="Github"
              className="w-6 rounded-sm"
            />
          </div>
        );
      case 'Instagram':
        return (
          <div className="align-center justify-center flex p-1.5 bg-slate-50 rounded-full">
            <img
              src="/images/instagram.png"
              alt="Instagram"
              className="w-6 rounded-sm"
            />
          </div>
        );
      case 'LinkedIn':
        return (
          <div className="align-center justify-center flex p-1.5 bg-slate-50 rounded-full">
            <img
              src="/images/linkedin.png"
              alt="LinkedIn"
              className="w-6 rounded-sm"
            />
          </div>
        );
      default:
        return null;
    }
  }, [socialmedia.name]);

  return (
    <AnimatedItem
      className="rounded-md realative cursor-pointer p-1"
      itemVariant={itemVariant}
      containerProps={whileHover}
    >
      <div className=" bg-gradient-to-tr to-transparent rounded-full flex justify-center items-center">
        <Link href={socialmedia.link}>{renderImage()}</Link>
      </div>
    </AnimatedItem>
  );
};

export default SocialMediaLink;
