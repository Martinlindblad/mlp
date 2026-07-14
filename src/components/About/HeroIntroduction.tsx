import SocialMediaLinks from '../SocialMediaLinks';

import Link from 'next/link';
import Image from 'next/image';
import useAboutQuery from '../../hooks/useAboutQuery';
import { ProfessionalProfileintroduction } from 'src/types/DBTypes';

const fallbackIntroduction = {
  name: 'Martin',
  surname: 'Lindblad',
  title: 'Front-end Developer',
  info: 'Stockholm-based front-end developer building accessible, reliable product experiences with React, React Native, Next.js, TypeScript, and modern API integrations.',
  key: 'introduction',
} as ProfessionalProfileintroduction;

export default function Hero() {
  const { data: personalInfo } = useAboutQuery('introduction');
  const personalInfoData =
    (personalInfo as unknown as ProfessionalProfileintroduction | undefined) ??
    fallbackIntroduction;

  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-gray-950 dark:bg-gray-950 dark:text-white">
      <Image
        alt="Portrait of Martin Lindblad"
        className="absolute bottom-0 right-0 z-0 h-full object-contain object-bottom opacity-20 sm:opacity-35 lg:opacity-75"
        src="/images/profilepicture.webp"
        fill
        priority
        sizes="(min-width: 1024px) 55vw, 100vw"
      />
      <div className="absolute inset-0 z-0 bg-gradient-to-r from-white via-white/95 via-55% to-white/20 dark:from-gray-950 dark:via-gray-950/95 dark:via-55% dark:to-gray-950/20" />

      <div className="absolute left-6 top-24 z-10 sm:left-10 lg:left-24">
        <Link
          href="/"
          className="text-2xl font-extrabold tracking-wide text-gray-950 dark:text-white md:text-4xl"
        >
          Martin <span className="font-light text-blue-600">Lindblad</span>
        </Link>
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl items-center px-6 pb-16 pt-36 sm:px-10 lg:px-24">
        <div className="min-w-0 w-full max-w-xs sm:max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
            Front-end Developer in Stockholm
          </p>
          <h1 className="max-w-3xl break-words text-3xl font-extrabold leading-tight text-gray-950 dark:text-white sm:text-5xl lg:text-6xl">
            React and mobile interfaces built for real users.
          </h1>
          <p className="max-w-2xl break-words py-6 text-base leading-7 text-gray-700 dark:text-gray-200 md:text-lg">
            {personalInfoData?.info || fallbackIntroduction.info}
          </p>
          <div className="flex max-w-full flex-wrap gap-2 pb-6 text-sm font-medium text-gray-800 dark:text-gray-100">
            {['React', 'React Native', 'Next.js', 'TypeScript'].map((skill) => (
              <span
                key={skill}
                className="rounded-full border border-gray-300 bg-white/80 px-3 py-1 dark:border-gray-700 dark:bg-gray-900/80"
              >
                {skill}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/showcases"
              className="inline-flex items-center rounded-md bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              View case studies
            </Link>
            <Link
              href="/experience"
              className="inline-flex items-center rounded-md border border-gray-400 bg-white/70 px-5 py-3 text-sm font-semibold text-gray-950 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-gray-300 dark:border-gray-600 dark:bg-gray-900/70 dark:text-white dark:hover:bg-gray-900"
            >
              See experience
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center rounded-md px-5 py-3 text-sm font-semibold text-gray-800 underline-offset-4 transition hover:underline focus:outline-none focus:ring-4 focus:ring-gray-300 dark:text-gray-100"
            >
              Contact Martin
            </Link>
          </div>
          <SocialMediaLinks />
        </div>
      </div>
    </main>
  );
}
