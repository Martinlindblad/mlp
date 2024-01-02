import React, { useRef } from 'react';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';
import Link from 'next/link';
import WorkShowcase from '../components/WorkShowcase';
import { motion, useInView } from 'framer-motion';
import AnimatedName from '../components/AnimatedComponents/AnimatedName';
import useAboutQuery from '../hooks/useAboutQuery';
import { Languages, ProfessionalProfileintroduction } from 'src/types/DBTypes';
import useLanguagesQuery from '../hooks/useLanguagesQuery';

const StarRating = ({ rating }: { rating: number }) => {
  const fullStars = Math.floor(rating);
  const emptyStars = 5 - fullStars;

  return (
    <div className="flex">
      {Array(fullStars)
        .fill(undefined)
        .map((_, i) => (
          <svg
            key={`full-${i}`}
            className="w-4 h-4 text-yellow-300 ms-1"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 22 20"
          >
            <path d="M20.924 7.625a1.523 1.523 0 0 0-1.238-1.044l-5.051-.734-2.259-4.577a1.534 1.534 0 0 0-2.752 0L7.365 5.847l-5.051.734A1.535 1.535 0 0 0 1.463 9.2l3.656 3.563-.863 5.031a1.532 1.532 0 0 0 2.226 1.616L11 17.033l4.518 2.375a1.534 1.534 0 0 0 2.226-1.617l-.863-5.03L20.537 9.2a1.523 1.523 0 0 0 .387-1.575Z" />
          </svg>
        ))}
      {Array(emptyStars)
        .fill(undefined)
        .map((_, i) => (
          <svg
            key={`empty-${i}`}
            className="w-4 h-4 ms-1 text-gray-300 dark:text-gray-500"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 22 20"
          >
            <path d="M20.924 7.625a1.523 1.523 0 0 0-1.238-1.044l-5.051-.734-2.259-4.577a1.534 1.534 0 0 0-2.752 0L7.365 5.847l-5.051.734A1.535 1.535 0 0 0 1.463 9.2l3.656 3.563-.863 5.031a1.532 1.532 0 0 0 2.226 1.616L11 17.033l4.518 2.375a1.534 1.534 0 0 0 2.226-1.617l-.863-5.03L20.537 9.2a1.523 1.523 0 0 0 .387-1.575Z" />
          </svg>
        ))}
    </div>
  );
};

const LanguageRating = ({
  language,
  spoken,
  written,
}: {
  language: string;
  spoken: number;
  written: number;
}) => (
  <div className="flex flex-col shadow-black dark:shadow-white shadow-sm rounded-lg p-4 m-2">
    <div className="font-semibold text-lg text-gray-700 dark:text-gray-400">
      {language}
    </div>
    <div className="flex items-center mt-2">
      <div className="text-sm font-medium text-gray-600 dark:text-gray-300">
        Spoken:
      </div>
      <StarRating rating={spoken} />
    </div>
    <div className="flex items-center mt-1">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Written:
      </div>
      <StarRating rating={written} />
    </div>
  </div>
);

const LanguagesList = ({ languages }: { languages: Languages }) => (
  <div className="container flex-col lg:flex-row flex justify-center">
    {languages.map((lang) => (
      <LanguageRating
        key={lang._id.toString()}
        language={lang.name}
        spoken={parseInt(lang.spoken, 10)}
        written={parseInt(lang.written, 10)}
      />
    ))}
  </div>
);

const LanguageSection = (): JSX.Element => {
  const { data: languagesData, isLoading } = useLanguagesQuery();

  const data = languagesData?.filter((lang) => lang);

  if (!data) return <></>;

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <AnimatedFadeInContainer type="FadeInBottom" className="lg:pb-20 container">
      <div className="justify-center flex">
        <h2 className="text-3xl md:text-2xl lg:text-3xl py-10">Languages</h2>
      </div>
      <LanguagesList languages={data} />
    </AnimatedFadeInContainer>
  );
};

const AboutPage = (): JSX.Element => {
  const ref = useRef<HTMLDivElement | null>(null);
  const isInView = useInView(ref);
  const { data: personalInfo } = useAboutQuery('introduction');

  return (
    <Layout className="w-full flex flex-col justify-center align-center">
      <div className="pt-20 sm:pt-10 pb-6 sm:pb-10 justify-center align-center flex">
        <AnimatedName
          personalInfo={
            personalInfo as unknown as ProfessionalProfileintroduction
          }
        />
      </div>
      <section className="text-gray-400 mb-10  dark:text-gray-100 body-font ">
        <div className="px-5 mx-auto flex flex-col justify-center align-center h-full">
          <AnimatedFadeInContainer type="FadeInBottom ">
            <div className="lg:w-4/6 mx-auto">
              <div className="rounded-lg h-64 overflow-hidden">
                <img
                  alt="content"
                  className="object-cover object-center h-full w-full shadow-lg"
                  src="/images/meeting.webp"
                />
              </div>
              <div className="flex flex-col sm:flex-row mt-10">
                <div className="sm:w-1/3 text-center sm:pr-8 sm:py-8">
                  <div className="w-28 h-28 rounded-full inline-flex items-center justify-center relative overflow-hidden">
                    <img
                      alt="content"
                      className="object-cover object-left h-full w-full opacity-85"
                      src="/images/profilbild2.webp"
                    />
                  </div>
                  <div className="flex flex-col items-center text-center justify-center">
                    <h2 className="font-medium title-font mt-4 text-gray-900 dark:text-gray-200 text-lg">
                      Martin Lindblad
                    </h2>
                    <div className="w-12 h-1 bg-blue-500 dark:bg-blue-500 rounded mt-2 mb-4"></div>
                    <p className="text-base text-gray-600 dark:text-gray-300 ">
                      I am a Front-end developer based in Stockholm, Sweden.
                    </p>
                  </div>
                </div>
                <div className="sm:w-2/3 sm:pl-8 sm:py-8 sm:border-l border-gray-800 sm:border-t-0 border-t mt-4 pt-4 sm:mt-0 text-center sm:text-left">
                  <p className="text-gray-700 dark:text-gray-200 leading-relaxed text-lg mb-4">
                    Hello there! I am Martin, a Front-end developer with 3 years
                    of working experience in the industry. I am currently
                    working at{' '}
                    <Link
                      href={'https://pija.se/'}
                      className="text-blue-400 dark:text-blue-300 inline-flex items-center cursor-pointer hover:underline"
                      about="PiJa Media & Management AB"
                    >
                      PiJa Media & Management AB
                    </Link>
                    <br />
                    <br />
                    Additionally, I provide SEO, maintenance, and project
                    management services for Wordpress and Shopify sites through
                    Neeko AB. <br />
                    <br /> I am passionate about developing products and
                    improving myself because there is always another step ahead,
                    a new goal to pursue, or a challenge to overcome. <br />
                    <br />I firmly believe in the power of continuous learning
                    and remain an ever-curious student of life and the vast
                    digital world that surrounds us.
                  </p>
                </div>
              </div>
            </div>
          </AnimatedFadeInContainer>
        </div>
      </section>
      <LanguageSection />

      <motion.div
        className="relative flex justify-center align-center"
        whileHover={{ cursor: 'pointer' }}
      >
        <motion.div
          className="absolute bottom-0 left-1/2 bg-white h-0.5"
          style={{ transform: 'translateX(-50%)' }}
          animate={{ width: isInView ? 'calc(100vw - 50%)' : '0%' }}
          transition={{ duration: 0.3 }}
        />
      </motion.div>

      <motion.div
        key="workShowCase"
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <WorkShowcase />
      </motion.div>
    </Layout>
  );
};

export default AboutPage;
