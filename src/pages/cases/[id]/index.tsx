import { ObjectId } from 'mongodb';
import { GetStaticPaths, GetStaticProps } from 'next';
import { connectToDatabase } from 'src/lib/mongodb';
import ContentLoader from 'src/src/components/AnimatedComponents/ContentLoader';
import AnimatedFadeInContainer from 'src/src/components/Layouts/AnimatedFadeInContainer';
import Image from 'next/image';

interface ProjectDetail {
  title: string;
  description: string;
}

interface ProjectDetails {
  headline: string;
  description: string;
  details: ProjectDetail[];
}
interface CaseData {
  _id: ObjectId;
  title: string;
  description: string;
  imageSource: string;
  from: string;
  to: string;
  projectDetails: ProjectDetails;
}

interface CasePageProps {
  caseData: CaseData | null;
}

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
  if (!caseData) {
    return <ContentLoader />;
  }
  const { imageSource, title, description } = caseData;

  return (
    <div className="relative min-h-screen ">
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
            <h1 className="text-3xl lg:text-5xl font-bold  ">{title}</h1>
          </div>
        </AnimatedFadeInContainer>
      </div>
      <div className=" p-8 relative container">
        <AnimatedFadeInContainer type="FadeInTop">
          <h2 className="mb-6 text-4xl tracking-tight font-extrabold text-gray-900 dark:text-white w-1/3">
            {description}
          </h2>
          <div className="flex flex-col md:flex-row">
            <div className="relative w-full md:w-1/3 h-96 ">
              <Image
                className="absolute w-full h-full object-cover rounded-xl "
                src={imageSource}
                alt={title}
                layout="fill"
                objectPosition="center"
                priority
              />
            </div>
            <div className="flex flex-col md:px-20 py-4">
              <h3 className="text-xl mb-2">headline</h3>
              <p className="text-lg mb-4">description</p>
            </div>
          </div>
          <section className="">
            <div className="py-8 px-4 mx-auto  sm:py-16 lg:px-6">
              <div className="container">
                <p className="text-gray-500 sm:text-xl dark:text-gray-400">
                  Here at Flowbite we focus on markets where technology,
                  innovation, and capital can unlock long-term value and drive
                  economic growth.
                </p>
              </div>
              <div className="space-y-8 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-12 md:space-y-0">
                <div>
                  <div className="flex justify-center items-center mb-4 w-10 h-10 rounded-full bg-primary-100 lg:h-12 lg:w-12 dark:bg-primary-900">
                    <svg
                      className="w-5 h-5 text-primary-600 lg:w-6 lg:h-6 dark:text-primary-300"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z"
                        clip-rule="evenodd"
                      ></path>
                    </svg>
                  </div>
                  <h3 className="mb-2 text-xl font-bold dark:text-white">
                    Marketing
                  </h3>
                  <p className="text-gray-500 dark:text-gray-400">
                    Plan it, create it, launch it. Collaborate seamlessly with
                    all the organization and hit your marketing goals every
                    month with our marketing plan.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Additional Information Section */}
          <div className="flex flex-col md:flex-row justify-between space-y-4 md:space-y-0 md:space-x-4 mt-8">
            <div className="md:w-1/3 p-4 rounded-lg">
              <h4 className="text-lg font-bold mb-2 text-gray-100">
                Technology Stack Overview
              </h4>
              <p className="text-gray-200">
                Utilizing the JAMstack architecture, this project leverages
                React Native for seamless cross-platform app development. modern
                approach, combining JavaScript, APIs, and Markup, ensures a
                fast, secure, and scalable application, while React Native
                provides a native-like user experience across both iOS and
                Android devices.
              </p>
            </div>
            <div className="md:w-1/3 p-4 rounded-lg">
              <h4 className="text-lg font-bold mb-2 text-gray-100">
                Project Toolset Summary
              </h4>
              <p className="text-gray-200">
                In this React Native project, Android Studio and Xcode enable
                cross-platform development, while Postman aids in API
                integration. React Query and React Hook Forms enhance data
                management and form handling, complemented by efficient
                navigation and routing for a seamless user experience.
              </p>
            </div>

            <div className="md:w-1/3 p-4 rounded-lg">
              <h4 className="text-lg font-bold mb-2 text-gray-100">
                Current status
              </h4>
              <p className="text-gray-200">
                The project has reached its completion, marking a significant
                milestone in our development journey. Throughout its course,
                integrated cutting-edge technologies and overcome numerous
                challenges, resulting in a product that stands out for its
                innovation and user-centric design.
              </p>
            </div>
          </div>
        </AnimatedFadeInContainer>
      </div>
    </div>
  );
};

export default CasePage;
