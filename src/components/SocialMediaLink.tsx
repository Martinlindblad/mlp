import Link from 'next/link';
import { FC, useMemo, useCallback } from 'react';
import Image from 'next/image';
import AnimatedItem from './Layouts/AnimatedItem';
import { SocailMediaLink } from 'src/types/DBTypes';

interface Props {
  index: number;
  socialmedia: SocailMediaLink;
}

const SocialMediaLink: FC<Props> = ({ socialmedia: { name, link }, index }) => {
  const itemVariant = useMemo(
    () => ({
      hidden: { opacity: 0, y: -10, x: -2 },
      visible: {
        opacity: 1,
        x: 0,
        y: 0,
        transition: {
          delay: index * 0.3,
          duration: 0.3,
          ease: 'easeInOut',
        },
      },
    }),
    [index],
  );

  const whileHover = useMemo(
    () => ({
      whileHover: {
        scale: 1.05,
        transition: {
          duration: 0.2,
          ease: 'easeInOut',
        },
      },
    }),
    [],
  );

  const getImageSrc = (platform: string) => {
    return {
      Facebook: '/images/facebook.png',
      Github: '/images/github.png',
      Instagram: '/images/instagram.png',
      LinkedIn: '/images/linkedin.png',
    }[platform];
  };

  const renderImage = useCallback(() => {
    const src = getImageSrc(name);
    return src ? (
      <div className="align-center justify-center flex p-1.5 bg-slate-50 rounded-full">
        <Image
          src={src}
          alt={name}
          width={24}
          height={24}
          className="rounded-sm"
        />
      </div>
    ) : null;
  }, [name]);

  return (
    <AnimatedItem
      className="rounded-md realative cursor-pointer p-1"
      itemVariant={itemVariant}
      containerProps={whileHover}
    >
      <div className="bg-gradient-to-tr to-transparent rounded-full flex justify-center items-center">
        <Link href={link}>{renderImage()}</Link>
      </div>
    </AnimatedItem>
  );
};

export default SocialMediaLink;
