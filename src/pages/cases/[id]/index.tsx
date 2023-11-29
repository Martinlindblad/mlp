import { ObjectId } from 'mongodb';
import { GetStaticPaths, GetStaticProps } from 'next';
import { connectToDatabase } from 'src/lib/mongodb';
import ContentLoader from 'src/src/components/AnimatedComponents/ContentLoader';
import AnimatedFadeInContainer from 'src/src/components/Layouts/AnimatedFadeInContainer';

interface CaseData {
  _id: ObjectId;
  title: string;
  description: string;
  imageSource: string;
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
    <AnimatedFadeInContainer type="FadeInBottom" className="h-full">
      <div>
        <h1>{caseData.title}</h1>
        <img src={caseData.imageSource} alt={caseData.title} />
        <p>{caseData.description}</p>
        {/* Render more case details here */}
      </div>
    </AnimatedFadeInContainer>
  );
};

export default CasePage;
