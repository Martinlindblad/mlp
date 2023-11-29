import { ObjectId } from 'mongodb';
import { GetStaticPaths, GetStaticProps } from 'next';
import { connectToDatabase } from 'src/lib/mongodb';

interface CaseData {
  _id: ObjectId;
  title: string;
  description: string;
  imageSource: string;
}

interface CasePageProps {
  caseData: CaseData;
}

const CasePage: React.FC<CasePageProps> = ({ caseData }) => {
  return (
    <div>
      <h1>{caseData.title}</h1>
      <img src={caseData.imageSource} alt={caseData.title} />
      <p>{caseData.description}</p>
      {/* Render more case details here */}
    </div>
  );
};

export const getStaticPaths: GetStaticPaths = async () => {
  const { database } = await connectToDatabase();
  const cases = await database
    .collection('projects_and_cases')
    .find({}, { projection: { _id: 1 } })
    .toArray();

  const paths = cases.map((caseDoc: { _id: { toString: () => any } }) => ({
    params: { id: caseDoc._id.toString() },
  }));

  // Close the connection if you're managing it at the function level
  // client.close();

  return { paths, fallback: 'blocking' };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const { database } = await connectToDatabase();
  const caseData = await database
    .collection('projects_and_cases')
    .findOne({ _id: new ObjectId(params?.id as string) });

  // Close the connection if you're managing it at the function level
  // client.close();

  if (!caseData) {
    return { notFound: true };
  }

  return {
    props: {
      caseData: JSON.parse(JSON.stringify(caseData)),
    },
    revalidate: 10, // In seconds. Adjust the revalidation time as needed.
  };
};

export default CasePage;
