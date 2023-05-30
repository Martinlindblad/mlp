import axios from 'axios';
import { useQuery } from 'react-query';
import { PageCardType } from 'src/types/DBTypes';

const getPageCards = () =>
  axios
    .get<PageCardType[]>(`/api/pageCards`, {
      headers: {
        accept: 'application/json',
      },
    })
    .then(({ data }) => {
      return data;
    })
    .catch((err: unknown) => console.log(err));

const usePageCardsQuery = () => {
  return useQuery(['getPageCards'], () => getPageCards());
};

export default usePageCardsQuery;
