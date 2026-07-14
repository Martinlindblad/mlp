import Image from 'next/image';
import Link from 'next/link';
import { useMemo } from 'react';
import AnimatedName from '../components/AnimatedComponents/AnimatedName';
import AnimatedPreseceWrapper from '../components/Layouts/AnimatePresenceWrapper';
import SEO from '../components/SEO';
import useAboutQuery from '../hooks/useAboutQuery';
import useProjectsAndCasesQuery from '../hooks/useProjectsAndCasesQuery';
import { ProfessionalProfileintroduction } from 'src/types/DBTypes';

interface CaseItem {
  _id: string | { toString: () => string };
  title: string;
  imageSource: string;
  description: string;
  href?: string;
}

const fallbackIntroduction = {
  name: 'Martin',
  surname: 'Lindblad',
  title: 'Front-end Developer',
  info: 'Front-end developer based in Stockholm, Sweden.',
  key: 'introduction',
} as ProfessionalProfileintroduction;

const fallbackCases: CaseItem[] = [
  {
    _id: 'imaginecare',
    title: 'ImagineCare',
    description:
      'A healthcare product where I worked with React Native interfaces, API integration, and reliable mobile flows.',
    imageSource: '/images/cases/imaginecare.webp',
    href: '/cases',
  },
  {
    _id: '657eed6741ee78bde91c1c3e',
    title: 'Mackmyra',
    description:
      'A React Native marketplace experience for ordering personalized whisky casks.',
    imageSource: '/images/cases/mackmyra.webp',
  },
  {
    _id: '657eef1d41ee78bde91c1c42',
    title: 'Livsstilsverktyget',
    description:
      'A health research app built around recurring user input, clear flows, and maintainable mobile UI.',
    imageSource: '/images/cases/livsstilsverktyget.webp',
  },
];

const mongoObjectIdPattern = /^[a-f\d]{24}$/i;

const getCaseId = (item: CaseItem) =>
  typeof item._id === 'string' ? item._id : item._id.toString();

const getCaseHref = (item: CaseItem) =>
  item.href ??
  (mongoObjectIdPattern.test(getCaseId(item))
    ? `/cases/${getCaseId(item)}`
    : undefined);

const ShowCaseItem = ({ item }: { item: CaseItem }) => {
  const href = getCaseHref(item);

  return (
    <article className="group relative min-h-[18rem] overflow-hidden rounded-md bg-gray-950 shadow-lg">
      <Image
        src={item.imageSource}
        alt={`${item.title} project preview`}
        fill
        className="object-cover opacity-65 transition duration-300 group-hover:scale-105 group-hover:opacity-45"
        sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/70 to-gray-950/10" />
      <div className="relative z-10 flex h-full min-h-[18rem] flex-col justify-end p-6">
        <h2 className="text-2xl font-bold text-white">{item.title}</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-gray-100">
          {item.description}
        </p>
        {href && (
          <Link
            href={href}
            className="mt-6 inline-flex w-fit rounded-md bg-white px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-blue-100 focus:outline-none focus:ring-4 focus:ring-blue-300"
          >
            Read case study
          </Link>
        )}
      </div>
    </article>
  );
};

const ShowCases = () => {
  const { data } = useProjectsAndCasesQuery();
  const { data: personalInfo } = useAboutQuery('introduction');

  const cases = useMemo(() => {
    const apiCases = data?.filter((item) => item != null) ?? [];

    return apiCases.length > 0 ? apiCases : fallbackCases;
  }, [data]);

  const personalInfoData =
    (personalInfo as unknown as ProfessionalProfileintroduction | undefined) ??
    fallbackIntroduction;

  return (
    <AnimatedPreseceWrapper>
      <SEO
        title="Showcases"
        description="Selected front-end and mobile projects by Martin Lindblad, including React Native apps, user interfaces, API integrations, and product delivery work."
        path="/showcases"
      />
      <main className="min-h-screen bg-gray-100 px-4 py-20 text-gray-950 dark:bg-gray-950 dark:text-white sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-10">
          <AnimatedName personalInfo={personalInfoData} />
          <section className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Selected work
            </p>
            <h1 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">
              Case studies with product context, delivery work, and technical
              decisions.
            </h1>
            <p className="mt-5 text-base leading-7 text-gray-700 dark:text-gray-200 md:text-lg">
              A focused selection of mobile and web projects where I contributed
              to interface implementation, API integration, debugging,
              performance, and maintainable user flows.
            </p>
          </section>
          <section
            aria-label="Selected project case studies"
            className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
          >
            {cases.map((item) => (
              <ShowCaseItem key={getCaseId(item)} item={item} />
            ))}
          </section>
        </div>
      </main>
    </AnimatedPreseceWrapper>
  );
};

export default ShowCases;
