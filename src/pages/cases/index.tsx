// ... other imports
import useProjectDetail Query from 'src/src/hooks/useProjectDetail Query';
import CaseItem from './CaseItem'; // Adjust the import path as needed
import { useMemo } from 'react';
import ContentLoader from 'src/src/components/AnimatedComponents/ContentLoader';

const CasesListPage = () => {
  const { data, isLoading } = useProjectDetail Query();

  const items = useMemo(() => {
    if (!data) return [];
    return data?.filter((item) => item != null);
  }, [data]);

  return isLoading ? (
    <ContentLoader />
  ) : (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">All Cases</h1>
      <div>
        {items.map((c) => (
          <CaseItem
            key={c.title}
            id={c._id}
            title={c.title}
            imageUrl={c.imageSource}
            description={c.description}
          />
        ))}
      </div>
    </div>
  );
};

export default CasesListPage;
