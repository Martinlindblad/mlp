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
    <main
      data-testid="home-hero"
      className="bg-white text-gray-950 dark:bg-gray-950 dark:text-white"
    >
      <div className="mx-auto w-full max-w-7xl px-6 pb-16 pt-24 sm:px-10 md:pb-20 lg:px-24">
        <Link
          href="/"
          className="text-2xl font-extrabold tracking-wide text-gray-950 dark:text-white md:text-4xl"
        >
          Martin <span className="font-light text-blue-600">Lindblad</span>
        </Link>

        <div className="grid items-center gap-10 pt-10 md:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)] md:gap-12 md:pt-16">
          <div
            data-testid="home-hero-copy"
            className="order-2 min-w-0 md:order-1"
          >
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
              {['React', 'React Native', 'Next.js', 'TypeScript'].map(
                (skill) => (
                  <span
                    key={skill}
                    className="rounded-full border border-gray-300 bg-white/80 px-3 py-1 dark:border-gray-700 dark:bg-gray-900/80"
                  >
                    {skill}
                  </span>
                ),
              )}
            </div>
            <div className="grid gap-3 sm:flex sm:flex-wrap sm:gap-4">
              <Link
                href="/showcases"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                View case studies
              </Link>
              <Link
                href="/experience"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-gray-400 bg-white/70 px-5 py-3 text-sm font-semibold text-gray-950 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-gray-300 dark:border-gray-600 dark:bg-gray-900/70 dark:text-white dark:hover:bg-gray-900"
              >
                See experience
              </Link>
              <Link
                href="/contact"
                className="inline-flex min-h-11 items-center justify-center rounded-md px-5 py-3 text-sm font-semibold text-gray-800 underline-offset-4 transition hover:underline focus:outline-none focus:ring-4 focus:ring-gray-300 dark:text-gray-100"
              >
                Contact Martin
              </Link>
            </div>
            <SocialMediaLinks />
          </div>

          <div
            data-testid="home-portrait"
            className="relative order-1 mx-auto aspect-[4/5] w-full max-w-sm overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 shadow-2xl shadow-gray-950/20 dark:border-gray-800 dark:bg-gray-900 dark:shadow-black/50 md:order-2 md:max-w-md"
          >
            <Image
              alt="Portrait of Martin Lindblad"
              className="object-cover object-[50%_35%]"
              src="/images/profilepicture.webp"
              fill
              priority
              sizes="(max-width: 767px) calc(100vw - 48px), (max-width: 1279px) 42vw, 448px"
            />
          </div>
        </div>
      </div>
    </main>
  );
}
