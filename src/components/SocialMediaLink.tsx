import Link from 'next/link';
import { FC, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { SocailMediaLink } from 'src/types/DBTypes';
import AnimatedStaggerItem from './Layouts/AnimatedItem';
import { useTheme } from 'next-themes';

interface Props {
  index: number;
  socialmedia: SocailMediaLink;
}

const SocialMediaLink: FC<Props> = ({ socialmedia: { name, link }, index }) => {
  const itemVariant = useMemo(
    () => ({
      hidden: {
        opacity: 0,
        scale: 0.75,
      },
      visible: {
        opacity: 1,
        scale: 1,
        transition: {
          delay: index * 0.4,
          duration: 0.4,
          ease: 'easeInOut',
        },
      },
      exit: {
        scale: 0.75,
        opacity: 0,
      },
    }),
    [index],
  );

  const getImageSrc = (platform: string) => {
    return {
      Facebook: '/images/facebook.png',
      Github: '/images/github.png',
      Instagram: '/images/instagram.png',
      LinkedIn: '/images/linkedin.png',
    }[platform];
  };

  const { theme } = useTheme();

  const renderImage = useCallback(() => {
    const src = getImageSrc(name);
    return src ? (
      <div className="align-center justify-center flex p-1 border border-sky-500 rounded-full">
        <Image
          src={src}
          alt={name}
          width={18}
          height={18}
          className="rounded-sm"
        />
      </div>
    ) : null;
  }, [name]);

  return (
    <AnimatedStaggerItem
      className="rounded-md relative cursor-pointer p-1 mr-1"
      itemVariant={itemVariant}
      whileHover={{
        transition: { duration: 0.3 },
        boxShadow:
          theme === 'dark'
            ? '0 0 0 1px rgba(255, 255, 255, 0.7)'
            : '0 0 0 1px rgba(0, 0, 0, 0.7)',
        borderRadius: '100%',
      }}
    >
      <div className="bg-gradient-to-tr to-transparent rounded-full flex justify-center items-center">
        <Link href={link}>{renderImage()}</Link>
      </div>
    </AnimatedStaggerItem>
  );
};

export default SocialMediaLink;
