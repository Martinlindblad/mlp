/* eslint-disable jsx-a11y/anchor-is-valid */
import AnimatedName from '../components/AnimatedComponents/AnimatedName';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';
import React from 'react';
import useAboutQuery from '../hooks/useAboutQuery';
import { ProfessionalProfileintroduction } from 'src/types/DBTypes';
import { Icon } from '@iconify/react';
import Image from 'next/image';
import Link from 'next/link';

const ExperienceSectionData = [
  {
    id: 'mobile',
    title: 'Mobile Developer',
    description:
      'Over the past 2 years, I have worked as a Mobile Application Developer specializing in using React Native and TypeScript to create responsive and robust mobile applications. My focus has been on developing cross-platform applications for Android and iOS through React Native. I consistently work with database connections and APIs, making React Query one of my most utilized libraries. With it, I manage server state and optimize data fetching, delivering a smooth, user-centric mobile experience.',
    imagePath: '/images/applications.webp',
  },
  {
    id: 'web',
    title: 'Web Developer',
    description:
      'With extensive experience as a Web Developer, I specialize in creating dynamic, SEO-friendly web applications using React, Next.js, and TypeScript. My proficiency with HTML5 and modern libraries like jQuery and React Query allows for efficient, reactive UIs and state management. I ensure high performance and accessibility, delivering scalable single-page applications with a keen focus on responsive design and user experience.',
    imagePath: '/images/laptop2.webp',
  },
  {
    id: 'other',
    title: 'More of Frontend Development',
    description:
      'As a Frontend Developer, my expertise extends beyond typical client-side development. While primarily focused on the frontend, I proficiently use Node.js to set up development environments and build tools, enhancing my workflow and frontend capabilities. I also have experience with Python, Java, and C# for running scripts that aid in frontend tasks. My proficiency with Git and GitHub is key for version control and collaborative work, ensuring a smooth development process. With a foundational understanding of Microsoft Azure and MongoDB, I support frontend interactions with cloud services and databases.',
    imagePath: '/images/developer.webp',
  },
];

const mobileImages = [
  { icon: 'logos:react', text: 'React Native for cross-platform mobile apps' },
  {
    icon: 'logos:typescript-icon',
    text: 'TypeScript for robust code structuring',
  },
  {
    icon: 'logos:android-vertical',
    text: 'Android Dev for native Android apps',
  },
  { icon: 'logos:ios', text: 'iOS Development for native iOS interfaces' },
  { icon: 'logos:react-query', text: 'React Query for managing server state' },
];

const webImages = [
  {
    icon: 'logos:javascript',
    text: 'JavaScript for dynamic web functionality',
  },
  { icon: 'logos:react', text: 'React for efficient, reactive UIs' },
  { icon: 'logos:typescript-icon', text: 'TypeScript for type-safe web apps' },
  { icon: 'logos:nextjs-icon', text: 'Next.js for SEO-friendly React apps' },
  { icon: 'logos:shopify', text: 'Shopify for custom e-commerce sites' },
  { icon: 'logos:jquery', text: 'jQuery for simplified DOM manipulation' },
  {
    icon: 'logos:react-query',
    text: 'React Query for syncing server/client state',
  },
  { icon: 'logos:html-5', text: 'HTML5 for structuring responsive content' },
  {
    icon: 'logos:contentful',
    text: 'Contentful for streamlined content delivery',
  },
  {
    icon: 'logos:angular-icon',
    text: 'Angular for scalable single-page applications',
  },
];

const otherImages = [
  { icon: 'logos:slack', text: 'Slack for streamlined team collaboration' },
  { icon: 'logos:git', text: 'Git for source code versioning' },
  {
    icon: 'logos:python',
    text: 'Python for scripting and backend integration',
  },
  {
    icon: 'logos:nodejs-icon',
    text: 'Node.js for full-stack JavaScript development',
  },
  { icon: 'logos:github-icon', text: 'GitHub for collaborative coding' },
  {
    icon: 'logos:microsoft-azure',
    text: 'Microsoft Azure for cloud-based services',
  },
  { icon: 'logos:mongodb', text: 'MongoDB for flexible NoSQL data storage' },
  {
    icon: 'logos:angular-icon',
    text: 'Angular for robust frontend architectures',
  },
];

const ExperienceSectionIconByType = ({ id }: { id: string }): JSX.Element => {
  const iconsAndTexts = {
    mobile: mobileImages,
    web: webImages,
    other: otherImages,
  }[id] as { icon: string; text: string }[];

  return (
    <div className="pt-2 flex flex-row flex-wrap ">
      {iconsAndTexts.map((item) => (
        <div key={item.icon} className="flex flex-row w-1/2 items-center my-2">
          <Icon icon={item.icon} className="h-14 w-14 p-2" />
          <p className="text-xs text-gray-400 ml-2">{item.text}</p>
        </div>
      ))}
    </div>
  );
};

const ExperienceHero = (): JSX.Element => {
  return (
    <section className="bg-white dark:bg-gray-900">
      <AnimatedFadeInContainer type="FadeInBottom">
        <div className="py-8 px-4 mx-auto max-w-screen-xl text-center lg:py-16 lg:px-12">
          <Link
            href="/showcases"
            className="inline-flex justify-between items-center py-1 px-1 pr-4 mb-7 text-sm text-gray-700 bg-gray-100 rounded-full dark:bg-gray-800 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700"
            role="alert"
          >
            <span className="text-xs bg-primary-600 rounded-full text-white px-4 py-1.5 mr-3">
              Cases
            </span>{' '}
            <span className="text-sm font-medium">See my projects</span>
            <svg
              className="ml-2 w-5 h-5"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fill-rule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clip-rule="evenodd"
              ></path>
            </svg>
          </Link>
          <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-gray-900 md:text-5xl lg:text-6xl dark:text-white">
            In-Depth with my Experience and skillset
          </h1>
          <p className="mb-8 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 xl:px-48 dark:text-gray-400">
            The technologies I have most experience in are React, React Native,
            Next.js, TypeScript, and Node.js. I am always learning new
            technologies and expanding my skillset.
          </p>
          <div className="flex flex-col mb-8 lg:mb-16 space-y-4 sm:flex-row sm:justify-center sm:space-y-0 sm:space-x-4"></div>
          <div className="px-4 mx-auto text-center md:max-w-screen-md lg:max-w-screen-lg lg:px-36">
            <span className="font-semibold text-gray-400 uppercase">Stack</span>
            <div className="flex flex-wrap justify-center items-center mt-8 text-gray-500 sm:justify-between">
              <div className="mr-5 mb-5 lg:mb-0 hover:text-gray-800 dark:hover:text-gray-400">
                <div className={`h-full flex items-center justify-center`}>
                  <Icon
                    icon={'logos:react'}
                    className="h-12 w-full mx-2 sm:mx-4 md:mx-8 lg:mx-10  p-1"
                  />
                </div>
              </div>
              <div className="mr-5 mb-5 lg:mb-0 hover:text-gray-800 dark:hover:text-gray-400">
                <div className={`h-full flex items-center justify-center`}>
                  <Icon
                    icon={'logos:nextjs-icon'}
                    className="h-12 w-full mx-2 sm:mx-4 md:mx-8 lg:mx-10  p-1"
                  />
                </div>
              </div>
              <div className="mr-5 mb-5 lg:mb-0 hover:text-gray-800 dark:hover:text-gray-400">
                <div className={`h-full flex items-center justify-center`}>
                  <Icon
                    icon={'logos:typescript-icon'}
                    className="h-12 w-full mx-2 sm:mx-4 md:mx-8 lg:mx-10  p-1"
                  />
                </div>
              </div>
              <div className="mr-5 mb-5 lg:mb-0 hover:text-gray-800 dark:hover:text-gray-400">
                <div className={`h-full flex items-center justify-center`}>
                  <Icon
                    icon={'logos:javascript'}
                    className="h-12 w-full mx-2 sm:mx-4 md:mx-8 lg:mx-10  p-1"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </AnimatedFadeInContainer>
    </section>
  );
};

const GradientShadowDiv = ({
  shadowClass,
  children,
}: {
  shadowClass: string;
  children?: React.ReactNode;
}): JSX.Element => (
  <div className={`relative ${shadowClass} rounded-xl`}>
    <div className="gradient-shadow">{children}</div>
  </div>
);

const ExperienceSection = ({
  id,
  title,
  description,
  imagePath,
}: {
  id: string;
  title: string;
  description: string;
  imagePath: string;
}): JSX.Element => {
  const shadowClass = {
    mobile: 'shadow-mobile',
    web: 'shadow-web',
    other: 'shadow-other',
  }[id] as string;

  return (
    <div
      key={id}
      className="flex flex-col justify-center items-center px-4 py-16 sm:p-10 lg:p-16 bg-slate-200 dark:bg-slate-900"
    >
      <div className="container mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <AnimatedFadeInContainer type="FadeInLeft">
          <div className="space-y-4 overflow-hidden">
            <h2 className="text-4xl font-semibold text-[#79ea86]">{title}</h2>
            <p className="text-base text-">{description}</p>
            <ExperienceSectionIconByType id={id} />
          </div>
        </AnimatedFadeInContainer>
        <AnimatedFadeInContainer type="FadeInRight">
          <div className="flex justify-center">
            <GradientShadowDiv shadowClass={shadowClass}>
              <Image
                src={imagePath}
                className="rounded-xl"
                alt={title}
                width={350}
                height={350}
              />
            </GradientShadowDiv>
          </div>
        </AnimatedFadeInContainer>
      </div>
    </div>
  );
};

const ExperienceSections = (): JSX.Element => (
  <div>
    {ExperienceSectionData.map((section) => (
      <ExperienceSection
        key={section.id}
        id={section.id}
        title={section.title}
        description={section.description}
        imagePath={section.imagePath}
      />
    ))}
  </div>
);

const Experience = (): JSX.Element => {
  const { data: personalInfo } = useAboutQuery('introduction');
  const personalInfoData =
    personalInfo as unknown as ProfessionalProfileintroduction;

  return (
    <Layout className="flex-col ">
      <div className="pt-20 sm:pt-10 pb-6 sm:pb-10 justify-center align-center flex">
        <AnimatedName personalInfo={personalInfoData} />
      </div>
      <ExperienceHero />
      <ExperienceSections />
    </Layout>
  );
};

export default Experience;
