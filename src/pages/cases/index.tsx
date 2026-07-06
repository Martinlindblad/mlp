import CaseItem from '../../components/CaseItem';
import { useMemo } from 'react';
import useProjectsAndCasesQuery from '../../hooks/useProjectsAndCasesQuery';
import SEO from '../../components/SEO';

type FallbackCase = {
  _id: string;
  title: string;
  imageSource: string;
  description: string;
  href?: string;
};

const fallbackCases: FallbackCase[] = [
  {
    _id: '657eed6741ee78bde91c1c3e',
    title: 'Mackmyra',
    imageSource: '/Images/Cases/mackmyra.webp',
    description:
      'React Native marketplace work for personalized whisky cask ordering.',
  },
  {
    _id: '657eef1d41ee78bde91c1c42',
    title: 'Livsstilsverktyget',
    imageSource: '/Images/Cases/livsstilsverktyget.webp',
    description:
      'Mobile health research flows with recurring input and clear user feedback.',
  },
];

const CasesListPage = () => {
  const { data } = useProjectsAndCasesQuery();

  const items = useMemo(() => {
    const apiItems = data?.filter((item) => item != null) ?? [];

    return apiItems.length > 0 ? apiItems : fallbackCases;
  }, [data]);

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-24">
      <SEO
        title="Cases"
        description="Browse Martin Lindblad's case studies and selected work across React Native, React, API integrations, and user interface delivery."
        path="/cases"
      />
      <h1 className="text-2xl font-bold text-white mb-6">All Cases</h1>
      <div>
        {items.map((c) => (
          <CaseItem
            key={c.title}
            id={c._id}
            title={c.title}
            imageUrl={c.imageSource}
            description={c.description}
            href={'href' in c ? c.href : undefined}
          />
        ))}
      </div>
    </main>
  );
};

export default CasesListPage;
