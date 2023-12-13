import { motion } from 'framer-motion';
import { useMemo, useReducer } from 'react';
import useProjectsAndCasesQuery from '../hooks/useProjectsAndCasesQuery';
import PageLoader from '../components/AnimatedComponents/ContentLoader';
import Link from 'next/link';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import AnimatedPreseceWrapper from '../components/Layouts/AnimatePresenceWrapper';

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

  const enter = useMemo(() => {
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

  const exit = useMemo(() => {
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
    <AnimatedPreseceWrapper>
      {isLoading || !cases ? (
        <PageLoader />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cases.map((item) => (
            <AnimatedFadeInContainer
              type="FadeInBottom"
              className="lg:h-64 py-2 sm:p-4 overflow-hidden relative"
              key={`${item._id}-Showcase-item`}
              onTouchStart={() => handleInteraction(item._id.toString())}
              onTouchEnd={() => handleInteraction(item._id.toString())}
              onMouseEnter={() => handleInteraction(item._id.toString())}
              onMouseLeave={() => handleInteraction(item._id.toString())}
            >
              <img
                src={item.imageSource}
                alt={item.title}
                loading="lazy"
                className="w-full h-full object-cover object-center absolute top-0 left-0 z-0"
              />
              <motion.div
                animate={caseState[item._id.toString()] ? 'visible' : 'hidden'}
                variants={exit}
                className="px-4 mx-auto max-w-screen-xl text-center py-24 lg:py-28 relative z-10"
              >
                <h1 className="mb-4 font-extrabold tracking-tight leading-none text-white text-xl md:text-2xl lg:text-3xl text-center">
                  <span className="inline-block mb-2 text-white">
                    {item.title}
                  </span>
                </h1>
              </motion.div>
              <motion.div
                animate={caseState[item._id.toString()] ? 'visible' : 'hidden'}
                variants={enter}
                className="flex flex-col items-center justify-center w-full h-full absolute top-0 left-0 z-10"
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
                    <span className="inline-block text-white">Go to case</span>
                  </Link>
                </div>
              </motion.div>
            </AnimatedFadeInContainer>
          ))}
        </div>
      )}
    </AnimatedPreseceWrapper>
  );
};

export default ShowCases;
