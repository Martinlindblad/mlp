import { ObjectId } from 'mongodb';
import { GetStaticPaths, GetStaticProps } from 'next';
import { connectToDatabase } from 'src/lib/mongodb';
import ContentLoader from 'src/src/components/AnimatedComponents/ContentLoader';
import AnimatedFadeInContainer from 'src/src/components/Layouts/AnimatedFadeInContainer';
import Image from 'next/image';
import YouTube, { YouTubeProps } from 'react-youtube';
import AnimatedName from 'src/src/components/AnimatedComponents/AnimatedName';

import useWindowDimensions from 'src/src/hooks/useWindowDimensions';
import useAboutQuery from 'src/src/hooks/useAboutQuery';
import {
  CasePageProps,
  ProfessionalProfileintroduction,
  ProjectDetail,
  ProjectDetails,
} from 'src/types/DBTypes';
import Link from 'next/link';

const ProjectDetailItem: React.FC<{
  detail: ProjectDetail;
  index: number;
}> = ({ detail, index }) => {
  return (
    <AnimatedFadeInContainer type="FadeInBottom" delay={index * 0.4}>
      <div className="flex justify-center items-center mb-4 w-10 h-10 rounded-full bg-primary-100 lg:h-12 lg:w-12 dark:bg-primary-900">
        <svg
          className="w-5 h-5 text-primary-600 lg:w-6 lg:h-6 dark:text-primary-300"
          fill="currentColor"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          ></path>
        </svg>
      </div>
      <h3 className="mb-2 text-lg lg:text-xl xl:text-2xl font-bold dark:text-white">
        {detail.title}
      </h3>
      <p className="text-gray-500 dark:text-gray-400 text-sm md:text-md lg:text-lg xl:text-lg mb-4 ">
        {detail.description}
      </p>
    </AnimatedFadeInContainer>
  );
};
const ProjectDetailVideoComponent: React.FC<{
  videoID: string;
  videoTitle: string;
  videoDescription: string;
}> = ({ videoID, videoTitle, videoDescription }) => {
  const onPlayerReady: YouTubeProps['onReady'] = (event: {
    target: { pauseVideo: () => void };
  }) => {
    event.target.pauseVideo();
  };

  const { width: windowWidth } = useWindowDimensions();
  const maxVideoWidth = 640;
  const maxVideoHeight = 390;

  const mobileWidth = windowWidth * 0.9;
  const mobileHeight = mobileWidth * 0.609375;

  const isMobile = windowWidth < 640;

  const opts: YouTubeProps['opts'] = {
    playerVars: {
      autoplay: 0,
      loop: 1,
      playlist: videoID,
      controls: 1,
      modestbranding: 1,
      rel: 0,
    },
    height: isMobile ? mobileHeight : maxVideoHeight,
    width: isMobile ? mobileWidth : maxVideoWidth,
  };

  return (
    <div className="flex flex-col items-center justify-center my-10 lg:pt-20">
      <div className="py-8 px-4 mx-auto max-w-screen-xl text-center lg:py-16">
        <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none  md:text-4xl lg:text-5xl dark:text-white">
          {videoTitle}
        </h1>
        <p className="mb-8 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 lg:px-48 dark:text-gray-400">
          {videoDescription}
        </p>
      </div>
      <div className="mx-auto border border-gray-200 rounded-lg dark:border-gray-700 overflow-hidden">
        <YouTube videoId={videoID} opts={opts} onReady={onPlayerReady} />
      </div>
    </div>
  );
};
type ProjectRoleDetailProps = {
  roleDetails: string[];
  roleTitle: string;
};
const ProjectRoleDetail: React.FC<ProjectRoleDetailProps> = ({
  roleDetails,
  roleTitle,
}) => {
  return (
    <section className="">
      <div className="max-w-screen-sm px-4 py-8  lg:px-6 sm:pt-16 ">
        <div className="max-w-3xl pb-10 mx-auto text-center">
          <h2 className="text-4xl font-extrabold leading-tight tracking-tight">
            {roleTitle}
          </h2>
        </div>

        <div className="pl-6">
          <ul className="list-disc list-outside space-y-2">
            {roleDetails.map((detail, index) => (
              <li key={index} className="text-lg font-semibold flex">
                <AnimatedFadeInContainer type="FadeInLeft" delay={index * 0.3}>
                  <span className="flex-grow">{detail}</span>
                </AnimatedFadeInContainer>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

const ProjectDetailLinkList: React.FC<{
  links: ProjectDetails['links'];
}> = ({ links }) => {
  return (
    <div className="inline-flex rounded-md shadow-sm my-4" role="group">
      {links?.map((link) => (
        <button
          type="button"
          key={link.title}
          onClick={() => window.open(link.path)}
          className="px-5 py-3 text-base font-medium text-center hover:text-black mr-4 rounded-lg border border-white hover:bg-gray-100 focus:ring-4 focus:ring-gray-400"
        >
          {link.title}
        </button>
      ))}
      <Link
        href="/showcases"
        className="px-5 py-3 text-base font-medium text-center hover:text-black mr-4 rounded-lg border border-white hover:bg-gray-100 focus:ring-4 focus:ring-gray-400"
      >
        Showcases
      </Link>
    </div>
  );
};

export const getStaticPaths: GetStaticPaths = async () => {
  const { database } = await connectToDatabase();
  const cases = await database
    .collection('projects_and_cases')
    .find({}, { projection: { _id: 1 } })
    .toArray();

  const paths = cases.map((caseDoc) => ({
    params: { id: caseDoc._id.toString() },
  }));

  return { paths, fallback: 'blocking' };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const { database } = await connectToDatabase();

  const caseData = await database
    .collection('projects_and_cases')
    .findOne({ _id: new ObjectId(params?.id as string) });

  if (!caseData) {
    return { notFound: true };
  }

  return {
    props: {
      caseData: JSON.parse(JSON.stringify(caseData)),
    },
    revalidate: 5,
  };
};

const CasePage: React.FC<CasePageProps> = ({ caseData }) => {
  const { data: personalInfo } = useAboutQuery('introduction');

  if (!caseData) {
    return <ContentLoader />;
  }

  const { imageSource, title, description, projectDetails } = caseData;

  const {
    headline,
    details,
    description: projectDescription,
    videoID,
    videoDescription,
    videoTitle,
    roleDetails,
    roleTitle,
    links,
  } = projectDetails;

  return (
    <>
      <div className="relative min-h-screen ">
        <div className="pt-20 sm:pt-10 pb-6 sm:pb-10 justify-center align-center flex">
          <AnimatedName
            personalInfo={
              personalInfo as unknown as ProfessionalProfileintroduction
            }
          />
        </div>
        <div className="relative w-full h-96">
          <Image
            className="absolute w-full h-full object-cover"
            src={imageSource}
            alt={title}
            layout="fill"
            objectPosition="center"
            priority
          />
          <div className="absolute inset-0 dark:bg-slate-950 bg-slate-100 opacity-60"></div>
          {/* Optional dark overlay */}
          <AnimatedFadeInContainer type="FadeInTop" className="h-full">
            <div className="absolute inset-0 flex items-center justify-center">
              <h1 className="text-3xl lg:text-6xl font-bold">{title}</h1>
            </div>
          </AnimatedFadeInContainer>
        </div>
        <div className=" p-8 relative container">
          <AnimatedFadeInContainer type="FadeInLeft" className="h-full">
            <h2 className="mb-6 text-xl lg:text-3xl tracking-tight font-extrabold text-gray-900 dark:text-white lg:w-1/3">
              {description}
            </h2>
          </AnimatedFadeInContainer>
          <div className="flex flex-col md:flex-row">
            <AnimatedFadeInContainer
              type="FadeInLeft"
              className="relative w-full h-96 "
            >
              <Image
                className="absolute w-full h-full object-cover rounded-xl "
                src={imageSource} // TODO: Change to imageSources[0] and create a carousel
                alt={title}
                layout="fill"
                objectPosition="center"
                priority
              />
            </AnimatedFadeInContainer>
            <AnimatedFadeInContainer
              type="FadeInRight"
              className="flex flex-col flex-grow md:px-20 pb-4"
            >
              <h3 className="text-md md:text-lg lg:text-xl xl:text-2xl mb-8">
                {headline}
              </h3>
              <p className="text-sm md:text-md lg:text-lg xl:text-xl mb-4 ">
                {projectDescription}
              </p>
              <ProjectDetailLinkList links={links} />
            </AnimatedFadeInContainer>
          </div>
          <ProjectRoleDetail roleDetails={roleDetails} roleTitle={roleTitle} />

          {videoID && (
            <AnimatedFadeInContainer
              type="FadeInBottom"
              className="relative w-full"
            >
              <ProjectDetailVideoComponent
                videoID={videoID}
                videoTitle={videoTitle ?? ''}
                videoDescription={videoDescription ?? ''}
              />
            </AnimatedFadeInContainer>
          )}
          <section className="">
            <div className="py-8 px-4 mx-auto  sm:py-16 lg:px-6">
              <div className="space-y-8 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-12 md:space-y-0">
                {details.map((detail, index) => (
                  <ProjectDetailItem
                    detail={detail}
                    key={detail.title}
                    index={index}
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
};

export default CasePage;
