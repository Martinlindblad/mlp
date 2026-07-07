import axios from 'axios';
import { useQuery } from 'react-query';
import { InformationCard } from 'src/types/DBTypes';

const getPageCards = () =>
  axios
    .get<InformationCard[]>(`/api/pageCards`, {
      headers: {
        accept: 'application/json',
      },
    })
    .then(({ data }) => {
      return data;
    })
    .catch(() => undefined);

const usePageCardsQuery = () => {
  return useQuery(['getPageCards'], () => getPageCards());
};

export default usePageCardsQuery;
