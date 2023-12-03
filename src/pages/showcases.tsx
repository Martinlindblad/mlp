import { motion } from 'framer-motion';
import AnimatedContainer from '../components/Layouts/AnimatedContainer';
import AnimatedStaggerItem from '../components/Layouts/AnimatedItem';
import { useMemo, useReducer as useReducer } from 'react';
import useProjectsAndCasesQuery from '../hooks/useProjectsAndCasesQuery';
import PageLoader from '../components/AnimatedComponents/ContentLoader';

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

        scale: 1,
      },
    }),
    [],
  );

  const itemVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.5 },
    },
  };

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
        <div>
          <AnimatedContainer containerVariant={container}>
            {cases.map((item, index) => (
              <AnimatedStaggerItem
                key={index}
                variants={itemVariants}
                onHover={() =>
                  caseDispatch({ type: 'toggle', id: item._id.toString() })
                }
              >
                <div className="flex flex-col items-center justify-center w-full h-screen ">
                  <div className="flex flex-col items-center">
                    <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-200">
                      {item.title}
                    </h1>
                    <p className="text-gray-600 dark:text-gray-300"></p>
                  </div>
                </div>
                <motion.div className="flex flex-col items-center justify-center w-full h-screen absolute ">
                  <div className="flex flex-col items-center">
                    <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-200">
                      {item.description}
                    </h1>
                    <p className="text-gray-600 dark:text-gray-300"></p>
                  </div>
                </motion.div>
              </AnimatedStaggerItem>
            ))}
          </AnimatedContainer>
        </div>
      )}
    </>
  );
};

export default ShowCases;
