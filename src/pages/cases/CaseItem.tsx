import { ObjectId } from 'mongodb';
import Link from 'next/link';

interface CaseItemProps {
  id: ObjectId;
  title: string;
  imageUrl: string;
  description: string;
}

const CaseItem: React.FC<CaseItemProps> = ({
  id,
  title,
  imageUrl,
  description,
}) => {
  return (
    <div className="flex bg-gray-800 rounded-lg overflow-hidden mb-4">
      <img className="w-40 h-auto object-cover" src={imageUrl} alt={title} />
      <div className="p-4 flex flex-col justify-between flex-grow">
        <div>
          <h2 className="text-white text-lg font-semibold">{title}</h2>
          <p className="text-gray-400 text-sm">{description}</p>
        </div>
        <div className="flex mt-4">
          <Link href={`/cases/${id}`}>
            <a className="text-blue-500 hover:text-blue-600 transition duration-300 text-sm font-semibold">
              View Case
            </a>
          </Link>
          <button className="text-white bg-blue-600 hover:bg-blue-700 transition duration-300 ml-2 px-4 py-2 rounded text-sm font-semibold">
            Other Action
          </button>
        </div>
      </div>
    </div>
  );
};

export default CaseItem;
