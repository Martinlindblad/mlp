import { motion } from 'framer-motion';
import Link from 'next/link';
import AnimatedContainer from '../Layouts/AnimatedContainer';
import Logo from '../SVG/Logo';
import { useTheme } from 'next-themes';
import { AboutType } from 'src/types/DBTypes';
import { useMemo } from 'react';

type AnimatedNameProp = {
  aboutData: void | AboutType | undefined;
};

const AnimatedName = ({ aboutData }: AnimatedNameProp) => {
  const CharacterString = useMemo(() => {
    if (aboutData) {
      const nameString = aboutData?.name + ' ' + aboutData?.surname;
      const stringArr = Array.from(nameString);
      return stringArr;
    }
    return [];
  }, [aboutData]);

  const container = useMemo(
    () => ({
      hidden: {
        opacity: 0,
        scale: 0,
      },
      visible: {
        opacity: 1,
        scale: 1,
        visible: {
          opacity: 1,
          transition: {
            delay: 0.4,
            duration: 0.5,
          },
        },
      },
    }),
    [],
  );
  const { theme } = useTheme();
  return (
    <Link href="/" className="flex items-center mb-4 sm:mb-0">
      <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-4xl xl:text-4xl  font-bold tracking-wider dark:text-gray-100">
        <AnimatedContainer
          key={'IntroductionNameContainer'}
          containerVariant={container}
          className="flex-row flex w-full flex-wrap "
        >
          <Logo containerStyle="w-10 mr-4" />
          {CharacterString.map((character, index) => (
            <motion.span
              className={` ${
                theme === 'dark'
                  ? 'animate-[darkColors_3s_ease-in-out]'
                  : 'animate-[lightColors_3s_ease-in-out]'
              } ${index > 6 ? ' text-blue-500 font-thin' : ' font-extrabold'} `}
              variants={{
                hidden: {
                  opacity: 0,
                },
                visible: {
                  opacity: 1,
                  transition: {
                    delay: index * 0.1,
                    duration: 0.7,
                  },
                },
              }}
              key={`IntroductionName${index}_${character}`}
            >
              {character === ' ' ? '\u00A0' : character}
            </motion.span>
          ))}
        </AnimatedContainer>
      </h1>
    </Link>
  );
};

export default AnimatedName;
