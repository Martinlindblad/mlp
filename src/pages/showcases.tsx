import { motion } from 'framer-motion';
import AnimatedContainer from '../components/Layouts/AnimatedContainer';
import AnimatedStaggerItem from '../components/Layouts/AnimatedItem';
import { useMemo, useReducer as useReducer } from 'react';
import useProjectsAndCasesQuery from '../hooks/useProjectsAndCasesQuery';
import PageLoader from '../components/AnimatedComponents/ContentLoader';
import Link from 'next/link';

function caseReducer(
  state: { [x: string]: boolean },
  action: { type: 'toggle'; id: string },
) {
  switch (action.type) {
    case 'toggle':
      return { ...state, [action.id]: !state[action.id] };
    default:
      throw new Error('Unexpected action');
  }
}

const ShowCases = () => {
  const { data, isLoading } = useProjectsAndCasesQuery();

  const cases = useMemo(() => {
    if (!data) return [];
    return data?.filter((item) => item != null);
  }, [data]);

  const container = useMemo(
    () => ({
      hidden: {
        opacity: 0,
        scale: 0,
      },
      visible: {
        opacity: 1,
        scale: 1,
      },
      animate: {
        opacity: 1,
        transition: {
          staggerChildren: 0.5,
          delayChildren: 0.5,
        },
      },
    }),
    [],
  );
  const itemVariants = useMemo(
    () => ({
      hidden: {
        opacity: 0,
        y: 100,
      },
      visible: {
        opacity: 1,
      },
      animate: {
        opacity: 1,
        y: 0,
        transition: {
          ease: 'linear',
          duration: 2,
          y: { duration: 1 },
        },
      },
    }),
    [],
  );

  const intialCaseState = useMemo(() => {
    const initialState = {} as { [key: string]: boolean };
    cases.forEach((item) => {
      const id = item._id.toString();
      initialState[id] = false;
    });
    return initialState;
  }, [cases]);

  const [caseState, caseDispatch] = useReducer(caseReducer, intialCaseState);

  return (
    <>
      {isLoading ? (
        <PageLoader />
      ) : (
        <AnimatedContainer containerVariant={container}>
          {cases.map((item, index) => (
            <AnimatedStaggerItem
              key={index}
              onMouseEnter={() => {
                caseDispatch({
                  type: 'toggle',
                  id: item._id.toString(),
                });
              }}
              onMouseLeave={() => {
                caseDispatch({
                  type: 'toggle',
                  id: item._id.toString(),
                });
              }}
            >
              <section
                className="bg-center bg-no-repeat bg-cover bg-gray-700 bg-blend-multiply relative"
                style={{ backgroundImage: "url('/images/office.png')" }}
              >
                <div className="px-4 mx-auto max-w-screen-xl text-center py-24 lg:py-56">
                  <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-white md:text-5xl lg:text-6xl">
                    <span className="inline-block mb-2 text-white">
                      Showcases
                    </span>
                  </h1>
                </div>
                <motion.div
                  animate={
                    caseState[item._id.toString()] ? 'visible' : 'hidden'
                  }
                  variants={itemVariants}
                  className="flex flex-col items-center justify-center w-full h-full absolute z-10 top-0 left-0 bg-white dark:bg-gray-800 "
                >
                  <div className="flex flex-col items-center">
                    <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-200">
                      {item.description}
                    </h1>
                    <p className="text-gray-600 dark:text-gray-300"></p>
                  </div>
                </motion.div>
              </section>
            </AnimatedStaggerItem>
          ))}
        </AnimatedContainer>
      )}
    </>
  );
};

export default ShowCases;
