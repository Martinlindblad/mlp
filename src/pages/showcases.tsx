import { motion } from 'framer-motion';
import AnimatedContainer from '../components/Layouts/AnimatedContainer';
import AnimatedStaggerItem from '../components/Layouts/AnimatedItem';
import { useCallback, useMemo, useReducer as useReducer } from 'react';
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
  const itemVariant = useMemo(() => {
    const InitialValue = { y: 400 };

    const finalPosition = {
      y: 0,
    };

    const transition = 0.5;

    return {
      hidden: {
        opacity: 1,
        scale: 1,
        ...InitialValue,
        transition: {
          duration: transition,
        },
      },
      visible: {
        opacity: 1,
        scale: 1,
        ...finalPosition,
        transition: {
          duration: transition,
        },
      },
    };
  }, []);
  const itemVariant2 = useMemo(() => {
    const InitialValue = { y: 0 };

    const finalPosition = {
      y: -400,
    };

    const transition = 0.5;

    return {
      hidden: {
        opacity: 1,
        scale: 1,
        ...InitialValue,
        transition: {
          duration: transition,
        },
      },
      visible: {
        opacity: 1,
        scale: 1,
        ...finalPosition,
        transition: {
          duration: transition,
        },
      },
    };
  }, []);

  const getStaggerItemVariants = useCallback(
    ({ index }: { index: number }) => ({
      hidden: {
        opacity: 1,
        scale: 0.75,
      },
      visible: {
        opacity: 1,
        scale: 1,
        transition: {
          delay: index * 0.4,
          duration: 0.4,
          ease: 'easeInOut',
        },
      },
      exit: {
        scale: 0.75,
        opacity: 0,
      },
    }),
    [],
  );

  const initialCaseState = useMemo(() => {
    const initialState = {} as { [key: string]: boolean };
    cases.forEach((item) => {
      const id = item._id.toString();
      initialState[id] = false;
    });
    return initialState;
  }, [cases]);

  const [caseState, caseDispatch] = useReducer(caseReducer, initialCaseState);

  const handleInteraction = (id: string) => {
    caseDispatch({ type: 'toggle', id });
  };

  return (
    <>
      {isLoading || !cases ? (
        <PageLoader />
      ) : (
        <AnimatedContainer
          containerVariant={container}
          className="container mx-auto px-4"
        >
          {cases.map((item, index) => (
            <AnimatedStaggerItem
              className="w-full lg:h-46 py-2  sm:p-4 overflow-hidden"
              key={index}
              itemVariant={getStaggerItemVariants({ index })}
              onTouchStart={() => handleInteraction(item._id.toString())}
              onTouchEnd={() => handleInteraction(item._id.toString())}
              onMouseEnter={() => handleInteraction(item._id.toString())}
              onMouseLeave={() => handleInteraction(item._id.toString())}
            >
              <div
                className="bg-center bg-no-repeat bg-cover bg-gray-700 bg-blend-multiply relative overflow-hidden "
                style={{ backgroundImage: `url('${item.imageSource}')` }}
              >
                <motion.div
                  animate={
                    caseState[item._id.toString()] ? 'visible' : 'hidden'
                  }
                  variants={itemVariant2}
                  className="px-4 mx-auto max-w-screen-xl text-center py-24 lg:py-28"
                >
                  <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-white text-xl md:text-2xl lg:text-3xl text-center">
                    <span className="inline-block mb-2 text-white">
                      {item.title}
                    </span>
                  </h1>
                </motion.div>
                <motion.div
                  animate={
                    caseState[item._id.toString()] ? 'visible' : 'hidden'
                  }
                  variants={itemVariant}
                  className="flex flex-col items-center justify-center w-full h-full absolute z-10 top-0 left-0 overflow-hidden"
                  style={{
                    background: `linear-gradient(rgba(${item.from}, 0.5), rgba(${item.to},0.5))`,
                  }}
                >
                  <div className="flex flex-col items-center">
                    <h1 className="text-xl md:text-2xl lg:text-3xl text-center font-bold">
                      {item.description}
                    </h1>
                    <Link
                      href={`/cases/${item._id}`}
                      className="flex-grow sm:flex-grow-0 inline-flex cursor-pointer items-center justify-center mt-10 ring-offset-2 ring-2 rounded-lg px-4 py-2 outline outline-2 outline-offset-2 hover:animate-pulse"
                    >
                      <span className="inline-block text-white">
                        Go to case
                      </span>
                    </Link>
                  </div>
                </motion.div>
              </div>
            </AnimatedStaggerItem>
          ))}
        </AnimatedContainer>
      )}
    </>
  );
};

export default ShowCases;
