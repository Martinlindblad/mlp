import { ObjectId } from 'mongodb';
import { GetStaticPaths, GetStaticProps } from 'next';
import { connectToDatabase } from 'src/lib/mongodb';
import ContentLoader from 'src/src/components/AnimatedComponents/ContentLoader';
import AnimatedFadeInContainer from 'src/src/components/Layouts/AnimatedFadeInContainer';
import Image from 'next/image';

interface CaseData {
  _id: ObjectId;
  title: string;
  description: string;
  imageSource: string;
  from: string;
  to: string;
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

  return (
    <div className="relative h-screen">
      <div className="relative w-full h-1/2">
        <Image
          className="absolute w-full h-full object-cover"
          src={caseData.imageSource}
          alt={caseData.title}
          layout="fill"
          objectPosition="center"
          priority
        />
        <div className="absolute inset-0 bg-black opacity-60"></div>
        {/* Optional dark overlay */}
        <AnimatedFadeInContainer type="FadeInTop" className="h-full">
          <div className="absolute inset-0 flex items-center justify-center">
            <h1 className="text-3xl lg:text-5xl font-bold text-white">
              {caseData.title}
            </h1>
          </div>
        </AnimatedFadeInContainer>
      </div>

      {/* Content Section */}
      <div className="bg-white p-8">
        <AnimatedFadeInContainer type="FadeInTop">
          <p className="text-lg text-gray-700 mb-4">{caseData.description}</p>
          <div className="flex flex-wrap space-x-4"></div>
        </AnimatedFadeInContainer>
      </div>
    </div>
  );
};

export default CasePage;
