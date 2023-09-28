import {
  createContext,
  useState,
  useEffect,
  useContext,
  ReactNode,
} from 'react';
import { useIsFetching } from 'react-query';

type LoadingContextType = boolean;

const LoadingContext = createContext<LoadingContextType>(false);

interface LoadingProviderProps {
  children: ReactNode;
}

export const LoadingProvider: React.FC<LoadingProviderProps> = ({
  children,
}) => {
  const [loading, setLoading] = useState<LoadingContextType>(false);
  const isFetching = useIsFetching();
  console.log('isFetching', isFetching);
  useEffect(() => {
    setLoading(isFetching > 0);
  }, [isFetching]);

  return (
    <LoadingContext.Provider value={loading}>
      {children}
    </LoadingContext.Provider>
  );
};

export const useLoading = (): LoadingContextType => useContext(LoadingContext);
