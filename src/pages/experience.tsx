import AnimatedName from '../components/AnimatedComponents/AnimatedName';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';
import React from 'react';
import useAboutQuery from '../hooks/useAboutQuery';
import { ProfessionalProfileintroduction } from 'src/types/DBTypes';
import { Icon } from '@iconify/react';
import Image from 'next/image';

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
    imagePath: '/images/applications.webp',
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
      className="flex flex-col justify-center items-center p-16 lg:h-screen bg-slate-200 dark:bg-slate-900"
    >
      <AnimatedFadeInContainer className="container mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <div className="space-y-4 overflow-hidden">
          <h2 className="text-4xl font-semibold text-[#79ea86]">{title}</h2>
          <p className="text-base text-">{description}</p>
          <ExperienceSectionIconByType id={id} />
        </div>
        <div className="flex justify-center">
          <GradientShadowDiv shadowClass={shadowClass}>
            <Image
              src={imagePath}
              className="rounded-xl"
              alt={title}
              width={400}
              height={400}
            />
          </GradientShadowDiv>
        </div>
      </AnimatedFadeInContainer>
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
      <ExperienceSections />
    </Layout>
  );
};

export default Experience;
